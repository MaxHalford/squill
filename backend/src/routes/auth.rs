//! OAuth authentication endpoints for Squill sign-in.
//!
//!   POST /auth/google/login
//!   POST /auth/github/login
//!   POST /auth/microsoft/login
//!   POST /auth/logout
//!
//! BigQuery OAuth runs client-side via PKCE and does not touch this backend.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::rate_limit::RateLimited;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::jwt::{create_session_token, verify_session_token};
use crate::auth::middleware::AuthUser;
use crate::error::error_response;
use crate::helpers::now_sqlite;
use crate::services::oauth::{GitHubOAuthService, GoogleOAuthService, MicrosoftOAuthService};
use crate::token_revocation;
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / Response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OAuthCodeRequest {
    code: String,
    redirect_uri: String,
}

#[derive(Serialize)]
struct UserPayload {
    id: String,
    email: String,
    first_name: Option<String>,
    last_name: Option<String>,
    plan: String,
    is_vip: bool,
}

#[derive(Serialize)]
struct LoginResponse {
    session_token: String,
    user: UserPayload,
}

#[derive(Deserialize)]
pub struct LogoutRequest {
    email: String,
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct UserRow {
    id: String,
    email: String,
    first_name: Option<String>,
    last_name: Option<String>,
    plan: String,
    is_vip: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn user_payload(row: &UserRow) -> UserPayload {
    UserPayload {
        id: row.id.clone(),
        email: row.email.clone(),
        first_name: row.first_name.clone(),
        last_name: row.last_name.clone(),
        plan: row.plan.clone(),
        is_vip: row.is_vip,
    }
}

/// Look up user by email; create if not found, update name + VIP if found.
async fn upsert_user(
    state: &AppState,
    email: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<UserRow, Response> {
    let is_vip = state.config.vip_emails.contains(&email.to_lowercase());

    let existing: Option<UserRow> = sqlx::query_as(
        "SELECT id, email, first_name, last_name, plan, is_vip FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    match existing {
        Some(mut user) => {
            let now = now_sqlite();
            sqlx::query(
                "UPDATE users SET first_name = ?, last_name = ?, is_vip = ?, last_login_at = ? WHERE id = ?",
            )
            .bind(first_name)
            .bind(last_name)
            .bind(is_vip || user.is_vip)
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

            user.first_name = first_name.map(|s| s.to_string());
            user.last_name = last_name.map(|s| s.to_string());
            if is_vip {
                user.is_vip = true;
            }
            Ok(user)
        }
        None => {
            let id = Uuid::new_v4().to_string();
            let now = now_sqlite();

            sqlx::query(
                "INSERT INTO users (id, email, first_name, last_name, plan, is_vip, created_at, last_login_at) VALUES (?, ?, ?, ?, 'free', ?, ?, ?)",
            )
            .bind(&id)
            .bind(email)
            .bind(first_name)
            .bind(last_name)
            .bind(is_vip)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

            Ok(UserRow {
                id,
                email: email.to_string(),
                first_name: first_name.map(|s| s.to_string()),
                last_name: last_name.map(|s| s.to_string()),
                plan: "free".to_string(),
                is_vip,
            })
        }
    }
}

fn value_as_str<'a>(map: &'a std::collections::HashMap<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(|v| v.as_str())
}

// ---------------------------------------------------------------------------
// POST /auth/google/login
// ---------------------------------------------------------------------------

pub async fn google_login(
    _: RateLimited,
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    if !config.test_mode
        && (config.google_client_id.is_empty() || config.google_client_secret.is_empty())
    {
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Google OAuth is not configured",
        ));
    }

    let google = GoogleOAuthService::new(
        &config.google_client_id,
        &config.google_client_secret,
        config.test_mode,
        state.http_client.clone(),
    );

    // Exchange code for tokens
    let tokens = google
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received"))?;

    // Get user info
    let mut user_info = google
        .get_user_info(access_token)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    // In test mode, override email from the code
    if config.test_mode && body.code.starts_with("test-") {
        let email = body.code.strip_prefix("test-").unwrap_or(&body.code);
        user_info.insert("email".into(), Value::String(email.to_string()));
    }

    let email = value_as_str(&user_info, "email")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No email in user info"))?;
    let first_name = value_as_str(&user_info, "given_name");
    let last_name = value_as_str(&user_info, "family_name");

    let user = upsert_user(&state, email, first_name, last_name).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &config.jwt_secret,
        config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/github/login
// ---------------------------------------------------------------------------

pub async fn github_login(
    _: RateLimited,
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    if !config.test_mode
        && (config.github_client_id.is_empty() || config.github_client_secret.is_empty())
    {
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "GitHub OAuth is not configured",
        ));
    }

    let github = GitHubOAuthService::new(
        &config.github_client_id,
        &config.github_client_secret,
        config.test_mode,
        state.http_client.clone(),
    );

    let tokens = github
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received from GitHub"))?
        .to_string();

    // Get email and login in parallel
    let (email_result, login_result) = tokio::join!(
        github.get_primary_email(&access_token),
        github.get_user_login(&access_token),
    );

    let mut email = email_result
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_REQUEST,
                "No verified email found on your GitHub account. Please verify your email on GitHub and try again.",
            )
        })?;

    // In test mode, override email from the code
    if config.test_mode && body.code.starts_with("test-") {
        email = body.code.strip_prefix("test-").unwrap_or(&body.code).to_string();
    }

    let login = login_result
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    let user = upsert_user(&state, &email, login.as_deref(), None).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &config.jwt_secret,
        config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/microsoft/login
// ---------------------------------------------------------------------------

pub async fn microsoft_login(
    _: RateLimited,
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    if !config.test_mode
        && (config.microsoft_client_id.is_empty() || config.microsoft_client_secret.is_empty())
    {
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Microsoft OAuth is not configured",
        ));
    }

    let microsoft = MicrosoftOAuthService::new(
        &config.microsoft_client_id,
        &config.microsoft_client_secret,
        config.test_mode,
        state.http_client.clone(),
    );

    let tokens = microsoft
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received from Microsoft"))?
        .to_string();

    let mut user_info = microsoft
        .get_user_info(&access_token)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    // In test mode, override email from the code
    if config.test_mode && body.code.starts_with("test-") {
        let email = body.code.strip_prefix("test-").unwrap_or(&body.code);
        user_info.insert("email".into(), Value::String(email.to_string()));
    }

    let email = value_as_str(&user_info, "email")
        .filter(|e| !e.is_empty())
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_REQUEST,
                "No email found on your Microsoft account.",
            )
        })?;
    let first_name = value_as_str(&user_info, "first_name");
    let last_name = value_as_str(&user_info, "last_name");

    let user = upsert_user(&state, email, first_name, last_name).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &config.jwt_secret,
        config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/logout (auth required)
// ---------------------------------------------------------------------------

pub async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    AuthUser(user): AuthUser,
    Json(body): Json<LogoutRequest>,
) -> Result<impl IntoResponse, Response> {
    if body.email != user.email {
        return Err(error_response(StatusCode::FORBIDDEN, "Email does not match authenticated user"));
    }

    // Revoke the current session token so it can't be reused
    if let Some(auth_header) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            if let Ok(claims) = verify_session_token(token, &state.config.jwt_secret) {
                let expires_at = chrono::DateTime::from_timestamp(claims.exp, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| now_sqlite());
                let _ = token_revocation::revoke_token(&state.db, token, &expires_at).await;
            }
        }
    }

    Ok(Json(json!({"status": "ok"})))
}

