use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde_json::json;

use axum::extract::FromRef;

use super::jwt::verify_session_token;
use crate::AppState;

/// A user row from the database.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub plan: String,
    pub plan_expires_at: Option<NaiveDateTime>,
    pub is_vip: bool,
    pub polar_customer_id: Option<String>,
    pub polar_subscription_id: Option<String>,
    pub subscription_cancel_at_period_end: bool,
}

/// Extractor that validates the JWT and loads the user from the database.
/// Equivalent to Python's `get_current_user` dependency.
pub struct AuthUser(pub UserRow);

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);
        let config = &app_state.config;
        let db = &app_state.db;

        // Extract Bearer token from Authorization header
        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| auth_error("Missing authorization header"))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| auth_error("Invalid authorization header format"))?;

        // Verify JWT
        let claims = verify_session_token(token, &config.jwt_secret)
            .map_err(|_| auth_error("Invalid or expired session token"))?;

        // Load user from DB
        let user: UserRow = sqlx::query_as(
            "SELECT id, email, first_name, last_name, plan, plan_expires_at, is_vip,
                    polar_customer_id, polar_subscription_id, subscription_cancel_at_period_end
             FROM users WHERE id = ?",
        )
        .bind(&claims.user_id)
        .fetch_optional(db)
        .await
        .map_err(|_| auth_error("Database error"))?
        .ok_or_else(|| auth_error("User not found"))?;

        // Verify email matches
        if user.email != claims.email {
            return Err(auth_error("Invalid session"));
        }

        // VIP override: config is source of truth
        if config.vip_emails.contains(&user.email.to_lowercase()) && !user.is_vip {
            let _ = sqlx::query("UPDATE users SET is_vip = 1 WHERE id = ?")
                .bind(&user.id)
                .execute(db)
                .await;
        }

        // Check expired Pro subscription (safety net)
        let mut user = user;
        if user.plan == "pro" {
            if let Some(expires_at) = &user.plan_expires_at {
                if *expires_at < Utc::now().naive_utc() {
                    let _ = sqlx::query(
                        "UPDATE users SET plan = 'free', polar_subscription_id = NULL, plan_expires_at = NULL WHERE id = ?",
                    )
                    .bind(&user.id)
                    .execute(db)
                    .await;
                    user.plan = "free".to_string();
                }
            }
        }

        Ok(AuthUser(user))
    }
}

/// Check if user has Pro plan or VIP status. Returns an error response if not.
pub fn check_pro_or_vip(user: &UserRow) -> Result<(), Response> {
    if user.plan == "pro" || user.is_vip {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({"detail": "Pro subscription required"})),
        )
            .into_response())
    }
}

fn auth_error(detail: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"detail": detail})),
    )
        .into_response()
}
