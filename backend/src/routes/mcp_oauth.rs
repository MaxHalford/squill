//! Minimal "null-auth" OAuth endpoints for MCP clients (desktop mode only).
//!
//! MCP clients (e.g. Claude Desktop) may force an OAuth flow when the user
//! clicks "re-authenticate". This module implements the bare minimum of
//! RFC 8414 (metadata), RFC 7591 (dynamic client registration), and
//! RFC 6749 (authorize + token) so the handshake succeeds without real auth.
//!
//! These endpoints are only registered when `Config::desktop_mode` is true,
//! meaning the server is running locally inside the Tauri desktop app.
//! They are never exposed on production deployments.

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect};
use axum::Json;
use lru::LruCache;
use serde::Deserialize;
use serde_json::json;
use std::num::NonZeroUsize;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use uuid::Uuid;

use crate::auth::jwt::create_session_token;
use crate::AppState;

/// In-memory store for issued authorization codes (valid for 5 minutes).
struct CodeEntry {
    redirect_uri: String,
    issued_at: Instant,
}

static CODE_STORE: LazyLock<Mutex<LruCache<String, CodeEntry>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(100).unwrap())));

const CODE_TTL_SECS: u64 = 300; // 5 minutes

/// Returns true if `uri` points to a loopback address.
fn is_loopback_uri(uri: &str) -> bool {
    uri.starts_with("http://localhost")
        || uri.starts_with("http://127.0.0.1")
        || uri.starts_with("http://[::1]")
}

/// GET /.well-known/oauth-authorization-server
///
/// Returns OAuth 2.0 Authorization Server Metadata (RFC 8414).
pub async fn metadata(
    req: axum::extract::Request,
) -> impl IntoResponse {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = if host.starts_with("localhost") || host.starts_with("127.0.0.1") {
        "http"
    } else {
        "https"
    };
    let base = format!("{scheme}://{host}");

    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/authorize"),
        "token_endpoint": format!("{base}/token"),
        "registration_endpoint": format!("{base}/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }))
}

/// GET /.well-known/oauth-protected-resource
///
/// Returns OAuth 2.0 Protected Resource Metadata (RFC 9728).
pub async fn protected_resource(
    req: axum::extract::Request,
) -> impl IntoResponse {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = if host.starts_with("localhost") || host.starts_with("127.0.0.1") {
        "http"
    } else {
        "https"
    };
    let base = format!("{scheme}://{host}");

    Json(json!({
        "resource": format!("{base}/mcp"),
        "authorization_servers": [base],
    }))
}

/// POST /register
///
/// Dynamic Client Registration (RFC 7591). Accepts anything, returns a new client_id.
pub async fn register() -> impl IntoResponse {
    let client_id = Uuid::new_v4().to_string();
    (
        http::StatusCode::CREATED,
        Json(json!({
            "client_id": client_id,
            "client_name": "MCP Client",
            "redirect_uris": [],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })),
    )
}

#[derive(Deserialize)]
pub struct AuthorizeParams {
    redirect_uri: String,
    state: Option<String>,
    #[allow(dead_code)]
    code_challenge: Option<String>,
    #[allow(dead_code)]
    code_challenge_method: Option<String>,
}

/// GET /authorize
///
/// Validates that redirect_uri is a loopback address, issues an authorization
/// code, stores it for later verification, then redirects back to the client.
pub async fn authorize(Query(params): Query<AuthorizeParams>) -> impl IntoResponse {
    // Only allow redirects to loopback addresses (desktop-mode defense-in-depth)
    if !is_loopback_uri(&params.redirect_uri) {
        return (
            http::StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "invalid_request",
                "error_description": "redirect_uri must be a loopback address"
            })),
        )
            .into_response();
    }

    let code = Uuid::new_v4().to_string();

    // Store the code for verification during token exchange
    {
        let mut store = CODE_STORE.lock().unwrap();
        store.put(
            code.clone(),
            CodeEntry {
                redirect_uri: params.redirect_uri.clone(),
                issued_at: Instant::now(),
            },
        );
    }

    let mut redirect = format!("{}?code={}", params.redirect_uri, code);
    if let Some(state) = params.state {
        redirect.push_str(&format!("&state={state}"));
    }
    Redirect::temporary(&redirect).into_response()
}

#[derive(Deserialize)]
pub struct TokenRequest {
    #[allow(dead_code)]
    grant_type: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    #[allow(dead_code)]
    code_verifier: Option<String>,
    #[allow(dead_code)]
    client_id: Option<String>,
}

/// POST /token
///
/// Validates the authorization code and redirect_uri, then issues a JWT
/// for the MCP local user.
pub async fn token(
    State(state): State<AppState>,
    axum::extract::Form(body): axum::extract::Form<TokenRequest>,
) -> impl IntoResponse {
    // Validate the authorization code
    let code = match &body.code {
        Some(c) => c.clone(),
        None => {
            return (
                http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "invalid_request",
                    "error_description": "missing code parameter"
                })),
            )
                .into_response();
        }
    };

    {
        let mut store = CODE_STORE.lock().unwrap();
        match store.pop(&code) {
            Some(entry) => {
                // Check code hasn't expired
                if entry.issued_at.elapsed().as_secs() > CODE_TTL_SECS {
                    return (
                        http::StatusCode::BAD_REQUEST,
                        Json(json!({
                            "error": "invalid_grant",
                            "error_description": "authorization code expired"
                        })),
                    )
                        .into_response();
                }

                // Verify redirect_uri matches what was used in /authorize
                if let Some(ref redirect_uri) = body.redirect_uri {
                    if *redirect_uri != entry.redirect_uri {
                        return (
                            http::StatusCode::BAD_REQUEST,
                            Json(json!({
                                "error": "invalid_grant",
                                "error_description": "redirect_uri mismatch"
                            })),
                        )
                            .into_response();
                    }
                }
            }
            None => {
                return (
                    http::StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "invalid_grant",
                        "error_description": "invalid or already-used authorization code"
                    })),
                )
                    .into_response();
            }
        }
    }

    let config = &state.config;
    let expires_in = config.jwt_expiration_days * 86400;

    match create_session_token(
        &config.mcp_user_id,
        "local@squill.desktop",
        &config.jwt_secret,
        config.jwt_expiration_days,
    ) {
        Ok(token) => Json(json!({
            "access_token": token,
            "token_type": "Bearer",
            "expires_in": expires_in,
        }))
        .into_response(),
        Err(_) => (
            http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "server_error",
                "error_description": "failed to issue token"
            })),
        )
            .into_response(),
    }
}
