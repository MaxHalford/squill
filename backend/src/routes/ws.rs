//! WebSocket endpoint for real-time canvas collaboration.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use chrono::{NaiveDateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::auth::jwt::verify_session_token;
use crate::auth::middleware::UserRow;
use crate::services::ws_manager::ConnectionInfo;
use crate::AppState;

// ---------------------------------------------------------------------------
// Row types (local to this module)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct CanvasRow {
    id: String,
    name: String,
    next_box_id: i64,
    version: i64,
    #[allow(dead_code)]
    user_id: String,
}

#[derive(sqlx::FromRow)]
struct BoxRow {
    box_id: i64,
    state: String,
}

#[derive(sqlx::FromRow)]
struct ShareRow {
    canvas_id: String,
    #[allow(dead_code)]
    share_token: String,
    permission: String,
    email: Option<String>,
    expires_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Auth result
// ---------------------------------------------------------------------------

struct WsAuth {
    user_id: Option<String>,
    user_name: String,
    permission: String,
}

/// Authenticate a WebSocket connection via query-param token.
///
/// 1. Try JWT: verify token, load user, check canvas ownership -> write
/// 2. If JWT user exists but doesn't own canvas: check email-based CanvasShare
/// 3. If JWT fails: try as share_token -> anonymous with share permission
async fn authenticate(
    db: &sqlx::SqlitePool,
    jwt_secret: &str,
    canvas_id: &str,
    token: &str,
) -> Result<WsAuth, &'static str> {
    // --- Attempt JWT auth ---
    if let Ok(claims) = verify_session_token(token, jwt_secret) {
        // Load user from DB
        let user: Option<UserRow> = sqlx::query_as(
            "SELECT id, email, first_name, last_name, plan, plan_expires_at, is_vip,
                    polar_customer_id, polar_subscription_id, subscription_cancel_at_period_end
             FROM users WHERE id = ?",
        )
        .bind(&claims.user_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();

        if let Some(user) = user {
            let display_name = match (&user.first_name, &user.last_name) {
                (Some(f), Some(l)) if !f.is_empty() => format!("{f} {l}"),
                (Some(f), _) if !f.is_empty() => f.clone(),
                _ => user.email.clone(),
            };

            // Check if user owns the canvas
            let owns: bool = sqlx::query_scalar(
                "SELECT COUNT(*) > 0 FROM canvases WHERE id = ? AND user_id = ?",
            )
            .bind(canvas_id)
            .bind(&user.id)
            .fetch_one(db)
            .await
            .unwrap_or(false);

            if owns {
                return Ok(WsAuth {
                    user_id: Some(user.id),
                    user_name: display_name,
                    permission: "write".to_string(),
                });
            }

            // Not the owner — check email-based shares
            let share: Option<ShareRow> = sqlx::query_as(
                "SELECT canvas_id, share_token, permission, email, expires_at
                 FROM canvas_shares WHERE canvas_id = ? AND email = ?",
            )
            .bind(canvas_id)
            .bind(&user.email)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();

            if let Some(share) = share {
                if !is_expired(&share.expires_at) {
                    return Ok(WsAuth {
                        user_id: Some(user.id),
                        user_name: display_name,
                        permission: share.permission,
                    });
                }
            }

            return Err("No access to this canvas");
        }
    }

    // --- JWT failed or user not found: try as share_token ---
    let share: Option<ShareRow> = sqlx::query_as(
        "SELECT canvas_id, share_token, permission, email, expires_at
         FROM canvas_shares WHERE share_token = ?",
    )
    .bind(token)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    match share {
        Some(share) => {
            // Verify this share is for the right canvas
            if share.canvas_id != canvas_id {
                return Err("Share token does not match canvas");
            }
            // Check expiry
            if is_expired(&share.expires_at) {
                return Err("Share link has expired");
            }
            // Email-restricted shares cannot be used anonymously
            if share.email.is_some() {
                return Err("This share link requires authentication");
            }
            Ok(WsAuth {
                user_id: None,
                user_name: "Anonymous".to_string(),
                permission: share.permission,
            })
        }
        None => Err("Invalid token"),
    }
}

fn is_expired(expires_at: &Option<String>) -> bool {
    if let Some(s) = expires_at {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
            return dt < Utc::now().naive_utc();
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

/// `GET /ws/canvas/{canvas_id}?token=...`
pub async fn canvas_websocket(
    ws: WebSocketUpgrade,
    Path(canvas_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").cloned().unwrap_or_default();

    // Authenticate before upgrading
    let auth = match authenticate(&state.db, &state.config.jwt_secret, &canvas_id, &token).await {
        Ok(a) => a,
        Err(reason) => {
            warn!("WS auth failed for canvas {canvas_id}: {reason}");
            // Close with 4001 by returning a close frame in the upgrade handler
            return ws.on_upgrade(move |mut socket| async move {
                let _ = socket
                    .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                        code: 4001,
                        reason: reason.into(),
                    })))
                    .await;
            });
        }
    };

    ws.on_upgrade(move |socket| handle_socket(socket, canvas_id, auth, state))
}

// ---------------------------------------------------------------------------
// Socket handler
// ---------------------------------------------------------------------------

async fn handle_socket(socket: WebSocket, canvas_id: String, auth: WsAuth, state: AppState) {
    let client_id = uuid::Uuid::new_v4().to_string();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Register in WsManager
    let info = ConnectionInfo {
        user_id: auth.user_id.clone(),
        user_name: auth.user_name.clone(),
        permission: auth.permission.clone(),
        client_id: client_id.clone(),
        tx,
    };
    state.ws_manager.connect(&canvas_id, &client_id, info);

    info!(
        "WS connected: canvas={canvas_id} client={client_id} user={:?} perm={}",
        auth.user_id, auth.permission
    );

    // Spawn sender task: forwards messages from the mpsc channel to the WebSocket
    use futures_util::SinkExt;
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Send initial snapshot
    if let Ok(snapshot) = build_snapshot(&state.db, &canvas_id).await {
        let msg = json!({ "type": "snapshot", "data": snapshot });
        state
            .ws_manager
            .send_to(&canvas_id, &client_id, &msg.to_string());
    }

    // Broadcast presence.joined
    let joined_msg = json!({
        "type": "presence.joined",
        "data": {
            "user_id": auth.user_id,
            "name": auth.user_name,
            "client_id": client_id,
        }
    });
    state
        .ws_manager
        .broadcast(&canvas_id, &joined_msg.to_string(), Some(&client_id));

    // Message loop with 90s timeout (heartbeat)
    use futures_util::StreamExt;
    loop {
        let recv = tokio::time::timeout(Duration::from_secs(90), ws_receiver.next());
        match recv.await {
            Ok(Some(Ok(msg))) => {
                match msg {
                    Message::Text(text) => {
                        handle_text_message(
                            &text,
                            &canvas_id,
                            &client_id,
                            &auth,
                            &state,
                        )
                        .await;
                    }
                    Message::Close(_) => break,
                    Message::Ping(data) => {
                        // Axum auto-responds to pings, but we still handle the frame
                        let _ = state.ws_manager.send_to(
                            &canvas_id,
                            &client_id,
                            &Message::Pong(data).into_text().unwrap_or_default(),
                        );
                    }
                    _ => {} // Binary, Pong — ignore
                }
            }
            Ok(Some(Err(_))) => break,   // WebSocket error
            Ok(None) => break,           // Stream ended
            Err(_) => break,             // 90s timeout
        }
    }

    // Cleanup
    state.ws_manager.disconnect(&canvas_id, &client_id);
    send_task.abort();

    let left_msg = json!({
        "type": "presence.left",
        "data": {
            "user_id": auth.user_id,
            "client_id": client_id,
        }
    });
    state
        .ws_manager
        .broadcast(&canvas_id, &left_msg.to_string(), None);

    info!("WS disconnected: canvas={canvas_id} client={client_id}");
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async fn handle_text_message(
    text: &str,
    canvas_id: &str,
    client_id: &str,
    auth: &WsAuth,
    state: &AppState,
) {
    let msg: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            send_error(state, canvas_id, client_id, "Invalid JSON", "parse_error");
            return;
        }
    };

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let data = msg.get("data").cloned().unwrap_or(Value::Null);

    match msg_type {
        "ping" => {
            state
                .ws_manager
                .send_to(canvas_id, client_id, &json!({"type": "pong"}).to_string());
        }

        "cursor.move" => {
            // Cursor moves don't require write permission
            let out = json!({
                "type": "cursor.moved",
                "data": {
                    "x": data.get("x"),
                    "y": data.get("y"),
                    "color": data.get("color"),
                    "name": data.get("name"),
                    "user_id": auth.user_id,
                    "client_id": client_id,
                }
            });
            state
                .ws_manager
                .broadcast(canvas_id, &out.to_string(), Some(client_id));
        }

        "box.create" | "box.update" | "box.delete" | "box.batch_update" => {
            if auth.permission != "write" {
                send_error(state, canvas_id, client_id, "Read-only access", "readonly");
                return;
            }
            match msg_type {
                "box.create" => handle_box_create(canvas_id, client_id, auth, state, &data).await,
                "box.update" => handle_box_update(canvas_id, client_id, auth, state, &data).await,
                "box.delete" => handle_box_delete(canvas_id, client_id, auth, state, &data).await,
                "box.batch_update" => {
                    handle_box_batch_update(canvas_id, client_id, auth, state, &data).await
                }
                _ => unreachable!(),
            }
        }

        _ => {
            send_error(
                state,
                canvas_id,
                client_id,
                &format!("Unknown message type: {msg_type}"),
                "unknown_type",
            );
        }
    }
}

fn send_error(state: &AppState, canvas_id: &str, client_id: &str, message: &str, code: &str) {
    let msg = json!({
        "type": "error",
        "data": { "message": message, "code": code }
    });
    state
        .ws_manager
        .send_to(canvas_id, client_id, &msg.to_string());
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async fn handle_box_create(
    canvas_id: &str,
    client_id: &str,
    auth: &WsAuth,
    state: &AppState,
    data: &Value,
) {
    let db = &state.db;

    // Get canvas for next_box_id
    let canvas: Option<CanvasRow> = sqlx::query_as(
        "SELECT id, name, next_box_id, version, user_id FROM canvases WHERE id = ?",
    )
    .bind(canvas_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let Some(canvas) = canvas else {
        send_error(state, canvas_id, client_id, "Canvas not found", "not_found");
        return;
    };

    let box_id = canvas.next_box_id;
    let state_str = data.to_string();
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Insert box
    if sqlx::query(
        "INSERT INTO boxes (canvas_id, box_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(canvas_id)
    .bind(box_id)
    .bind(&state_str)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await
    .is_err()
    {
        send_error(state, canvas_id, client_id, "Failed to create box", "db_error");
        return;
    }

    // Increment version and next_box_id
    let _ = sqlx::query(
        "UPDATE canvases SET next_box_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .bind(box_id + 1)
    .bind(&now)
    .bind(canvas_id)
    .execute(db)
    .await;

    let new_version = canvas.version + 1;

    let out = json!({
        "type": "box.created",
        "data": { "box_id": box_id, "state": data },
        "version": new_version,
        "by": auth.user_id,
        "client_id": client_id,
    });

    // Echo back to sender AND broadcast to others
    let out_str = out.to_string();
    state.ws_manager.broadcast(canvas_id, &out_str, None);
}

async fn handle_box_update(
    canvas_id: &str,
    client_id: &str,
    auth: &WsAuth,
    state: &AppState,
    data: &Value,
) {
    let db = &state.db;

    let box_id = match data.get("box_id").and_then(|v| v.as_i64()) {
        Some(id) => id,
        None => {
            send_error(state, canvas_id, client_id, "Missing box_id", "bad_request");
            return;
        }
    };

    let fields = match data.get("fields") {
        Some(f) if f.is_object() => f,
        _ => {
            send_error(state, canvas_id, client_id, "Missing or invalid fields", "bad_request");
            return;
        }
    };

    // Load existing box
    let box_row: Option<BoxRow> = sqlx::query_as(
        "SELECT box_id, state FROM boxes WHERE canvas_id = ? AND box_id = ?",
    )
    .bind(canvas_id)
    .bind(box_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let Some(box_row) = box_row else {
        send_error(state, canvas_id, client_id, "Box not found", "not_found");
        return;
    };

    // Merge fields
    let mut existing: Value =
        serde_json::from_str(&box_row.state).unwrap_or(Value::Object(Default::default()));
    if let (Some(existing_map), Some(fields_map)) =
        (existing.as_object_mut(), fields.as_object())
    {
        for (k, v) in fields_map {
            existing_map.insert(k.clone(), v.clone());
        }
    }

    let merged_str = existing.to_string();
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if sqlx::query("UPDATE boxes SET state = ?, updated_at = ? WHERE canvas_id = ? AND box_id = ?")
        .bind(&merged_str)
        .bind(&now)
        .bind(canvas_id)
        .bind(box_id)
        .execute(db)
        .await
        .is_err()
    {
        send_error(state, canvas_id, client_id, "Failed to update box", "db_error");
        return;
    }

    let _ = sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(canvas_id)
        .execute(db)
        .await;

    let new_version = fetch_version(db, canvas_id).await;

    let out = json!({
        "type": "box.updated",
        "data": { "box_id": box_id, "fields": fields },
        "version": new_version,
        "by": auth.user_id,
        "client_id": client_id,
    });
    state
        .ws_manager
        .broadcast(canvas_id, &out.to_string(), Some(client_id));
}

async fn handle_box_delete(
    canvas_id: &str,
    client_id: &str,
    auth: &WsAuth,
    state: &AppState,
    data: &Value,
) {
    let db = &state.db;

    let box_id = match data.get("box_id").and_then(|v| v.as_i64()) {
        Some(id) => id,
        None => {
            send_error(state, canvas_id, client_id, "Missing box_id", "bad_request");
            return;
        }
    };

    let result = sqlx::query("DELETE FROM boxes WHERE canvas_id = ? AND box_id = ?")
        .bind(canvas_id)
        .bind(box_id)
        .execute(db)
        .await;

    match result {
        Ok(r) if r.rows_affected() == 0 => {
            send_error(state, canvas_id, client_id, "Box not found", "not_found");
            return;
        }
        Err(_) => {
            send_error(state, canvas_id, client_id, "Failed to delete box", "db_error");
            return;
        }
        _ => {}
    }

    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(canvas_id)
        .execute(db)
        .await;

    let new_version = fetch_version(db, canvas_id).await;

    let out = json!({
        "type": "box.deleted",
        "data": { "box_id": box_id },
        "version": new_version,
        "by": auth.user_id,
        "client_id": client_id,
    });
    state
        .ws_manager
        .broadcast(canvas_id, &out.to_string(), Some(client_id));
}

async fn handle_box_batch_update(
    canvas_id: &str,
    client_id: &str,
    auth: &WsAuth,
    state: &AppState,
    data: &Value,
) {
    let db = &state.db;

    let updates = match data.get("updates").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            send_error(state, canvas_id, client_id, "Missing updates array", "bad_request");
            return;
        }
    };

    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut applied: Vec<Value> = Vec::new();

    for item in updates {
        let box_id = match item.get("box_id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => continue,
        };
        let fields = match item.get("fields") {
            Some(f) if f.is_object() => f,
            _ => continue,
        };

        let box_row: Option<BoxRow> = sqlx::query_as(
            "SELECT box_id, state FROM boxes WHERE canvas_id = ? AND box_id = ?",
        )
        .bind(canvas_id)
        .bind(box_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();

        if let Some(box_row) = box_row {
            let mut existing: Value =
                serde_json::from_str(&box_row.state).unwrap_or(Value::Object(Default::default()));
            if let (Some(existing_map), Some(fields_map)) =
                (existing.as_object_mut(), fields.as_object())
            {
                for (k, v) in fields_map {
                    existing_map.insert(k.clone(), v.clone());
                }
            }

            let merged_str = existing.to_string();
            let _ = sqlx::query(
                "UPDATE boxes SET state = ?, updated_at = ? WHERE canvas_id = ? AND box_id = ?",
            )
            .bind(&merged_str)
            .bind(&now)
            .bind(canvas_id)
            .bind(box_id)
            .execute(db)
            .await;

            applied.push(json!({ "box_id": box_id, "fields": fields }));
        }
    }

    let _ = sqlx::query("UPDATE canvases SET version = version + 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(canvas_id)
        .execute(db)
        .await;

    let new_version = fetch_version(db, canvas_id).await;

    let out = json!({
        "type": "box.batch_updated",
        "data": { "updates": applied },
        "version": new_version,
        "by": auth.user_id,
        "client_id": client_id,
    });
    state
        .ws_manager
        .broadcast(canvas_id, &out.to_string(), Some(client_id));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn build_snapshot(db: &sqlx::SqlitePool, canvas_id: &str) -> Result<Value, ()> {
    let canvas: CanvasRow = sqlx::query_as(
        "SELECT id, name, next_box_id, version, user_id FROM canvases WHERE id = ?",
    )
    .bind(canvas_id)
    .fetch_one(db)
    .await
    .map_err(|_| ())?;

    let boxes: Vec<BoxRow> = sqlx::query_as(
        "SELECT box_id, state FROM boxes WHERE canvas_id = ? ORDER BY box_id",
    )
    .bind(canvas_id)
    .fetch_all(db)
    .await
    .map_err(|_| ())?;

    let box_entries: Vec<Value> = boxes
        .iter()
        .map(|b| {
            let state: Value =
                serde_json::from_str(&b.state).unwrap_or(Value::Object(Default::default()));
            json!({ "box_id": b.box_id, "state": state })
        })
        .collect();

    Ok(json!({
        "id": canvas.id,
        "name": canvas.name,
        "version": canvas.version,
        "next_box_id": canvas.next_box_id,
        "boxes": box_entries,
    }))
}

async fn fetch_version(db: &sqlx::SqlitePool, canvas_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT version FROM canvases WHERE id = ?")
        .bind(canvas_id)
        .fetch_one(db)
        .await
        .unwrap_or(0)
}
