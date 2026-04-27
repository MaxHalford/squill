//! Test-only endpoints, registered when SQUILL_TEST_MODE=1.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::jwt::create_session_token;
use crate::AppState;

#[derive(Deserialize)]
pub struct SeedUserRequest {
    id: String,
    email: String,
    #[serde(default = "default_plan")]
    plan: String,
    #[serde(default)]
    is_vip: bool,
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
}

fn default_plan() -> String {
    "free".to_string()
}

pub async fn seed_user(
    State(state): State<AppState>,
    Json(req): Json<SeedUserRequest>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "INSERT INTO users (id, email, plan, is_vip, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&req.id)
    .bind(&req.email)
    .bind(&req.plan)
    .bind(req.is_vip)
    .bind(&req.first_name)
    .bind(&req.last_name)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => (StatusCode::OK, Json(json!({"ok": true}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        ),
    }
}

pub async fn reset_db(State(state): State<AppState>) -> impl IntoResponse {
    let tables = [
        "boxes",
        "canvas_shares",
        "canvases",
        "bigquery_connections",
        "clickhouse_connections",
        "snowflake_connections",
        "users",
    ];
    for table in tables {
        let query = format!("DELETE FROM {table}");
        if let Err(e) = sqlx::query(&query).execute(&state.db).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            );
        }
    }
    (StatusCode::OK, Json(json!({"ok": true})))
}

#[derive(Deserialize)]
pub struct TestLoginRequest {
    email: String,
    user_id: String,
}

pub async fn test_login(
    State(state): State<AppState>,
    Json(req): Json<TestLoginRequest>,
) -> impl IntoResponse {
    let config = &state.config;
    match create_session_token(&req.user_id, &req.email, &config.jwt_secret, config.jwt_expiration_days) {
        Ok(token) => (StatusCode::OK, Json(json!({"session_token": token}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        ),
    }
}
