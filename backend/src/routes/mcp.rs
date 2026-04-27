//! MCP (Model Context Protocol) server integration.
//!
//! Exposes Squill canvas/box/connection operations as MCP tools so that
//! LLM clients can programmatically manipulate canvases.
//!
//! Auth strategy for now:
//! - In test mode (`SQUILL_TEST_MODE=1`): accepts a hardcoded test user or the
//!   first user in the database.
//! - Production MCP OAuth can be layered in later.

use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content};
use rmcp::tool;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

// `schemars` must be in scope for the JsonSchema derive macro.
use rmcp::schemars;
use rmcp::schemars::JsonSchema;

use crate::services::ws_manager::WsManager;

// ---------------------------------------------------------------------------
// Handler struct
// ---------------------------------------------------------------------------

/// MCP server handler backed by the Squill SQLite database.
#[derive(Clone)]
pub struct SquillMcpHandler {
    db: SqlitePool,
    user_id: String,
    ws_manager: Arc<WsManager>,
}

// ---------------------------------------------------------------------------
// Parameter structs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CreateCanvasParams {
    /// Human-readable canvas name
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListCanvasesParams {}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct GetCanvasParams {
    /// UUID of the canvas
    pub canvas_id: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CreateBoxParams {
    /// UUID of the canvas to add the box to
    pub canvas_id: String,
    /// Box type (e.g. "sql", "note", "schema", "detail", "analytics", "history", "chat")
    pub box_type: String,
    /// SQL query or note content
    #[serde(default)]
    pub query: String,
    /// Display name for the box
    pub name: String,
    /// X position on the canvas
    pub x: f64,
    /// Y position on the canvas
    pub y: f64,
    /// Box width
    pub width: f64,
    /// Box height
    pub height: f64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdateBoxParams {
    /// UUID of the canvas
    pub canvas_id: String,
    /// Numeric box ID within the canvas
    pub box_id: i64,
    /// New SQL query or note content (optional)
    pub query: Option<String>,
    /// New display name (optional)
    pub name: Option<String>,
    /// New X position (optional)
    pub x: Option<f64>,
    /// New Y position (optional)
    pub y: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct DeleteBoxParams {
    /// UUID of the canvas
    pub canvas_id: String,
    /// Numeric box ID within the canvas
    pub box_id: i64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListConnectionsParams {}

// ---------------------------------------------------------------------------
// Row types (sqlx::FromRow)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct CanvasRow {
    id: String,
    name: String,
    next_box_id: i64,
    version: i64,
    created_at: String,
    updated_at: String,
}

#[derive(sqlx::FromRow)]
struct BoxRow {
    #[allow(dead_code)]
    canvas_id: String,
    box_id: i64,
    state: String,
}

#[derive(sqlx::FromRow)]
struct BigQueryRow {
    email: String,
    created_at: String,
}

#[derive(sqlx::FromRow)]
struct ClickHouseRow {
    id: String,
    name: String,
    database: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SnowflakeRow {
    id: String,
    name: String,
    database: Option<String>,
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

#[rmcp::tool_router(server_handler)]
impl SquillMcpHandler {
    /// Create a new canvas. Returns JSON with the canvas id, name, and version.
    #[tool(description = "Create a new canvas")]
    async fn create_canvas(
        &self,
        Parameters(params): Parameters<CreateCanvasParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let canvas_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let result = sqlx::query(
            "INSERT INTO canvases (id, user_id, name, next_box_id, version, created_at, updated_at)
             VALUES (?, ?, ?, 1, 1, ?, ?)",
        )
        .bind(&canvas_id)
        .bind(&self.user_id)
        .bind(&params.name)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await;

        match result {
            Ok(_) => {
                let json = serde_json::json!({
                    "id": canvas_id,
                    "name": params.name,
                    "version": 1,
                    "created_at": now,
                    "updated_at": now,
                });
                Ok(CallToolResult::success(vec![Content::text(json.to_string())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to create canvas: {e}"
            ))])),
        }
    }

    /// List all canvases for the current user.
    #[tool(description = "List all canvases for the current user")]
    async fn list_canvases(
        &self,
        #[allow(unused_variables)] Parameters(_params): Parameters<ListCanvasesParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let rows = sqlx::query_as::<_, CanvasRow>(
            "SELECT id, name, next_box_id, version, created_at, updated_at
             FROM canvases WHERE user_id = ? ORDER BY updated_at DESC",
        )
        .bind(&self.user_id)
        .fetch_all(&self.db)
        .await;

        match rows {
            Ok(rows) => {
                let canvases: Vec<serde_json::Value> = rows
                    .into_iter()
                    .map(|c| {
                        serde_json::json!({
                            "id": c.id,
                            "name": c.name,
                            "version": c.version,
                            "created_at": c.created_at,
                            "updated_at": c.updated_at,
                        })
                    })
                    .collect();
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string(&canvases).unwrap_or_else(|_| "[]".to_string()),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to list canvases: {e}"
            ))])),
        }
    }

    /// Get a canvas with all its boxes.
    #[tool(description = "Get a canvas with all its boxes")]
    async fn get_canvas(
        &self,
        Parameters(params): Parameters<GetCanvasParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let canvas = sqlx::query_as::<_, CanvasRow>(
            "SELECT id, name, next_box_id, version, created_at, updated_at
             FROM canvases WHERE id = ? AND user_id = ?",
        )
        .bind(&params.canvas_id)
        .bind(&self.user_id)
        .fetch_optional(&self.db)
        .await;

        let canvas = match canvas {
            Ok(Some(c)) => c,
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Canvas not found",
                )]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Database error: {e}"
                ))]));
            }
        };

        let boxes = sqlx::query_as::<_, BoxRow>(
            "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? ORDER BY box_id",
        )
        .bind(&params.canvas_id)
        .fetch_all(&self.db)
        .await;

        match boxes {
            Ok(boxes) => {
                let box_values: Vec<serde_json::Value> = boxes
                    .into_iter()
                    .map(|b| {
                        let state: serde_json::Value =
                            serde_json::from_str(&b.state).unwrap_or(serde_json::json!({}));
                        serde_json::json!({
                            "box_id": b.box_id,
                            "state": state,
                        })
                    })
                    .collect();

                let json = serde_json::json!({
                    "id": canvas.id,
                    "name": canvas.name,
                    "version": canvas.version,
                    "next_box_id": canvas.next_box_id,
                    "boxes": box_values,
                    "created_at": canvas.created_at,
                    "updated_at": canvas.updated_at,
                });
                Ok(CallToolResult::success(vec![Content::text(json.to_string())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to fetch boxes: {e}"
            ))])),
        }
    }

    /// Create a new box on a canvas.
    #[tool(description = "Create a new box on a canvas")]
    async fn create_box(
        &self,
        Parameters(params): Parameters<CreateBoxParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        // Verify canvas ownership
        let canvas = sqlx::query_as::<_, CanvasRow>(
            "SELECT id, name, next_box_id, version, created_at, updated_at
             FROM canvases WHERE id = ? AND user_id = ?",
        )
        .bind(&params.canvas_id)
        .bind(&self.user_id)
        .fetch_optional(&self.db)
        .await;

        let canvas = match canvas {
            Ok(Some(c)) => c,
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Canvas not found",
                )]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Database error: {e}"
                ))]));
            }
        };

        let box_id = canvas.next_box_id;
        let state = serde_json::json!({
            "type": params.box_type,
            "query": params.query,
            "name": params.name,
            "x": params.x,
            "y": params.y,
            "width": params.width,
            "height": params.height,
        });
        let state_str = state.to_string();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let insert = sqlx::query(
            "INSERT INTO boxes (canvas_id, box_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&params.canvas_id)
        .bind(box_id)
        .bind(&state_str)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await;

        if let Err(e) = insert {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to create box: {e}"
            ))]));
        }

        let update = sqlx::query(
            "UPDATE canvases SET next_box_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(box_id + 1)
        .bind(&now)
        .bind(&params.canvas_id)
        .execute(&self.db)
        .await;

        if let Err(e) = update {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to update canvas: {e}"
            ))]));
        }

        // Broadcast to connected WebSocket clients
        let ws_event = serde_json::json!({
            "type": "box.created",
            "data": { "box_id": box_id, "state": state },
            "version": canvas.version + 1,
            "by": self.user_id,
            "client_id": "mcp",
        });
        self.ws_manager.broadcast(&params.canvas_id, &ws_event.to_string(), None);

        let json = serde_json::json!({
            "box_id": box_id,
            "state": state,
        });
        Ok(CallToolResult::success(vec![Content::text(json.to_string())]))
    }

    /// Update fields on an existing box.
    #[tool(description = "Update fields on an existing box")]
    async fn update_box(
        &self,
        Parameters(params): Parameters<UpdateBoxParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        // Verify canvas ownership
        let canvas = sqlx::query_as::<_, CanvasRow>(
            "SELECT id, name, next_box_id, version, created_at, updated_at
             FROM canvases WHERE id = ? AND user_id = ?",
        )
        .bind(&params.canvas_id)
        .bind(&self.user_id)
        .fetch_optional(&self.db)
        .await;

        match canvas {
            Ok(Some(_)) => {}
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Canvas not found",
                )]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Database error: {e}"
                ))]));
            }
        }

        // Fetch existing box
        let box_row = sqlx::query_as::<_, BoxRow>(
            "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? AND box_id = ?",
        )
        .bind(&params.canvas_id)
        .bind(params.box_id)
        .fetch_optional(&self.db)
        .await;

        let box_row = match box_row {
            Ok(Some(b)) => b,
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text("Box not found")]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Database error: {e}"
                ))]));
            }
        };

        // Merge updates into existing state
        let mut existing: serde_json::Value =
            serde_json::from_str(&box_row.state).unwrap_or(serde_json::json!({}));
        if let Some(map) = existing.as_object_mut() {
            if let Some(ref query) = params.query {
                map.insert("query".to_string(), serde_json::json!(query));
            }
            if let Some(ref name) = params.name {
                map.insert("name".to_string(), serde_json::json!(name));
            }
            if let Some(x) = params.x {
                map.insert("x".to_string(), serde_json::json!(x));
            }
            if let Some(y) = params.y {
                map.insert("y".to_string(), serde_json::json!(y));
            }
        }

        let merged_str = existing.to_string();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let update = sqlx::query(
            "UPDATE boxes SET state = ?, updated_at = ? WHERE canvas_id = ? AND box_id = ?",
        )
        .bind(&merged_str)
        .bind(&now)
        .bind(&params.canvas_id)
        .bind(params.box_id)
        .execute(&self.db)
        .await;

        if let Err(e) = update {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to update box: {e}"
            ))]));
        }

        let bump = sqlx::query(
            "UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&params.canvas_id)
        .execute(&self.db)
        .await;

        if let Err(e) = bump {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to bump canvas version: {e}"
            ))]));
        }

        // Broadcast update to connected WebSocket clients
        let mut fields = serde_json::Map::new();
        if let Some(ref q) = params.query { fields.insert("query".into(), serde_json::json!(q)); }
        if let Some(ref n) = params.name { fields.insert("name".into(), serde_json::json!(n)); }
        if let Some(x) = params.x { fields.insert("x".into(), serde_json::json!(x)); }
        if let Some(y) = params.y { fields.insert("y".into(), serde_json::json!(y)); }
        let ws_event = serde_json::json!({
            "type": "box.updated",
            "data": { "box_id": params.box_id, "fields": fields },
            "by": self.user_id,
            "client_id": "mcp",
        });
        self.ws_manager.broadcast(&params.canvas_id, &ws_event.to_string(), None);

        let json = serde_json::json!({
            "box_id": params.box_id,
            "state": existing,
        });
        Ok(CallToolResult::success(vec![Content::text(json.to_string())]))
    }

    /// Delete a box from a canvas.
    #[tool(description = "Delete a box from a canvas")]
    async fn delete_box(
        &self,
        Parameters(params): Parameters<DeleteBoxParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        // Verify canvas ownership
        let canvas = sqlx::query_as::<_, CanvasRow>(
            "SELECT id, name, next_box_id, version, created_at, updated_at
             FROM canvases WHERE id = ? AND user_id = ?",
        )
        .bind(&params.canvas_id)
        .bind(&self.user_id)
        .fetch_optional(&self.db)
        .await;

        match canvas {
            Ok(Some(_)) => {}
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Canvas not found",
                )]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Database error: {e}"
                ))]));
            }
        }

        let result = sqlx::query("DELETE FROM boxes WHERE canvas_id = ? AND box_id = ?")
            .bind(&params.canvas_id)
            .bind(params.box_id)
            .execute(&self.db)
            .await;

        match result {
            Ok(r) if r.rows_affected() == 0 => {
                return Ok(CallToolResult::error(vec![Content::text("Box not found")]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to delete box: {e}"
                ))]));
            }
            _ => {}
        }

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let _ = sqlx::query(
            "UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&params.canvas_id)
        .execute(&self.db)
        .await;

        // Broadcast deletion to connected WebSocket clients
        let ws_event = serde_json::json!({
            "type": "box.deleted",
            "data": { "box_id": params.box_id },
            "by": self.user_id,
            "client_id": "mcp",
        });
        self.ws_manager.broadcast(&params.canvas_id, &ws_event.to_string(), None);

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::json!({"deleted": true, "box_id": params.box_id}).to_string(),
        )]))
    }

    /// List all database connections for the current user.
    #[tool(description = "List all database connections for the current user")]
    async fn list_connections(
        &self,
        #[allow(unused_variables)] Parameters(_params): Parameters<ListConnectionsParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let bq = sqlx::query_as::<_, BigQueryRow>(
            "SELECT email, created_at FROM bigquery_connections WHERE user_id = ?",
        )
        .bind(&self.user_id)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        let ch = sqlx::query_as::<_, ClickHouseRow>(
            "SELECT id, name, database FROM clickhouse_connections WHERE user_id = ?",
        )
        .bind(&self.user_id)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        let sf = sqlx::query_as::<_, SnowflakeRow>(
            "SELECT id, name, database FROM snowflake_connections WHERE user_id = ?",
        )
        .bind(&self.user_id)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        let mut connections: Vec<serde_json::Value> = Vec::new();

        for row in bq {
            let millis = chrono::NaiveDateTime::parse_from_str(&row.created_at, "%Y-%m-%d %H:%M:%S")
                .map(|dt| dt.and_utc().timestamp_millis())
                .unwrap_or(0);
            connections.push(serde_json::json!({
                "id": format!("bigquery-{}-{}", row.email, millis),
                "flavor": "bigquery",
                "name": row.email,
                "email": row.email,
            }));
        }
        for row in ch {
            connections.push(serde_json::json!({
                "id": row.id,
                "flavor": "clickhouse",
                "name": row.name,
                "database": row.database,
            }));
        }
        for row in sf {
            connections.push(serde_json::json!({
                "id": row.id,
                "flavor": "snowflake",
                "name": row.name,
                "database": row.database,
            }));
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string(&connections).unwrap_or_else(|_| "[]".to_string()),
        )]))
    }
}

// ---------------------------------------------------------------------------
// Build the MCP service for mounting in the Axum router
// ---------------------------------------------------------------------------

/// Create a `StreamableHttpService` ready to be mounted at `/mcp`.
///
/// The returned service implements `tower::Service<http::Request<B>>` and can
/// be used with `axum::routing::any_service()`.
pub fn build_mcp_service(
    db: SqlitePool,
    mcp_user_id: String,
    ws_manager: Arc<WsManager>,
) -> StreamableHttpService<SquillMcpHandler, LocalSessionManager> {
    let user_id = mcp_user_id;

    let config = StreamableHttpServerConfig::default()
        .with_stateful_mode(false)
        .with_json_response(true)
        .with_cancellation_token(CancellationToken::new())
        .disable_allowed_hosts(); // Host validation handled by Axum CORS layer.

    let session_manager = Arc::new(LocalSessionManager::default());

    StreamableHttpService::new(
        move || {
            Ok(SquillMcpHandler {
                db: db.clone(),
                user_id: user_id.clone(),
                ws_manager: ws_manager.clone(),
            })
        },
        session_manager,
        config,
    )
}
