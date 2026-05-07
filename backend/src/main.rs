use clap::Parser;
use squill_server::{
    build_app, config::Config, db, encryption::TokenEncryption, rate_limit::RateLimiter,
    routes::mcp_oauth, services::ws_manager::WsManager, token_revocation, AppState,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::ServiceExt;
use tower::Layer;
use tower_http::normalize_path::NormalizePathLayer;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "squill-server")]
struct Cli {
    /// Port to listen on
    #[arg(long, default_value = "8000")]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    let config = Config::from_env();

    if config.jwt_secret.is_empty() {
        anyhow::bail!("JWT_SECRET environment variable must be set");
    }

    tracing::info!("Connecting to database: {}", config.database_url);
    let pool = db::create_pool(&config.database_url).await?;
    tracing::info!("Database ready, migrations applied");

    db::ensure_mcp_local_user(&pool, &config.mcp_user_id).await?;
    tracing::info!("MCP local user ensured: {}", config.mcp_user_id);

    let encryption = if config.token_encryption_key.is_empty() {
        if config.test_mode || config.desktop_mode {
            tracing::warn!(
                "TOKEN_ENCRYPTION_KEY is not set — credential storage endpoints will reject requests."
            );
            None
        } else {
            anyhow::bail!(
                "TOKEN_ENCRYPTION_KEY must be set in production. \
                 Use a 32-byte base64-encoded key."
            );
        }
    } else {
        Some(Arc::new(
            TokenEncryption::new(&config.token_encryption_key)
                .expect("Invalid TOKEN_ENCRYPTION_KEY"),
        ))
    };

    // Auth endpoints: 20 requests per 60 seconds per IP
    let rate_limiter = Arc::new(RateLimiter::new(20, 60));
    // General endpoints: 200 requests per 60 seconds per IP
    let general_rate_limiter = Arc::new(RateLimiter::new(200, 60));

    let state = AppState {
        db: pool,
        config: Arc::new(config),
        ws_manager: Arc::new(WsManager::new()),
        encryption,
        http_client: reqwest::Client::new(),
        rate_limiter,
        general_rate_limiter,
    };

    // Background task: clean up expired share tokens and revoked JWT entries every hour
    let cleanup_pool = state.db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            // Clean up expired share tokens
            match sqlx::query(
                "DELETE FROM canvas_shares WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
            )
            .execute(&cleanup_pool)
            .await
            {
                Ok(r) if r.rows_affected() > 0 => {
                    tracing::info!("Cleaned up {} expired share tokens", r.rows_affected());
                }
                Err(e) => tracing::warn!("Share token cleanup failed: {e}"),
                _ => {}
            }
            // Clean up expired revoked tokens
            match token_revocation::cleanup_expired_revocations(&cleanup_pool).await {
                Ok(n) if n > 0 => tracing::info!("Cleaned up {n} expired revoked tokens"),
                Err(e) => tracing::warn!("Revoked token cleanup failed: {e}"),
                _ => {}
            }
            // Clean up expired OAuth state (codes, pending requests, refresh tokens)
            mcp_oauth::cleanup_expired(&cleanup_pool).await;
        }
    });

    let app = build_app(state);
    let app: axum::routing::IntoMakeService<
        tower_http::normalize_path::NormalizePath<axum::Router>,
    > = ServiceExt::<axum::extract::Request>::into_make_service(
        NormalizePathLayer::trim_trailing_slash().layer(app),
    );
    let listener = TcpListener::bind(format!("0.0.0.0:{}", cli.port)).await?;
    tracing::info!("Listening on port {}", cli.port);

    axum::serve(listener, app).await?;
    Ok(())
}
