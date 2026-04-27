//! In-memory WebSocket connection manager for real-time canvas collaboration.

use axum::extract::ws::Message;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::mpsc;
use tracing::warn;

/// Metadata about a single WebSocket connection.
pub struct ConnectionInfo {
    pub user_id: Option<String>,
    pub user_name: String,
    pub permission: String, // "read" or "write"
    pub client_id: String,
    pub tx: mpsc::UnboundedSender<Message>,
}

/// Presence entry returned by `get_presence`.
#[derive(Serialize)]
pub struct PresenceEntry {
    pub user_id: Option<String>,
    pub name: String,
    pub client_id: String,
    pub permission: String,
}

/// Manages WebSocket connections grouped by canvas (room).
pub struct WsManager {
    /// canvas_id -> client_id -> ConnectionInfo
    rooms: Mutex<HashMap<String, HashMap<String, ConnectionInfo>>>,
}

impl WsManager {
    pub fn new() -> Self {
        Self {
            rooms: Mutex::new(HashMap::new()),
        }
    }

    /// Register a new connection in a canvas room.
    pub fn connect(&self, canvas_id: &str, client_id: &str, info: ConnectionInfo) {
        let mut rooms = self.rooms.lock().unwrap();
        rooms
            .entry(canvas_id.to_string())
            .or_default()
            .insert(client_id.to_string(), info);
    }

    /// Remove a connection from a canvas room.
    pub fn disconnect(&self, canvas_id: &str, client_id: &str) {
        let mut rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get_mut(canvas_id) {
            room.remove(client_id);
            if room.is_empty() {
                rooms.remove(canvas_id);
            }
        }
    }

    /// Broadcast a JSON message to all connections in a room except `exclude_client_id`.
    pub fn broadcast(&self, canvas_id: &str, message_json: &str, exclude_client_id: Option<&str>) {
        let rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get(canvas_id) {
            for (cid, info) in room {
                if exclude_client_id == Some(cid.as_str()) {
                    continue;
                }
                if info.tx.send(Message::Text(message_json.into())).is_err() {
                    warn!("Failed to send to client {cid} in canvas {canvas_id}");
                }
            }
        }
    }

    /// Send a message to a specific client in a room.
    pub fn send_to(
        &self,
        canvas_id: &str,
        client_id: &str,
        message_json: &str,
    ) {
        let rooms = self.rooms.lock().unwrap();
        if let Some(room) = rooms.get(canvas_id) {
            if let Some(info) = room.get(client_id) {
                if info.tx.send(Message::Text(message_json.into())).is_err() {
                    warn!("Failed to send to client {client_id} in canvas {canvas_id}");
                }
            }
        }
    }

    /// Return the list of currently connected users for a canvas.
    pub fn get_presence(&self, canvas_id: &str) -> Vec<PresenceEntry> {
        let rooms = self.rooms.lock().unwrap();
        rooms
            .get(canvas_id)
            .map(|room| {
                room.values()
                    .map(|info| PresenceEntry {
                        user_id: info.user_id.clone(),
                        name: info.user_name.clone(),
                        client_id: info.client_id.clone(),
                        permission: info.permission.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}
