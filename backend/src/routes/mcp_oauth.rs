//! Minimal "null-auth" OAuth endpoints for MCP clients.
//!
//! MCP clients (e.g. Claude Desktop) may force an OAuth flow when the user
//! clicks "re-authenticate". This module implements the bare minimum of
//! RFC 8414 (metadata), RFC 7591 (dynamic client registration), and
//! RFC 6749 (authorize + token) so the handshake succeeds without real auth.

use axum::extract::Query;
use axum::response::{IntoResponse, Redirect};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

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
/// Immediately redirects back to the client with an authorization code.
/// No login page — this is a local server with no real auth.
pub async fn authorize(Query(params): Query<AuthorizeParams>) -> impl IntoResponse {
    let code = Uuid::new_v4().to_string();
    let mut redirect = format!("{}?code={}", params.redirect_uri, code);
    if let Some(state) = params.state {
        redirect.push_str(&format!("&state={state}"));
    }
    Redirect::temporary(&redirect)
}

#[derive(Deserialize)]
pub struct TokenRequest {
    #[allow(dead_code)]
    grant_type: Option<String>,
    #[allow(dead_code)]
    code: Option<String>,
    #[allow(dead_code)]
    redirect_uri: Option<String>,
    #[allow(dead_code)]
    code_verifier: Option<String>,
    #[allow(dead_code)]
    client_id: Option<String>,
}

/// POST /token
///
/// Exchanges the authorization code for an access token.
/// Always succeeds — no real validation needed for local null-auth.
pub async fn token(
    axum::extract::Form(_body): axum::extract::Form<TokenRequest>,
) -> impl IntoResponse {
    Json(json!({
        "access_token": Uuid::new_v4().to_string(),
        "token_type": "Bearer",
        "expires_in": 3600,
    }))
}
