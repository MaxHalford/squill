//! OAuth 2.1 + PKCE endpoints for MCP clients.
//!
//! Two operating modes share the same routes:
//!
//! * **Production** (`config.desktop_mode == false`): real OAuth. Pro/VIP users
//!   complete a consent flow in the browser; the issued JWT is scoped to their
//!   actual user_id, and refresh tokens rotate per OAuth 2.1 (RFC 6749 §10.4).
//!
//! * **Desktop** (`config.desktop_mode == true`, Tauri loopback): the
//!   `authorize` and `token` handlers short-circuit to issue a JWT for
//!   `config.mcp_user_id` without consent — the original null-auth shim,
//!   safe because the server only listens on loopback.
//!
//! All `/oauth/*` and `/.well-known/*` responses use the RFC 6749 §5.2 error
//! envelope `{error, error_description}` so MCP clients can parse failures.

use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::jwt::create_session_token;
use crate::auth::middleware::{AuthUser, UserRow};
use crate::AppState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_CODE_TTL_SECS: i64 = 300; // 5 minutes
const PENDING_REQUEST_TTL_SECS: i64 = 600; // 10 minutes
const REFRESH_TOKEN_TTL_SECS: i64 = 90 * 86400; // 90 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn b64url() -> &'static base64::engine::general_purpose::GeneralPurpose {
    &base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// Build the externally-visible base URL for the server, honoring
/// `X-Forwarded-Proto` (Railway and most reverse proxies set it).
fn issuer_base(req_headers: &http::HeaderMap) -> String {
    let host = req_headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = req_headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if host.starts_with("localhost") || host.starts_with("127.0.0.1") {
                "http".into()
            } else {
                "https".into()
            }
        });
    format!("{scheme}://{host}")
}

fn now_plus_secs_sqlite(secs: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(secs))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn is_loopback_host(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']');
    h == "127.0.0.1" || h == "::1" || h == "localhost"
}

/// RFC 8252-compliant redirect_uri match: exact equality, OR both URIs are
/// loopback HTTP with the same scheme/host-class/path (port may differ).
fn redirect_uri_matches(registered: &str, requested: &str) -> bool {
    if registered == requested {
        return true;
    }
    let r = match registered.parse::<http::Uri>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    let q = match requested.parse::<http::Uri>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    let (Some(rh), Some(qh)) = (r.host(), q.host()) else {
        return false;
    };
    if !is_loopback_host(rh) || !is_loopback_host(qh) {
        return false;
    }
    if r.scheme_str() != q.scheme_str() {
        return false;
    }
    let rp = r.path().trim_end_matches('/');
    let qp = q.path().trim_end_matches('/');
    rp == qp
}

fn parse_redirect_uris(json_str: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json_str).unwrap_or_default()
}

fn random_token_b64url(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    b64url().encode(&buf)
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn pkce_compute_s256_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    b64url().encode(hasher.finalize())
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..ab.len() {
        diff |= ab[i] ^ bb[i];
    }
    diff == 0
}

fn oauth_error(
    status: http::StatusCode,
    error: &str,
    description: &str,
) -> Response {
    (
        status,
        Json(json!({
            "error": error,
            "error_description": description,
        })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// GET /.well-known/oauth-authorization-server
// ---------------------------------------------------------------------------

pub async fn metadata(req: axum::extract::Request) -> Response {
    let base = issuer_base(req.headers());
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/oauth/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["mcp"],
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// GET /.well-known/oauth-protected-resource
// ---------------------------------------------------------------------------

pub async fn protected_resource(req: axum::extract::Request) -> Response {
    let base = issuer_base(req.headers());
    Json(json!({
        "resource": format!("{base}/mcp"),
        "authorization_servers": [base],
        "scopes_supported": ["mcp"],
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// POST /oauth/register
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RegisterRequest {
    #[serde(default)]
    redirect_uris: Vec<String>,
    #[serde(default)]
    client_name: Option<String>,
    #[serde(default, rename = "token_endpoint_auth_method")]
    _token_endpoint_auth_method: Option<String>,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Response {
    if body.redirect_uris.is_empty() {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "redirect_uris must be a non-empty array",
        );
    }
    for uri in &body.redirect_uris {
        let parsed = match uri.parse::<http::Uri>() {
            Ok(u) => u,
            Err(_) => {
                return oauth_error(
                    http::StatusCode::BAD_REQUEST,
                    "invalid_redirect_uri",
                    "redirect_uri must be a valid URI",
                );
            }
        };
        let scheme = parsed.scheme_str().unwrap_or("");
        let host = parsed.host().unwrap_or("");
        if scheme == "http" && !is_loopback_host(host) {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_redirect_uri",
                "non-loopback redirect_uri must use https",
            );
        }
        if scheme != "http" && scheme != "https" {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_redirect_uri",
                "redirect_uri scheme must be http or https",
            );
        }
    }

    let client_id = Uuid::new_v4().to_string();
    let redirect_uris_json = serde_json::to_string(&body.redirect_uris).unwrap_or_else(|_| "[]".into());
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Err(e) = sqlx::query(
        "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, 'none', ?)",
    )
    .bind(&client_id)
    .bind(body.client_name.as_deref())
    .bind(&redirect_uris_json)
    .bind(&now)
    .execute(&state.db)
    .await
    {
        tracing::error!("oauth_clients insert failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "failed to register client",
        );
    }

    (
        http::StatusCode::CREATED,
        Json(json!({
            "client_id": client_id,
            "client_id_issued_at": chrono::Utc::now().timestamp(),
            "client_name": body.client_name,
            "redirect_uris": body.redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// GET /oauth/authorize
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AuthorizeParams {
    response_type: Option<String>,
    client_id: Option<String>,
    redirect_uri: Option<String>,
    state: Option<String>,
    scope: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
}

#[derive(sqlx::FromRow)]
struct OauthClientRow {
    #[sqlx(rename = "client_id")]
    _client_id: String,
    client_name: Option<String>,
    redirect_uris: String,
}

pub async fn authorize_get(
    State(state): State<AppState>,
    Query(params): Query<AuthorizeParams>,
) -> Response {
    if params.response_type.as_deref() != Some("code") {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "unsupported_response_type",
            "response_type must be 'code'",
        );
    }
    let Some(client_id) = params.client_id.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing client_id",
        );
    };
    let Some(redirect_uri) = params.redirect_uri.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing redirect_uri",
        );
    };
    if params.code_challenge_method.as_deref() != Some("S256") {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "code_challenge_method must be S256",
        );
    }
    let Some(code_challenge) = params.code_challenge.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing code_challenge",
        );
    };

    // Desktop short-circuit: validate loopback redirect_uri, mint code for the
    // local user, redirect immediately. No consent UI, no client lookup.
    if state.config.desktop_mode {
        let parsed = match redirect_uri.parse::<http::Uri>() {
            Ok(u) => u,
            Err(_) => {
                return oauth_error(
                    http::StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "redirect_uri is not a valid URI",
                );
            }
        };
        let host = parsed.host().unwrap_or("");
        if !is_loopback_host(host) {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_request",
                "redirect_uri must be a loopback address in desktop mode",
            );
        }
        // Ensure a placeholder client row exists so the FK on oauth_codes holds.
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, 'none', datetime('now'))",
        )
        .bind(&client_id)
        .bind("Desktop MCP Client")
        .bind(serde_json::to_string(&[redirect_uri.clone()]).unwrap_or_else(|_| "[]".into()))
        .execute(&state.db)
        .await;

        let code = Uuid::new_v4().to_string();
        if let Err(e) = sqlx::query(
            "INSERT INTO oauth_codes (code, user_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used) VALUES (?, ?, ?, ?, ?, 'S256', ?, ?, 0)",
        )
        .bind(&code)
        .bind(&state.config.mcp_user_id)
        .bind(&client_id)
        .bind(&redirect_uri)
        .bind(&code_challenge)
        .bind(params.scope.as_deref())
        .bind(now_plus_secs_sqlite(AUTH_CODE_TTL_SECS))
        .execute(&state.db)
        .await
        {
            tracing::error!("oauth_codes insert (desktop) failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to issue authorization code",
            );
        }

        let mut redirect = format!("{}?code={}", redirect_uri, code);
        if let Some(s) = params.state.as_deref() {
            redirect.push_str(&format!("&state={}", urlencoding::encode_minimal(s)));
        }
        return Redirect::temporary(&redirect).into_response();
    }

    // Production: load registered client, validate redirect_uri, persist a
    // pending request, redirect to the frontend consent page.
    let client: Option<OauthClientRow> = match sqlx::query_as(
        "SELECT client_id AS _client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?",
    )
    .bind(&client_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("oauth_clients lookup failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "client lookup failed",
            );
        }
    };
    let Some(client) = client else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_client",
            "unknown client_id",
        );
    };
    let registered = parse_redirect_uris(&client.redirect_uris);
    if !registered.iter().any(|u| redirect_uri_matches(u, &redirect_uri)) {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "redirect_uri does not match a registered URI",
        );
    }

    let request_id = Uuid::new_v4().to_string();
    if let Err(e) = sqlx::query(
        "INSERT INTO oauth_pending_requests (request_id, client_id, redirect_uri, state, scope, code_challenge, code_challenge_method, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'S256', ?)",
    )
    .bind(&request_id)
    .bind(&client_id)
    .bind(&redirect_uri)
    .bind(params.state.as_deref())
    .bind(params.scope.as_deref())
    .bind(&code_challenge)
    .bind(now_plus_secs_sqlite(PENDING_REQUEST_TTL_SECS))
    .execute(&state.db)
    .await
    {
        tracing::error!("oauth_pending_requests insert failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "failed to start authorization request",
        );
    }

    let _ = client.client_name;
    let consent = format!(
        "{}/oauth/consent?request_id={}",
        state.config.frontend_url.trim_end_matches('/'),
        request_id,
    );
    Redirect::temporary(&consent).into_response()
}

// ---------------------------------------------------------------------------
// GET /oauth/pending/{request_id}  (authenticated)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct PendingRow {
    client_id: String,
    redirect_uri: String,
    scope: Option<String>,
    expires_at: chrono::NaiveDateTime,
}

#[derive(Serialize)]
pub struct PendingResponse {
    client_name: Option<String>,
    redirect_uri_host: String,
    scope: Option<String>,
}

pub async fn pending_get(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(request_id): Path<String>,
) -> Response {
    if state.config.desktop_mode {
        return oauth_error(
            http::StatusCode::NOT_FOUND,
            "not_found",
            "endpoint disabled in desktop mode",
        );
    }
    let pending: Option<PendingRow> = match sqlx::query_as(
        "SELECT client_id, redirect_uri, scope, expires_at FROM oauth_pending_requests WHERE request_id = ?",
    )
    .bind(&request_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("oauth_pending_requests lookup failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "lookup failed",
            );
        }
    };
    let Some(pending) = pending else {
        return oauth_error(
            http::StatusCode::NOT_FOUND,
            "not_found",
            "unknown or expired request_id",
        );
    };
    if pending.expires_at < chrono::Utc::now().naive_utc() {
        return oauth_error(
            http::StatusCode::GONE,
            "expired",
            "authorization request has expired",
        );
    }

    let client_name: Option<String> =
        sqlx::query_scalar("SELECT client_name FROM oauth_clients WHERE client_id = ?")
            .bind(&pending.client_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();

    let host = pending
        .redirect_uri
        .parse::<http::Uri>()
        .ok()
        .and_then(|u| {
            let host = u.host()?.to_string();
            let port = u.port_u16().map(|p| format!(":{p}")).unwrap_or_default();
            Some(format!("{host}{port}"))
        })
        .unwrap_or_else(|| "<unknown>".to_string());

    Json(PendingResponse {
        client_name,
        redirect_uri_host: host,
        scope: pending.scope,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// POST /oauth/authorize/confirm  (authenticated)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConfirmRequest {
    request_id: String,
    decision: String, // "allow" | "deny"
}

#[derive(Serialize)]
pub struct ConfirmResponse {
    redirect_url: String,
}

#[derive(sqlx::FromRow)]
struct PendingFullRow {
    client_id: String,
    redirect_uri: String,
    state: Option<String>,
    scope: Option<String>,
    code_challenge: String,
    expires_at: chrono::NaiveDateTime,
}

pub async fn authorize_confirm(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(body): Json<ConfirmRequest>,
) -> Response {
    if state.config.desktop_mode {
        return oauth_error(
            http::StatusCode::NOT_FOUND,
            "not_found",
            "endpoint disabled in desktop mode",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("tx begin failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "transaction error",
            );
        }
    };

    let pending: Option<PendingFullRow> = match sqlx::query_as(
        "SELECT client_id, redirect_uri, state, scope, code_challenge, expires_at FROM oauth_pending_requests WHERE request_id = ?",
    )
    .bind(&body.request_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("oauth_pending_requests lookup failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "lookup failed",
            );
        }
    };
    let Some(pending) = pending else {
        return oauth_error(
            http::StatusCode::NOT_FOUND,
            "not_found",
            "unknown or expired request_id",
        );
    };
    if pending.expires_at < chrono::Utc::now().naive_utc() {
        let _ = sqlx::query("DELETE FROM oauth_pending_requests WHERE request_id = ?")
            .bind(&body.request_id)
            .execute(&mut *tx)
            .await;
        let _ = tx.commit().await;
        return oauth_error(
            http::StatusCode::GONE,
            "expired",
            "authorization request has expired",
        );
    }

    // Always consume the pending row (deny or allow).
    if let Err(e) = sqlx::query("DELETE FROM oauth_pending_requests WHERE request_id = ?")
        .bind(&body.request_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!("oauth_pending_requests delete failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "delete failed",
        );
    }

    let state_param = pending
        .state
        .as_deref()
        .map(|s| format!("&state={}", urlencoding::encode_minimal(s)))
        .unwrap_or_default();

    if body.decision != "allow" {
        let url = format!(
            "{}?error=access_denied{}",
            pending.redirect_uri, state_param
        );
        let _ = tx.commit().await;
        return Json(ConfirmResponse { redirect_url: url }).into_response();
    }

    if !is_pro_or_vip(&user) {
        let _ = tx.commit().await;
        return oauth_error(
            http::StatusCode::FORBIDDEN,
            "access_denied",
            "Pro subscription required to grant MCP access",
        );
    }

    let code = Uuid::new_v4().to_string();
    if let Err(e) = sqlx::query(
        "INSERT INTO oauth_codes (code, user_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used) VALUES (?, ?, ?, ?, ?, 'S256', ?, ?, 0)",
    )
    .bind(&code)
    .bind(&user.id)
    .bind(&pending.client_id)
    .bind(&pending.redirect_uri)
    .bind(&pending.code_challenge)
    .bind(pending.scope.as_deref())
    .bind(now_plus_secs_sqlite(AUTH_CODE_TTL_SECS))
    .execute(&mut *tx)
    .await
    {
        tracing::error!("oauth_codes insert failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "failed to issue authorization code",
        );
    }

    if let Err(e) = sqlx::query("UPDATE oauth_clients SET last_used_at = datetime('now') WHERE client_id = ?")
        .bind(&pending.client_id)
        .execute(&mut *tx)
        .await
    {
        tracing::warn!("oauth_clients last_used_at update failed: {e}");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!("tx commit failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "commit failed",
        );
    }

    let redirect = format!(
        "{}?code={}{}",
        pending.redirect_uri, code, state_param
    );
    Json(ConfirmResponse { redirect_url: redirect }).into_response()
}

fn is_pro_or_vip(user: &UserRow) -> bool {
    user.plan == "pro" || user.is_vip
}

// ---------------------------------------------------------------------------
// POST /oauth/token
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TokenRequest {
    grant_type: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    client_id: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Serialize)]
struct TokenResponse {
    access_token: String,
    token_type: &'static str,
    expires_in: i64,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CodeRow {
    user_id: String,
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    code_challenge_method: String,
    scope: Option<String>,
    expires_at: chrono::NaiveDateTime,
    used: i64,
}

pub async fn token(
    State(state): State<AppState>,
    axum::extract::Form(body): axum::extract::Form<TokenRequest>,
) -> Response {
    match body.grant_type.as_deref() {
        Some("authorization_code") => token_authorization_code(state, body).await,
        Some("refresh_token") => token_refresh(state, body).await,
        Some(other) => oauth_error(
            http::StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            &format!("grant_type '{other}' is not supported"),
        ),
        None => oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing grant_type",
        ),
    }
}

async fn token_authorization_code(state: AppState, body: TokenRequest) -> Response {
    let Some(code) = body.code.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing code",
        );
    };

    let mut tx = match state.db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("tx begin failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "transaction error",
            );
        }
    };

    let row: Option<CodeRow> = match sqlx::query_as(
        "SELECT user_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used FROM oauth_codes WHERE code = ?",
    )
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("oauth_codes lookup failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "lookup failed",
            );
        }
    };
    let Some(row) = row else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "invalid or expired authorization code",
        );
    };
    if row.used != 0 {
        // Replay: per OAuth 2.1, treat any reuse as compromise. Revoke any
        // refresh tokens that were issued via this code's chain — currently we
        // can't trace that back, so we just hard-fail.
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "authorization code already used",
        );
    }
    if row.expires_at < chrono::Utc::now().naive_utc() {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "authorization code expired",
        );
    }
    if let Some(ref ru) = body.redirect_uri {
        if ru != &row.redirect_uri {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_grant",
                "redirect_uri mismatch",
            );
        }
    }
    if let Some(ref cid) = body.client_id {
        if cid != &row.client_id {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_grant",
                "client_id mismatch",
            );
        }
    }

    // PKCE verification
    let Some(verifier) = body.code_verifier.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing code_verifier",
        );
    };
    if row.code_challenge_method != "S256" {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "unsupported code_challenge_method",
        );
    }
    let computed = pkce_compute_s256_challenge(&verifier);
    if !constant_time_eq(&computed, &row.code_challenge) {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "code_verifier does not match code_challenge",
        );
    }

    // Mark code used (atomic with the read above via the open transaction).
    if let Err(e) = sqlx::query("UPDATE oauth_codes SET used = 1 WHERE code = ?")
        .bind(&code)
        .execute(&mut *tx)
        .await
    {
        tracing::error!("oauth_codes update used failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "code update failed",
        );
    }

    // For prod (real users), enforce Pro/VIP at exchange time too — plan
    // could have changed between consent and exchange.
    if !state.config.desktop_mode {
        let plan_check: Option<(String, i64)> = sqlx::query_as(
            "SELECT plan, is_vip FROM users WHERE id = ?",
        )
        .bind(&row.user_id)
        .fetch_optional(&mut *tx)
        .await
        .ok()
        .flatten();
        match plan_check {
            Some((plan, is_vip)) if plan == "pro" || is_vip != 0 => {}
            _ => {
                let _ = tx.commit().await;
                return oauth_error(
                    http::StatusCode::FORBIDDEN,
                    "access_denied",
                    "Pro subscription required",
                );
            }
        }
    }

    // Look up email for the JWT
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(&row.user_id)
        .fetch_optional(&mut *tx)
        .await
        .ok()
        .flatten();
    let Some(email) = email else {
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "user not found",
        );
    };

    let access_token = match create_session_token(
        &row.user_id,
        &email,
        &state.config.jwt_secret,
        state.config.jwt_expiration_days,
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("create_session_token failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to issue token",
            );
        }
    };

    // Issue a refresh token (skipped in desktop mode where the local user
    // never needs one — they can just rerun the auth flow).
    let refresh = if state.config.desktop_mode {
        None
    } else {
        let token = random_token_b64url(32);
        let hash = sha256_hex(&token);
        if let Err(e) = sqlx::query(
            "INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, parent_hash, scope, expires_at) VALUES (?, ?, ?, NULL, ?, ?)",
        )
        .bind(&hash)
        .bind(&row.user_id)
        .bind(&row.client_id)
        .bind(row.scope.as_deref())
        .bind(now_plus_secs_sqlite(REFRESH_TOKEN_TTL_SECS))
        .execute(&mut *tx)
        .await
        {
            tracing::error!("oauth_refresh_tokens insert failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "refresh token insert failed",
            );
        }
        Some(token)
    };

    if let Err(e) = tx.commit().await {
        tracing::error!("tx commit failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "commit failed",
        );
    }

    Json(TokenResponse {
        access_token,
        token_type: "Bearer",
        expires_in: state.config.jwt_expiration_days * 86400,
        refresh_token: refresh,
        scope: row.scope,
    })
    .into_response()
}

#[derive(sqlx::FromRow)]
struct RefreshRow {
    token_hash: String,
    user_id: String,
    client_id: String,
    scope: Option<String>,
    expires_at: chrono::NaiveDateTime,
    revoked_at: Option<chrono::NaiveDateTime>,
}

async fn token_refresh(state: AppState, body: TokenRequest) -> Response {
    if state.config.desktop_mode {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            "refresh_token grant not supported in desktop mode",
        );
    }
    let Some(presented) = body.refresh_token.clone() else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "missing refresh_token",
        );
    };
    let presented_hash = sha256_hex(&presented);

    let mut tx = match state.db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("tx begin failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "transaction error",
            );
        }
    };

    let row: Option<RefreshRow> = match sqlx::query_as(
        "SELECT token_hash, user_id, client_id, scope, expires_at, revoked_at FROM oauth_refresh_tokens WHERE token_hash = ?",
    )
    .bind(&presented_hash)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("oauth_refresh_tokens lookup failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "lookup failed",
            );
        }
    };
    let Some(row) = row else {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "unknown refresh_token",
        );
    };
    if let Some(ref cid) = body.client_id {
        if cid != &row.client_id {
            return oauth_error(
                http::StatusCode::BAD_REQUEST,
                "invalid_grant",
                "client_id mismatch",
            );
        }
    }
    if row.expires_at < chrono::Utc::now().naive_utc() {
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token expired",
        );
    }
    if row.revoked_at.is_some() {
        // Replay of a rotated token — revoke the entire chain for this client+user.
        let _ = sqlx::query(
            "UPDATE oauth_refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
        )
        .bind(&row.user_id)
        .bind(&row.client_id)
        .execute(&mut *tx)
        .await;
        let _ = tx.commit().await;
        return oauth_error(
            http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token has been revoked",
        );
    }

    // Look up email for the new JWT
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(&row.user_id)
        .fetch_optional(&mut *tx)
        .await
        .ok()
        .flatten();
    let Some(email) = email else {
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "user not found",
        );
    };

    let access_token = match create_session_token(
        &row.user_id,
        &email,
        &state.config.jwt_secret,
        state.config.jwt_expiration_days,
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("create_session_token failed: {e}");
            return oauth_error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to issue token",
            );
        }
    };

    // Rotate: revoke old, issue new with parent_hash = old_hash.
    if let Err(e) = sqlx::query(
        "UPDATE oauth_refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?",
    )
    .bind(&row.token_hash)
    .execute(&mut *tx)
    .await
    {
        tracing::error!("oauth_refresh_tokens revoke failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "rotation failed",
        );
    }

    let new_token = random_token_b64url(32);
    let new_hash = sha256_hex(&new_token);
    if let Err(e) = sqlx::query(
        "INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, parent_hash, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&new_hash)
    .bind(&row.user_id)
    .bind(&row.client_id)
    .bind(&row.token_hash)
    .bind(row.scope.as_deref())
    .bind(now_plus_secs_sqlite(REFRESH_TOKEN_TTL_SECS))
    .execute(&mut *tx)
    .await
    {
        tracing::error!("oauth_refresh_tokens insert (rotated) failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "rotation insert failed",
        );
    }

    if let Err(e) = tx.commit().await {
        tracing::error!("tx commit failed: {e}");
        return oauth_error(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            "commit failed",
        );
    }

    Json(TokenResponse {
        access_token,
        token_type: "Bearer",
        expires_in: state.config.jwt_expiration_days * 86400,
        refresh_token: Some(new_token),
        scope: row.scope,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// Cleanup (called periodically from main.rs)
// ---------------------------------------------------------------------------

pub async fn cleanup_expired(db: &sqlx::SqlitePool) {
    if let Err(e) = sqlx::query("DELETE FROM oauth_codes WHERE expires_at < datetime('now')")
        .execute(db)
        .await
    {
        tracing::warn!("oauth_codes cleanup failed: {e}");
    }
    if let Err(e) = sqlx::query("DELETE FROM oauth_pending_requests WHERE expires_at < datetime('now')")
        .execute(db)
        .await
    {
        tracing::warn!("oauth_pending_requests cleanup failed: {e}");
    }
    if let Err(e) = sqlx::query(
        "DELETE FROM oauth_refresh_tokens WHERE expires_at < datetime('now') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))",
    )
    .execute(db)
    .await
    {
        tracing::warn!("oauth_refresh_tokens cleanup failed: {e}");
    }
}

// ---------------------------------------------------------------------------
// Tiny URL-encoder (avoid pulling in another crate)
// ---------------------------------------------------------------------------
mod urlencoding {
    /// Percent-encode characters that would break query-string parsing.
    pub fn encode_minimal(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for b in s.bytes() {
            let safe = matches!(
                b,
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~'
            );
            if safe {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{:02X}", b));
            }
        }
        out
    }
}
