use clap::Parser;
use squill_server::{
    build_app, config::Config, db, encryption::TokenEncryption, services::ws_manager::WsManager,
    AppState,
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

    tracing::info!("Connecting to database: {}", config.database_url);
    let pool = db::create_pool(&config.database_url).await?;
    tracing::info!("Database ready, migrations applied");

    db::ensure_mcp_local_user(&pool, &config.mcp_user_id).await?;
    tracing::info!("MCP local user ensured: {}", config.mcp_user_id);

    let encryption = if config.token_encryption_key.is_empty() {
        None
    } else {
        Some(Arc::new(
            TokenEncryption::new(&config.token_encryption_key)
                .expect("Invalid TOKEN_ENCRYPTION_KEY"),
        ))
    };

    let state = AppState {
        db: pool,
        config: Arc::new(config),
        ws_manager: Arc::new(WsManager::new()),
        encryption,
        http_client: reqwest::Client::new(),
    };

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
