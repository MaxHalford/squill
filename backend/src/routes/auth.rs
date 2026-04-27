//! OAuth authentication endpoints.
//!
//! Seven routes matching the Python backend:
//!   POST /auth/google/login
//!   POST /auth/google/callback
//!   POST /auth/github/login
//!   POST /auth/microsoft/login
//!   POST /auth/refresh
//!   GET  /auth/user/{email}
//!   POST /auth/logout

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::jwt::create_session_token;
use crate::encryption::TokenEncryption;
use crate::services::oauth::{GitHubOAuthService, GoogleOAuthService, MicrosoftOAuthService};
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / Response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OAuthCodeRequest {
    code: String,
    redirect_uri: String,
}

#[derive(Serialize)]
struct UserPayload {
    id: String,
    email: String,
    first_name: Option<String>,
    last_name: Option<String>,
    plan: String,
    is_vip: bool,
}

#[derive(Serialize)]
struct LoginResponse {
    session_token: String,
    user: UserPayload,
}

#[derive(Serialize)]
struct CallbackResponse {
    access_token: String,
    expires_in: i64,
    session_token: String,
    user: UserPayload,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    email: String,
}

#[derive(Serialize)]
struct RefreshResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Serialize)]
struct UserCheckResponse {
    email: String,
    has_valid_refresh_token: bool,
}

#[derive(Deserialize)]
pub struct LogoutRequest {
    email: String,
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct UserRow {
    id: String,
    email: String,
    first_name: Option<String>,
    last_name: Option<String>,
    plan: String,
    is_vip: bool,
}

#[derive(sqlx::FromRow)]
struct BqConnectionRow {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    user_id: String,
    email: String,
    refresh_token_encrypted: Vec<u8>,
    encryption_iv: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn error_response(status: StatusCode, detail: &str) -> Response {
    (status, Json(json!({"detail": detail}))).into_response()
}

fn error_response_json(status: StatusCode, detail: Value) -> Response {
    (status, Json(json!({"detail": detail}))).into_response()
}

fn user_payload(row: &UserRow) -> UserPayload {
    UserPayload {
        id: row.id.clone(),
        email: row.email.clone(),
        first_name: row.first_name.clone(),
        last_name: row.last_name.clone(),
        plan: row.plan.clone(),
        is_vip: row.is_vip,
    }
}

/// Look up user by email; create if not found, update name + VIP if found.
async fn upsert_user(
    state: &AppState,
    email: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
) -> Result<UserRow, Response> {
    let is_vip = state.config.vip_emails.contains(&email.to_lowercase());

    let existing: Option<UserRow> = sqlx::query_as(
        "SELECT id, email, first_name, last_name, plan, is_vip FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    match existing {
        Some(mut user) => {
            // Update name on each login
            let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
            sqlx::query(
                "UPDATE users SET first_name = ?, last_name = ?, is_vip = ?, last_login_at = ? WHERE id = ?",
            )
            .bind(first_name)
            .bind(last_name)
            .bind(is_vip || user.is_vip)
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

            user.first_name = first_name.map(|s| s.to_string());
            user.last_name = last_name.map(|s| s.to_string());
            if is_vip {
                user.is_vip = true;
            }
            Ok(user)
        }
        None => {
            let id = Uuid::new_v4().to_string();
            let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            sqlx::query(
                "INSERT INTO users (id, email, first_name, last_name, plan, is_vip, created_at, last_login_at) VALUES (?, ?, ?, ?, 'free', ?, ?, ?)",
            )
            .bind(&id)
            .bind(email)
            .bind(first_name)
            .bind(last_name)
            .bind(is_vip)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

            Ok(UserRow {
                id,
                email: email.to_string(),
                first_name: first_name.map(|s| s.to_string()),
                last_name: last_name.map(|s| s.to_string()),
                plan: "free".to_string(),
                is_vip,
            })
        }
    }
}

fn value_as_str<'a>(map: &'a std::collections::HashMap<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(|v| v.as_str())
}

fn value_as_i64(map: &std::collections::HashMap<String, Value>, key: &str) -> Option<i64> {
    map.get(key).and_then(|v| v.as_i64())
}

// ---------------------------------------------------------------------------
// POST /auth/google/login
// ---------------------------------------------------------------------------

pub async fn google_login(
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let google = GoogleOAuthService::new(
        &state.config.google_client_id,
        &state.config.google_client_secret,
        state.config.test_mode,
    );

    // Exchange code for tokens
    let tokens = google
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received"))?;

    // Get user info
    let mut user_info = google
        .get_user_info(access_token)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    // In test mode, override email from the code
    if state.config.test_mode && body.code.starts_with("test-") {
        let email = body.code.strip_prefix("test-").unwrap_or(&body.code);
        user_info.insert("email".into(), Value::String(email.to_string()));
    }

    let email = value_as_str(&user_info, "email")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No email in user info"))?;
    let first_name = value_as_str(&user_info, "given_name");
    let last_name = value_as_str(&user_info, "family_name");

    let user = upsert_user(&state, email, first_name, last_name).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &state.config.jwt_secret,
        state.config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/google/callback
// ---------------------------------------------------------------------------

pub async fn google_callback(
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let google = GoogleOAuthService::new(
        &state.config.google_client_id,
        &state.config.google_client_secret,
        state.config.test_mode,
    );

    // Exchange code for tokens
    let tokens = google
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received"))?
        .to_string();
    let refresh_token = value_as_str(&tokens, "refresh_token").map(|s| s.to_string());
    let expires_in = value_as_i64(&tokens, "expires_in").unwrap_or(3600);

    // Get user info
    let mut user_info = google
        .get_user_info(&access_token)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    // In test mode, override email from the code
    if state.config.test_mode && body.code.starts_with("test-") {
        let email = body.code.strip_prefix("test-").unwrap_or(&body.code);
        user_info.insert("email".into(), Value::String(email.to_string()));
    }

    let email = value_as_str(&user_info, "email")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No email in user info"))?;
    let first_name = value_as_str(&user_info, "given_name");
    let last_name = value_as_str(&user_info, "family_name");

    let user = upsert_user(&state, email, first_name, last_name).await?;

    // Upsert BigQuery connection with encrypted refresh token
    let existing_bq: Option<BqConnectionRow> = sqlx::query_as(
        "SELECT id, user_id, email, refresh_token_encrypted, encryption_iv FROM bigquery_connections WHERE user_id = ? AND email = ?",
    )
    .bind(&user.id)
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if let Some(rt) = &refresh_token {
        let enc = TokenEncryption::new(&state.config.token_encryption_key)
            .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Encryption init error: {e}")))?;
        let (ciphertext, iv) = enc
            .encrypt(rt)
            .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Encryption error: {e}")))?;

        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        if existing_bq.is_some() {
            sqlx::query(
                "UPDATE bigquery_connections SET refresh_token_encrypted = ?, encryption_iv = ?, updated_at = ? WHERE user_id = ? AND email = ?",
            )
            .bind(&ciphertext)
            .bind(&iv)
            .bind(&now)
            .bind(&user.id)
            .bind(email)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
        } else {
            let bq_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO bigquery_connections (id, user_id, email, refresh_token_encrypted, encryption_iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&bq_id)
            .bind(&user.id)
            .bind(email)
            .bind(&ciphertext)
            .bind(&iv)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
        }
    } else if existing_bq.is_none() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "No refresh token received and no existing connection. Please try signing in again.",
        ));
    }

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &state.config.jwt_secret,
        state.config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(CallbackResponse {
        access_token,
        expires_in,
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/github/login
// ---------------------------------------------------------------------------

pub async fn github_login(
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    if !config.test_mode
        && (config.github_client_id.is_empty() || config.github_client_secret.is_empty())
    {
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "GitHub OAuth is not configured",
        ));
    }

    let github = GitHubOAuthService::new(
        &config.github_client_id,
        &config.github_client_secret,
        config.test_mode,
    );

    let tokens = github
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received from GitHub"))?
        .to_string();

    // Get email and login in parallel
    let (email_result, login_result) = tokio::join!(
        github.get_primary_email(&access_token),
        github.get_user_login(&access_token),
    );

    let mut email = email_result
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_REQUEST,
                "No verified email found on your GitHub account. Please verify your email on GitHub and try again.",
            )
        })?;

    // In test mode, override email from the code
    if config.test_mode && body.code.starts_with("test-") {
        email = body.code.strip_prefix("test-").unwrap_or(&body.code).to_string();
    }

    let login = login_result
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    let user = upsert_user(&state, &email, login.as_deref(), None).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &config.jwt_secret,
        config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/microsoft/login
// ---------------------------------------------------------------------------

pub async fn microsoft_login(
    State(state): State<AppState>,
    Json(body): Json<OAuthCodeRequest>,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    if !config.test_mode
        && (config.microsoft_client_id.is_empty() || config.microsoft_client_secret.is_empty())
    {
        return Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Microsoft OAuth is not configured",
        ));
    }

    let microsoft = MicrosoftOAuthService::new(
        &config.microsoft_client_id,
        &config.microsoft_client_secret,
        config.test_mode,
    );

    let tokens = microsoft
        .exchange_code(&body.code, &body.redirect_uri)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to exchange code: {e}")))?;

    let access_token = value_as_str(&tokens, "access_token")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "No access token received from Microsoft"))?
        .to_string();

    let mut user_info = microsoft
        .get_user_info(&access_token)
        .await
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, &format!("Failed to get user info: {e}")))?;

    // In test mode, override email from the code
    if config.test_mode && body.code.starts_with("test-") {
        let email = body.code.strip_prefix("test-").unwrap_or(&body.code);
        user_info.insert("email".into(), Value::String(email.to_string()));
    }

    let email = value_as_str(&user_info, "email")
        .filter(|e| !e.is_empty())
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_REQUEST,
                "No email found on your Microsoft account.",
            )
        })?;
    let first_name = value_as_str(&user_info, "first_name");
    let last_name = value_as_str(&user_info, "last_name");

    let user = upsert_user(&state, email, first_name, last_name).await?;

    let session_token = create_session_token(
        &user.id,
        &user.email,
        &config.jwt_secret,
        config.jwt_expiration_days,
    )
    .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("JWT error: {e}")))?;

    Ok(Json(LoginResponse {
        session_token,
        user: user_payload(&user),
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------

pub async fn refresh_token(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<impl IntoResponse, Response> {
    let google = GoogleOAuthService::new(
        &state.config.google_client_id,
        &state.config.google_client_secret,
        state.config.test_mode,
    );

    // Find BQ connection by email
    let bq: BqConnectionRow = sqlx::query_as(
        "SELECT id, user_id, email, refresh_token_encrypted, encryption_iv FROM bigquery_connections WHERE email = ?",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?
    .ok_or_else(|| {
        error_response_json(
            StatusCode::UNAUTHORIZED,
            json!({
                "error": "no_refresh_token",
                "message": "No BigQuery connection found. Please re-authenticate."
            }),
        )
    })?;

    // Decrypt refresh token
    let enc = TokenEncryption::new(&state.config.token_encryption_key).map_err(|_| {
        error_response_json(
            StatusCode::UNAUTHORIZED,
            json!({
                "error": "decrypt_failed",
                "message": "Failed to decrypt refresh token."
            }),
        )
    })?;

    let rt = enc
        .decrypt(&bq.refresh_token_encrypted, &bq.encryption_iv)
        .map_err(|_| {
            error_response_json(
                StatusCode::UNAUTHORIZED,
                json!({
                    "error": "decrypt_failed",
                    "message": "Failed to decrypt refresh token."
                }),
            )
        })?;

    // Refresh with Google
    let tokens = google.refresh_access_token(&rt).await.map_err(|e| {
        error_response_json(
            StatusCode::UNAUTHORIZED,
            json!({
                "error": "refresh_failed",
                "message": format!("Failed to refresh token: {e}")
            }),
        )
    })?;

    let access_token = value_as_str(&tokens, "access_token")
        .unwrap_or("")
        .to_string();
    let expires_in = value_as_i64(&tokens, "expires_in").unwrap_or(3600);

    Ok(Json(RefreshResponse {
        access_token,
        expires_in,
    }))
}

// ---------------------------------------------------------------------------
// GET /auth/user/{email}
// ---------------------------------------------------------------------------

pub async fn get_user_by_email(
    State(state): State<AppState>,
    Path(email): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let bq: Option<BqConnectionRow> = sqlx::query_as(
        "SELECT id, user_id, email, refresh_token_encrypted, encryption_iv FROM bigquery_connections WHERE email = ?",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let bq = bq.ok_or_else(|| {
        error_response(StatusCode::NOT_FOUND, "No BigQuery connection found")
    })?;

    Ok(Json(UserCheckResponse {
        email: bq.email,
        has_valid_refresh_token: true,
    }))
}

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

pub async fn logout(
    State(state): State<AppState>,
    Json(body): Json<LogoutRequest>,
) -> Result<impl IntoResponse, Response> {
    let bq: Option<BqConnectionRow> = sqlx::query_as(
        "SELECT id, user_id, email, refresh_token_encrypted, encryption_iv FROM bigquery_connections WHERE email = ?",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    if let Some(bq) = bq {
        // Try to revoke with Google (best effort)
        let enc = TokenEncryption::new(&state.config.token_encryption_key);
        if let Ok(enc) = enc {
            if let Ok(rt) = enc.decrypt(&bq.refresh_token_encrypted, &bq.encryption_iv) {
                let google = GoogleOAuthService::new(
                    &state.config.google_client_id,
                    &state.config.google_client_secret,
                    state.config.test_mode,
                );
                let _ = google.revoke_token(&rt).await;
            }
        }

        // Delete the BQ connection
        sqlx::query("DELETE FROM bigquery_connections WHERE email = ?")
            .bind(&body.email)
            .execute(&state.db)
            .await
            .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
    }

    Ok(Json(json!({"status": "ok"})))
}

// ---------------------------------------------------------------------------
// Desktop token (local/embedded mode only)
// ---------------------------------------------------------------------------

/// Issue a JWT for the local desktop user without credentials.
/// Only available when the server runs in test/desktop mode.
pub async fn desktop_token(State(state): State<AppState>) -> impl IntoResponse {
    let config = &state.config;
    match create_session_token(
        &config.mcp_user_id,
        "local@squill.desktop",
        &config.jwt_secret,
        config.jwt_expiration_days,
    ) {
        Ok(token) => (StatusCode::OK, Json(json!({"session_token": token}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        ),
    }
}
