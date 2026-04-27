//! User profile endpoints.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::json;

use crate::auth::middleware::AuthUser;
use crate::AppState;

// ---------------------------------------------------------------------------
// Response models
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct UserProfileResponse {
    id: String,
    email: String,
    first_name: Option<String>,
    last_name: Option<String>,
    plan: String,
    is_vip: bool,
    plan_expires_at: Option<String>,
    subscription_cancel_at_period_end: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn error_response(status: StatusCode, detail: &str) -> Response {
    (status, Json(json!({"detail": detail}))).into_response()
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/// GET /user/me - return current user profile (auth required, no Pro gate).
pub async fn get_user_profile(AuthUser(user): AuthUser) -> impl IntoResponse {
    Json(UserProfileResponse {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        plan: user.plan,
        is_vip: user.is_vip,
        plan_expires_at: user.plan_expires_at.map(|dt| dt.to_string()),
        subscription_cancel_at_period_end: user.subscription_cancel_at_period_end,
    })
}

/// DELETE /user/me - delete user account and cascade all connections.
pub async fn delete_user(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    // Delete all connections (cascade)
    for table in &[
        "bigquery_connections",
        "clickhouse_connections",
        "snowflake_connections",
    ] {
        let sql = format!("DELETE FROM {} WHERE user_id = ?", table);
        sqlx::query(&sql)
            .bind(&user.id)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
    }

    // Delete canvas-related data (shares, boxes, canvases)
    sqlx::query("DELETE FROM canvas_shares WHERE owner_user_id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    sqlx::query("DELETE FROM boxes WHERE canvas_id IN (SELECT id FROM canvases WHERE user_id = ?)")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    sqlx::query("DELETE FROM canvases WHERE user_id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    // Delete the user
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(json!({
        "status": "ok",
        "message": "Account deleted successfully"
    })))
}
