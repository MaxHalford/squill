//! Snowflake credential storage endpoints.
//!
//! Only CRUD for encrypted credentials -- no query execution.
//! Queries run client-side from the browser via Snowflake SQL REST API.

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
struct SnowflakeRow {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    user_id: String,
    account: String,
    username: String,
    password_encrypted: Vec<u8>,
    encryption_iv: Vec<u8>,
    warehouse: Option<String>,
    database: Option<String>,
    schema_name: Option<String>,
    role: Option<String>,
}

// ---------------------------------------------------------------------------
// Request / Response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateConnectionRequest {
    name: String,
    account: String,
    username: String,
    password: String,
    warehouse: Option<String>,
    database: Option<String>,
    schema_name: Option<String>,
    role: Option<String>,
}

#[derive(Serialize)]
struct CreateConnectionResponse {
    id: String,
}

#[derive(Serialize)]
struct CredentialsResponse {
    account: String,
    username: String,
    password: String,
    warehouse: Option<String>,
    database: Option<String>,
    schema_name: Option<String>,
    role: Option<String>,
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

/// POST /snowflake/connections - create a Snowflake connection with encrypted credentials.
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
        "INSERT INTO snowflake_connections
         (id, user_id, name, account, username, password_encrypted, encryption_iv, warehouse, database, schema_name, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&body.name)
    .bind(&body.account)
    .bind(&body.username)
    .bind(&ciphertext)
    .bind(&iv)
    .bind(&body.warehouse)
    .bind(&body.database)
    .bind(&body.schema_name)
    .bind(&body.role)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(CreateConnectionResponse { id }))
}

/// GET /snowflake/connections/{connection_id}/credentials - get decrypted credentials.
pub async fn get_credentials(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(connection_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let row = sqlx::query_as::<_, SnowflakeRow>(
        "SELECT id, user_id, account, username, password_encrypted, encryption_iv, warehouse, database, schema_name, role
         FROM snowflake_connections WHERE id = ? AND user_id = ?",
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
        account: row.account,
        username: row.username,
        password,
        warehouse: row.warehouse,
        database: row.database,
        schema_name: row.schema_name,
        role: row.role,
    }))
}

/// DELETE /snowflake/connections/{connection_id} - delete a connection.
pub async fn delete_connection(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(connection_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let result = sqlx::query(
        "DELETE FROM snowflake_connections WHERE id = ? AND user_id = ?",
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
