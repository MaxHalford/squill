//! Canvas persistence, box CRUD, and sharing endpoints for Pro/VIP users.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::auth::middleware::{check_pro_or_vip, AuthUser};
use crate::error::error_response;
use crate::helpers::now_sqlite;
use crate::AppState;

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
    state: String, // JSON stored as TEXT
}

#[derive(sqlx::FromRow)]
struct ShareRow {
    id: String,
    canvas_id: String,
    owner_user_id: String,
    share_token: String,
    permission: String,
    email: Option<String>,
    created_at: String,
    expires_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Request / Response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CanvasCreateRequest {
    id: String,
    name: String,
}

#[derive(Deserialize)]
pub struct CanvasRenameRequest {
    name: String,
}

#[derive(Serialize)]
struct CanvasResponse {
    id: String,
    name: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
struct CanvasListResponse {
    canvases: Vec<CanvasResponse>,
}

#[derive(Deserialize)]
pub struct BoxCreateRequest {
    state: Value,
}

#[derive(Deserialize)]
pub struct BoxBatchCreateRequest {
    boxes: Vec<Value>,
}

#[derive(Deserialize)]
pub struct BoxUpdateRequest {
    fields: Value,
}

#[derive(Deserialize)]
pub struct BoxBatchUpdateItem {
    box_id: i64,
    fields: Value,
}

#[derive(Deserialize)]
pub struct BoxBatchUpdateRequest {
    updates: Vec<BoxBatchUpdateItem>,
}

#[derive(Deserialize)]
pub struct BoxBatchDeleteRequest {
    box_ids: Vec<i64>,
}

#[derive(Serialize)]
struct BoxResponse {
    box_id: i64,
    state: Value,
}

#[derive(Serialize)]
struct CanvasSnapshotResponse {
    id: String,
    name: String,
    version: i64,
    next_box_id: i64,
    boxes: Vec<BoxResponse>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
pub struct CanvasImportRequest {
    boxes: Vec<Value>,
    next_box_id: i64,
}

#[derive(Deserialize)]
pub struct ShareCreateRequest {
    permission: String,
    email: Option<String>,
    expires_at: Option<String>,
}

#[derive(Serialize)]
struct ShareResponse {
    id: String,
    share_token: String,
    permission: String,
    email: Option<String>,
    created_at: String,
    expires_at: Option<String>,
}

#[derive(Serialize)]
struct ShareListResponse {
    shares: Vec<ShareResponse>,
}

#[derive(Serialize)]
struct ShareValidateResponse {
    canvas_id: String,
    permission: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Load a canvas owned by the given user, or return 404.
async fn get_owned_canvas(
    db: &sqlx::SqlitePool,
    canvas_id: &str,
    user_id: &str,
) -> Result<CanvasRow, Response> {
    sqlx::query_as::<_, CanvasRow>(
        "SELECT id, name, next_box_id, version, created_at, updated_at
         FROM canvases WHERE id = ? AND user_id = ?",
    )
    .bind(canvas_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "Canvas not found"))
}

/// Parse a box state JSON string into a serde_json::Value.
fn parse_state(state_str: &str) -> Value {
    serde_json::from_str(state_str).unwrap_or(Value::Object(serde_json::Map::new()))
}

// ---------------------------------------------------------------------------
// Canvas CRUD
// ---------------------------------------------------------------------------

pub async fn list_canvases(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;

    let canvases = sqlx::query_as::<_, CanvasRow>(
        "SELECT id, name, next_box_id, version, created_at, updated_at
         FROM canvases WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(CanvasListResponse {
        canvases: canvases
            .into_iter()
            .map(|c| CanvasResponse {
                id: c.id,
                name: c.name,
                created_at: c.created_at,
                updated_at: c.updated_at,
            })
            .collect(),
    }))
}

pub async fn create_canvas(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(body): Json<CanvasCreateRequest>,
) -> Result<Response, Response> {
    check_pro_or_vip(&user)?;

    // Idempotent: if the canvas already exists for this user, return it
    if let Some(existing) = sqlx::query_as::<_, CanvasRow>(
        "SELECT id, name, next_box_id, version, created_at, updated_at
         FROM canvases WHERE id = ? AND user_id = ?",
    )
    .bind(&body.id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    {
        return Ok((
            StatusCode::CREATED,
            Json(CanvasResponse {
                id: existing.id,
                name: existing.name,
                created_at: existing.created_at,
                updated_at: existing.updated_at,
            }),
        )
            .into_response());
    }

    let now = now_sqlite();
    sqlx::query(
        "INSERT INTO canvases (id, user_id, name, next_box_id, version, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, ?, ?)",
    )
    .bind(&body.id)
    .bind(&user.id)
    .bind(&body.name)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok((
        StatusCode::CREATED,
        Json(CanvasResponse {
            id: body.id,
            name: body.name,
            created_at: now.clone(),
            updated_at: now,
        }),
    )
        .into_response())
}

pub async fn rename_canvas(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<CanvasRenameRequest>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let now = now_sqlite();
    sqlx::query("UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&body.name)
        .bind(&now)
        .bind(&canvas.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(CanvasResponse {
        id: canvas.id,
        name: body.name,
        created_at: canvas.created_at,
        updated_at: now,
    }))
}

pub async fn delete_canvas(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    sqlx::query("DELETE FROM canvases WHERE id = ?")
        .bind(&canvas.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_canvas_snapshot(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
) -> Result<Response, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let box_rows = sqlx::query_as::<_, BoxRow>(
        "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? ORDER BY box_id",
    )
    .bind(&canvas.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let boxes: Vec<BoxResponse> = box_rows
        .iter()
        .map(|b| BoxResponse {
            box_id: b.box_id,
            state: parse_state(&b.state),
        })
        .collect();

    let body = CanvasSnapshotResponse {
        id: canvas.id,
        name: canvas.name,
        version: canvas.version,
        next_box_id: canvas.next_box_id,
        boxes,
        created_at: canvas.created_at,
        updated_at: canvas.updated_at,
    };

    let mut headers = HeaderMap::new();
    headers.insert("etag", format!("\"{}\"", canvas.version).parse().unwrap());

    Ok((StatusCode::OK, headers, Json(body)).into_response())
}

// ---------------------------------------------------------------------------
// Box CRUD
// ---------------------------------------------------------------------------

pub async fn create_box(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<BoxCreateRequest>,
) -> Result<Response, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let box_id = canvas.next_box_id;
    let state_str = serde_json::to_string(&body.state)
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "JSON error"))?;
    let now = now_sqlite();

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    sqlx::query(
        "INSERT INTO boxes (canvas_id, box_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&canvas.id)
    .bind(box_id)
    .bind(&state_str)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    sqlx::query("UPDATE canvases SET next_box_id = ?, version = version + 1, updated_at = ? WHERE id = ?")
        .bind(box_id + 1)
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok((
        StatusCode::CREATED,
        Json(BoxResponse {
            box_id,
            state: body.state,
        }),
    )
        .into_response())
}

pub async fn create_boxes_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<BoxBatchCreateRequest>,
) -> Result<Response, Response> {
    check_pro_or_vip(&user)?;

    if body.boxes.len() > 100 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Maximum 100 boxes per batch",
        ));
    }

    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let now = now_sqlite();
    let mut next_id = canvas.next_box_id;
    let mut created: Vec<BoxResponse> = Vec::with_capacity(body.boxes.len());

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    for box_state in &body.boxes {
        let state_str = serde_json::to_string(box_state)
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "JSON error"))?;

        sqlx::query(
            "INSERT INTO boxes (canvas_id, box_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&canvas.id)
        .bind(next_id)
        .bind(&state_str)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

        created.push(BoxResponse {
            box_id: next_id,
            state: box_state.clone(),
        });
        next_id += 1;
    }

    sqlx::query("UPDATE canvases SET next_box_id = ?, version = version + 1, updated_at = ? WHERE id = ?")
        .bind(next_id)
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok((StatusCode::CREATED, Json(created)).into_response())
}

pub async fn update_box(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path((canvas_id, box_id)): Path<(String, i64)>,
    headers: HeaderMap,
    Json(body): Json<BoxUpdateRequest>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    // Check If-Match header for optimistic concurrency
    if let Some(if_match) = headers.get("if-match") {
        let if_match_str = if_match
            .to_str()
            .map_err(|_| error_response(StatusCode::BAD_REQUEST, "Invalid If-Match header"))?;
        let expected: i64 = if_match_str
            .trim_matches('"')
            .parse()
            .map_err(|_| error_response(StatusCode::BAD_REQUEST, "Invalid If-Match value"))?;
        if canvas.version != expected {
            return Err(error_response(
                StatusCode::CONFLICT,
                &format!(
                    "Version mismatch: expected {}, current {}",
                    expected, canvas.version
                ),
            ));
        }
    }

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let box_row = sqlx::query_as::<_, BoxRow>(
        "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? AND box_id = ?",
    )
    .bind(&canvas.id)
    .bind(box_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "Box not found"))?;

    // Merge fields into existing state
    let mut existing: Value = parse_state(&box_row.state);
    if let (Some(existing_map), Some(fields_map)) =
        (existing.as_object_mut(), body.fields.as_object())
    {
        for (k, v) in fields_map {
            existing_map.insert(k.clone(), v.clone());
        }
    }

    let merged_str = serde_json::to_string(&existing)
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "JSON error"))?;
    let now = now_sqlite();

    sqlx::query("UPDATE boxes SET state = ?, updated_at = ? WHERE canvas_id = ? AND box_id = ?")
        .bind(&merged_str)
        .bind(&now)
        .bind(&canvas.id)
        .bind(box_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(BoxResponse {
        box_id,
        state: existing,
    }))
}

pub async fn update_boxes_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<BoxBatchUpdateRequest>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;

    if body.updates.len() > 100 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Maximum 100 updates per batch",
        ));
    }

    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let now = now_sqlite();
    let mut updated: Vec<BoxResponse> = Vec::new();

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    for item in &body.updates {
        let box_row = sqlx::query_as::<_, BoxRow>(
            "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? AND box_id = ?",
        )
        .bind(&canvas.id)
        .bind(item.box_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

        if let Some(box_row) = box_row {
            let mut existing: Value = parse_state(&box_row.state);
            if let (Some(existing_map), Some(fields_map)) =
                (existing.as_object_mut(), item.fields.as_object())
            {
                for (k, v) in fields_map {
                    existing_map.insert(k.clone(), v.clone());
                }
            }

            let merged_str = serde_json::to_string(&existing)
                .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "JSON error"))?;

            sqlx::query(
                "UPDATE boxes SET state = ?, updated_at = ? WHERE canvas_id = ? AND box_id = ?",
            )
            .bind(&merged_str)
            .bind(&now)
            .bind(&canvas.id)
            .bind(item.box_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

            updated.push(BoxResponse {
                box_id: item.box_id,
                state: existing,
            });
        }
        // Skip missing box_ids silently
    }

    sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(updated))
}

pub async fn delete_box(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path((canvas_id, box_id)): Path<(String, i64)>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let result = sqlx::query("DELETE FROM boxes WHERE canvas_id = ? AND box_id = ?")
        .bind(&canvas.id)
        .bind(box_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if result.rows_affected() == 0 {
        return Err(error_response(StatusCode::NOT_FOUND, "Box not found"));
    }

    let now = now_sqlite();
    sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_boxes_batch(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<BoxBatchDeleteRequest>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    // Build a DELETE with IN clause using positional parameters
    if !body.box_ids.is_empty() {
        let placeholders: Vec<&str> = body.box_ids.iter().map(|_| "?").collect();
        let sql = format!(
            "DELETE FROM boxes WHERE canvas_id = ? AND box_id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query(&sql).bind(&canvas.id);
        for id in &body.box_ids {
            query = query.bind(id);
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
    }

    let now = now_sqlite();
    sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&canvas.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

pub async fn import_canvas_state(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<CanvasImportRequest>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;
    let canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    // Idempotent: if boxes already exist, skip import and return current state
    let existing_box: Option<(i64,)> = sqlx::query_as(
        "SELECT box_id FROM boxes WHERE canvas_id = ? LIMIT 1",
    )
    .bind(&canvas.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if existing_box.is_some() {
        return build_snapshot_response(&state.db, &canvas.id).await;
    }

    let now = now_sqlite();

    let mut tx = state.db.begin().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    for box_state in &body.boxes {
        let box_id = box_state
            .get("id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Strip the 'id' field from state (it's stored as box_id column)
        let mut state_obj = box_state.clone();
        if let Some(map) = state_obj.as_object_mut() {
            map.remove("id");
        }

        let state_str = serde_json::to_string(&state_obj)
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "JSON error"))?;

        sqlx::query(
            "INSERT INTO boxes (canvas_id, box_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&canvas.id)
        .bind(box_id)
        .bind(&state_str)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
    }

    sqlx::query(
        "UPDATE canvases SET next_box_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .bind(body.next_box_id)
    .bind(&now)
    .bind(&canvas.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    tx.commit().await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    build_snapshot_response(&state.db, &canvas.id).await
}

/// Build a CanvasSnapshotResponse by re-reading from the database.
async fn build_snapshot_response(
    db: &sqlx::SqlitePool,
    canvas_id: &str,
) -> Result<Json<CanvasSnapshotResponse>, Response> {
    let canvas = sqlx::query_as::<_, CanvasRow>(
        "SELECT id, name, next_box_id, version, created_at, updated_at FROM canvases WHERE id = ?",
    )
    .bind(canvas_id)
    .fetch_one(db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let box_rows = sqlx::query_as::<_, BoxRow>(
        "SELECT canvas_id, box_id, state FROM boxes WHERE canvas_id = ? ORDER BY box_id",
    )
    .bind(canvas_id)
    .fetch_all(db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(CanvasSnapshotResponse {
        id: canvas.id,
        name: canvas.name,
        version: canvas.version,
        next_box_id: canvas.next_box_id,
        boxes: box_rows
            .iter()
            .map(|b| BoxResponse {
                box_id: b.box_id,
                state: parse_state(&b.state),
            })
            .collect(),
        created_at: canvas.created_at,
        updated_at: canvas.updated_at,
    }))
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

pub async fn create_share(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
    Json(body): Json<ShareCreateRequest>,
) -> Result<Response, Response> {
    check_pro_or_vip(&user)?;

    if body.permission != "read" && body.permission != "write" {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "permission must be 'read' or 'write'",
        ));
    }

    let _canvas = get_owned_canvas(&state.db, &canvas_id, &user.id).await?;

    let share_id = Uuid::new_v4().to_string();
    let share_token = Uuid::new_v4().as_simple().to_string(); // 32-char hex
    let now = now_sqlite();

    sqlx::query(
        "INSERT INTO canvas_shares (id, canvas_id, owner_user_id, share_token, permission, email, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&share_id)
    .bind(&canvas_id)
    .bind(&user.id)
    .bind(&share_token)
    .bind(&body.permission)
    .bind(&body.email)
    .bind(&now)
    .bind(&body.expires_at)
    .execute(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok((
        StatusCode::CREATED,
        Json(ShareResponse {
            id: share_id,
            share_token,
            permission: body.permission,
            email: body.email,
            created_at: now,
            expires_at: body.expires_at,
        }),
    )
        .into_response())
}

pub async fn list_shares(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(canvas_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;

    // If the canvas doesn't exist server-side, return empty list (not 404)
    let canvas_exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM canvases WHERE id = ? AND user_id = ?")
            .bind(&canvas_id)
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if canvas_exists.is_none() {
        return Ok(Json(ShareListResponse { shares: vec![] }));
    }

    let shares = sqlx::query_as::<_, ShareRow>(
        "SELECT id, canvas_id, owner_user_id, share_token, permission, email, created_at, expires_at
         FROM canvas_shares WHERE canvas_id = ? ORDER BY created_at DESC",
    )
    .bind(&canvas_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(Json(ShareListResponse {
        shares: shares
            .into_iter()
            .map(|s| ShareResponse {
                id: s.id,
                share_token: s.share_token,
                permission: s.permission,
                email: s.email,
                created_at: s.created_at,
                expires_at: s.expires_at,
            })
            .collect(),
    }))
}

pub async fn revoke_share(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_pro_or_vip(&user)?;

    let share = sqlx::query_as::<_, ShareRow>(
        "SELECT id, canvas_id, owner_user_id, share_token, permission, email, created_at, expires_at
         FROM canvas_shares WHERE share_token = ?",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "Share not found"))?;

    if share.owner_user_id != user.id {
        return Err(error_response(StatusCode::NOT_FOUND, "Share not found"));
    }

    sqlx::query("DELETE FROM canvas_shares WHERE id = ?")
        .bind(&share.id)
        .execute(&state.db)
        .await
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Validate a share token (PUBLIC endpoint, no auth required).
pub async fn validate_share(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let share = sqlx::query_as::<_, ShareRow>(
        "SELECT id, canvas_id, owner_user_id, share_token, permission, email, created_at, expires_at
         FROM canvas_shares WHERE share_token = ?",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| error_response(StatusCode::NOT_FOUND, "Share link not found"))?;

    // Check expiry
    if let Some(ref expires_at_str) = share.expires_at {
        if let Ok(expires_at) = NaiveDateTime::parse_from_str(expires_at_str, "%Y-%m-%d %H:%M:%S")
        {
            if expires_at < chrono::Utc::now().naive_utc() {
                return Err(error_response(StatusCode::GONE, "Share link has expired"));
            }
        }
    }

    Ok(Json(ShareValidateResponse {
        canvas_id: share.canvas_id,
        permission: share.permission,
    }))
}
