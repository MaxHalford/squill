//! Connection listing endpoint for Pro/VIP users.
//!
//! Aggregates BigQuery, ClickHouse, and Snowflake connections into a single list.
//! Credentials are stored encrypted on the backend; this endpoint returns metadata only.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::auth::middleware::{check_pro_or_vip, AuthUser};
use crate::error::error_response;
use crate::AppState;

// ---------------------------------------------------------------------------
// Row types (sqlx::FromRow)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ClickHouseListRow {
    id: String,
    name: String,
    database: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SnowflakeListRow {
    id: String,
    name: String,
    database: Option<String>,
}

// ---------------------------------------------------------------------------
// Response models
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ConnectionItem {
    id: String,
    flavor: String,
    name: String,
    email: Option<String>,
    database: Option<String>,
}

#[derive(Serialize)]
struct ConnectionListResponse {
    connections: Vec<ConnectionItem>,
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/// GET /connections - list all connections for the current user (Pro/VIP gate).
///
/// BigQuery is omitted intentionally: it runs client-side via PKCE so the
/// backend has no record of BigQuery connections.
pub async fn list_connections(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;

    let (ch_result, sf_result) = tokio::try_join!(
        sqlx::query_as::<_, ClickHouseListRow>(
            "SELECT id, name, database FROM clickhouse_connections WHERE user_id = ?",
        )
        .bind(&user.id)
        .fetch_all(&state.db),
        sqlx::query_as::<_, SnowflakeListRow>(
            "SELECT id, name, database FROM snowflake_connections WHERE user_id = ?",
        )
        .bind(&user.id)
        .fetch_all(&state.db),
    )
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let mut connections = Vec::new();

    for ch in ch_result {
        connections.push(ConnectionItem {
            id: ch.id,
            flavor: "clickhouse".to_string(),
            name: ch.name,
            email: None,
            database: ch.database,
        });
    }

    for sf in sf_result {
        connections.push(ConnectionItem {
            id: sf.id,
            flavor: "snowflake".to_string(),
            name: sf.name,
            email: None,
            database: sf.database,
        });
    }

    Ok(Json(ConnectionListResponse { connections }))
}
