pub mod auth;
pub mod config;
pub mod db;
pub mod encryption;
pub mod error;
pub mod helpers;
pub mod routes;
pub mod services;

use axum::response::IntoResponse;
use axum::Router;
use config::Config;
use encryption::TokenEncryption;
use http::header;
use services::ws_manager::WsManager;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

/// Shared application state available to all route handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub ws_manager: Arc<WsManager>,
    pub encryption: Option<Arc<TokenEncryption>>,
    pub http_client: reqwest::Client,
}

/// Build the Axum router with all routes and middleware.
/// This is the main entry point for both the standalone server and desktop embedding.
pub fn build_app(state: AppState) -> Router {
    let config = &state.config;

    let origins: Vec<_> = config
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    // tower-http doesn't allow wildcard headers with credentials,
    // so we list the headers the frontend actually sends.
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            http::Method::GET,
            http::Method::POST,
            http::Method::PATCH,
            http::Method::PUT,
            http::Method::DELETE,
            http::Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::ORIGIN,
            header::IF_MATCH,
            header::IF_NONE_MATCH,
        ])
        .allow_credentials(true);

    let mut app = Router::new()
        .route("/", axum::routing::get(routes::health::health_check))
        // Canvas CRUD (GET + POST on same path)
        .route(
            "/canvas",
            axum::routing::get(routes::canvas::list_canvases)
                .post(routes::canvas::create_canvas),
        )
        .route(
            "/canvas/{canvas_id}",
            axum::routing::put(routes::canvas::rename_canvas)
                .delete(routes::canvas::delete_canvas),
        )
        .route("/canvas/{canvas_id}/snapshot", axum::routing::get(routes::canvas::get_canvas_snapshot))
        // Box CRUD
        .route("/canvas/{canvas_id}/boxes", axum::routing::post(routes::canvas::create_box))
        .route(
            "/canvas/{canvas_id}/boxes/batch",
            axum::routing::post(routes::canvas::create_boxes_batch)
                .patch(routes::canvas::update_boxes_batch),
        )
        .route(
            "/canvas/{canvas_id}/boxes/{box_id}",
            axum::routing::patch(routes::canvas::update_box)
                .delete(routes::canvas::delete_box),
        )
        .route("/canvas/{canvas_id}/boxes/batch-delete", axum::routing::post(routes::canvas::delete_boxes_batch))
        // Import
        .route("/canvas/{canvas_id}/import", axum::routing::post(routes::canvas::import_canvas_state))
        // Shares
        .route("/canvas/{canvas_id}/share", axum::routing::post(routes::canvas::create_share))
        .route("/canvas/{canvas_id}/shares", axum::routing::get(routes::canvas::list_shares))
        .route(
            "/share/{token}",
            axum::routing::get(routes::canvas::validate_share)
                .delete(routes::canvas::revoke_share),
        )
        // User (GET + DELETE on same path)
        .route(
            "/user/me",
            axum::routing::get(routes::user::get_user_profile)
                .delete(routes::user::delete_user),
        )
        // Connections (aggregated list, Pro gate)
        .route("/connections", axum::routing::get(routes::connections::list_connections))
        // ClickHouse CRUD
        .route("/clickhouse/connections", axum::routing::post(routes::clickhouse::create_connection))
        .route(
            "/clickhouse/connections/{connection_id}/credentials",
            axum::routing::get(routes::clickhouse::get_credentials),
        )
        .route(
            "/clickhouse/connections/{connection_id}",
            axum::routing::delete(routes::clickhouse::delete_connection),
        )
        // Snowflake CRUD
        .route("/snowflake/connections", axum::routing::post(routes::snowflake::create_connection))
        .route(
            "/snowflake/connections/{connection_id}/credentials",
            axum::routing::get(routes::snowflake::get_credentials),
        )
        .route(
            "/snowflake/connections/{connection_id}",
            axum::routing::delete(routes::snowflake::delete_connection),
        )
        // Auth / OAuth
        .route("/auth/google/login", axum::routing::post(routes::auth::google_login))
        .route("/auth/google/callback", axum::routing::post(routes::auth::google_callback))
        .route("/auth/github/login", axum::routing::post(routes::auth::github_login))
        .route("/auth/microsoft/login", axum::routing::post(routes::auth::microsoft_login))
        .route("/auth/refresh", axum::routing::post(routes::auth::refresh_token))
        .route("/auth/user/{email}", axum::routing::get(routes::auth::get_user_by_email))
        .route("/auth/logout", axum::routing::post(routes::auth::logout))
        // Billing
        .route("/billing/checkout-session", axum::routing::post(routes::billing::checkout_session))
        .route("/billing/cancel-subscription", axum::routing::post(routes::billing::cancel_subscription))
        .route("/billing/resubscribe", axum::routing::post(routes::billing::resubscribe))
        .route("/billing/webhook", axum::routing::post(routes::billing::webhook))
        // AI (spell caster + hex remover)
        .route("/cast-spell", axum::routing::post(routes::ai::cast_spell))
        .route("/remove-hex", axum::routing::post(routes::ai::remove_hex))
        // WebSocket
        .route("/ws/canvas/{canvas_id}", axum::routing::get(routes::ws::canvas_websocket));

    // Test-only endpoints (gated behind SQUILL_TEST_MODE=1)
    if config.test_mode {
        app = app
            .route("/test/seed-user", axum::routing::post(routes::test_helpers::seed_user))
            .route("/test/reset", axum::routing::post(routes::test_helpers::reset_db))
            .route("/auth/test-login", axum::routing::post(routes::test_helpers::test_login))
            .route("/auth/desktop-token", axum::routing::get(routes::auth::desktop_token));
    }

    // MCP OAuth (null-auth flow for clients that force re-authentication)
    app = app
        .route("/.well-known/oauth-authorization-server", axum::routing::get(routes::mcp_oauth::metadata))
        .route("/.well-known/oauth-protected-resource", axum::routing::get(routes::mcp_oauth::protected_resource))
        .route("/register", axum::routing::post(routes::mcp_oauth::register))
        .route("/authorize", axum::routing::get(routes::mcp_oauth::authorize))
        .route("/token", axum::routing::post(routes::mcp_oauth::token));

    // MCP (Model Context Protocol) endpoint
    let mcp_service = routes::mcp::build_mcp_service(state.db.clone(), config.mcp_user_id.clone(), state.ws_manager.clone());
    app = app.route("/mcp", axum::routing::any_service(mcp_service));

    app.fallback(fallback_handler)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Return JSON 404 for unmatched routes so MCP/OAuth clients get parseable responses.
/// Uses RFC 6749 §5.2 error format so OAuth clients can parse the body.
async fn fallback_handler(req: axum::extract::Request) -> impl IntoResponse {
    tracing::warn!("Unmatched route: {} {}", req.method(), req.uri());
    (
        http::StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({
            "error": "not_found",
            "error_description": format!("No handler for {} {}", req.method(), req.uri())
        })),
    )
}
