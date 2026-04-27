//! ClickHouse credential storage endpoints.
//!
//! Only CRUD for encrypted credentials -- no query execution.
//! Queries run client-side from the browser via ClickHouse HTTP API.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::encryption::TokenEncryption;
use crate::AppState;

// ---------------------------------------------------------------------------
// Row types (sqlx::FromRow)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ClickHouseRow {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    user_id: String,
    host: String,
    port: i64,
    username: String,
    password_encrypted: Vec<u8>,
    encryption_iv: Vec<u8>,
    database: Option<String>,
    secure: bool,
}

// ---------------------------------------------------------------------------
// Request / Response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateConnectionRequest {
    name: String,
    host: String,
    #[serde(default = "default_port")]
    port: i64,
    username: String,
    password: String,
    database: Option<String>,
    #[serde(default = "default_secure")]
    secure: bool,
}

fn default_port() -> i64 {
    8443
}

fn default_secure() -> bool {
    true
}

#[derive(Serialize)]
struct CreateConnectionResponse {
    id: String,
}

#[derive(Serialize)]
struct CredentialsResponse {
    host: String,
    port: i64,
    username: String,
    password: String,
    database: Option<String>,
    secure: bool,
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

/// POST /clickhouse/connections - create a ClickHouse connection with encrypted credentials.
pub async fn create_connection(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(body): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, Response> {
    let enc = TokenEncryption::new(&state.config.token_encryption_key)
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Encryption init error: {e}")))?;

    let (ciphertext, iv) = enc
        .encrypt(&body.password)
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Encryption error: {e}")))?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO clickhouse_connections
         (id, user_id, name, host, port, database, username, password_encrypted, encryption_iv, secure, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&body.name)
    .bind(&body.host)
    .bind(body.port)
    .bind(&body.database)
    .bind(&body.username)
    .bind(&ciphertext)
    .bind(&iv)
    .bind(body.secure)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(CreateConnectionResponse { id }))
}

/// GET /clickhouse/connections/{connection_id}/credentials - get decrypted credentials.
pub async fn get_credentials(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(connection_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let row = sqlx::query_as::<_, ClickHouseRow>(
        "SELECT id, user_id, host, port, username, password_encrypted, encryption_iv, database, secure
         FROM clickhouse_connections WHERE id = ? AND user_id = ?",
    )
    .bind(&connection_id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "Connection not found"))?;

    let enc = TokenEncryption::new(&state.config.token_encryption_key)
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Encryption init error: {e}")))?;

    let password = enc
        .decrypt(&row.password_encrypted, &row.encryption_iv)
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Decryption error: {e}")))?;

    Ok(Json(CredentialsResponse {
        host: row.host,
        port: row.port,
        username: row.username,
        password,
        database: row.database,
        secure: row.secure,
    }))
}

/// DELETE /clickhouse/connections/{connection_id} - delete a connection.
pub async fn delete_connection(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(connection_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let result = sqlx::query(
        "DELETE FROM clickhouse_connections WHERE id = ? AND user_id = ?",
    )
    .bind(&connection_id)
    .bind(&user.id)
    .execute(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if result.rows_affected() == 0 {
        return Err(error_response(StatusCode::NOT_FOUND, "Connection not found"));
    }

    Ok(Json(json!({"status": "deleted"})))
}
