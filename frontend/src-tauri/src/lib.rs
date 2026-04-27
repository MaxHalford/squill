mod cli_executor;
mod oauth;
mod secure_store;

use oauth::start_oauth_flow;
use secure_store::{delete_secret, load_secret, save_secret};
use squill_server::services::ws_manager::WsManager;
use std::sync::Arc;
use tauri::Manager;

/// Port for the embedded backend server.
const BACKEND_PORT: u16 = 18222;

/// JS injected before page scripts. Prevents keyboard zoom (Cmd+/-/0),
/// Ctrl+wheel zoom, trackpad gesture zoom, and elastic overscroll.
/// Also injects the backend URL for the embedded server.
fn webview_init_script() -> String {
    format!(
        r#"
(function() {{
    // Inject backend URL for desktop mode
    window.__SQUILL_BACKEND_URL__ = 'http://localhost:{BACKEND_PORT}';

    // Prevent zoom gestures
    document.addEventListener('gesturestart', function(e) {{ e.preventDefault(); }}, {{ passive: false, capture: true }});
    document.addEventListener('gesturechange', function(e) {{ e.preventDefault(); }}, {{ passive: false, capture: true }});
    document.addEventListener('gestureend', function(e) {{ e.preventDefault(); }}, {{ passive: false, capture: true }});
    document.addEventListener('wheel', function(e) {{
        if (e.ctrlKey) e.preventDefault();
    }}, {{ passive: false }});
    document.addEventListener('keydown', function(e) {{
        if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '-' || e.key === '0')) {{
            e.preventDefault();
        }}
    }});
    document.documentElement.style.overscrollBehavior = 'none';
}})();
"#
    )
}

/// Start the embedded Squill backend server in a background tokio task.
fn start_backend_server(app_data_dir: std::path::PathBuf) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async move {
            // Ensure the data directory exists
            std::fs::create_dir_all(&app_data_dir).ok();

            let db_path = app_data_dir.join("squill.db");
            let db_url = format!("sqlite:{}", db_path.display());

            tracing::info!("Desktop backend: database at {}", db_path.display());

            // Load .env if present (for API keys etc.)
            dotenvy::dotenv().ok();

            let config = squill_server::config::Config::from_env_with_overrides(
                &db_url,
                true, // test_mode = false for desktop, but no billing needed
            );

            let pool = squill_server::db::create_pool(&db_url)
                .await
                .expect("Failed to create database pool");

            squill_server::db::ensure_mcp_local_user(&pool, &config.mcp_user_id)
                .await
                .expect("Failed to ensure MCP local user");

            let state = squill_server::AppState {
                db: pool,
                config: Arc::new(config),
                ws_manager: Arc::new(WsManager::new()),
            };

            let app = squill_server::build_app(state);
            let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{BACKEND_PORT}"))
                .await
                .expect("Failed to bind backend server");

            tracing::info!("Desktop backend listening on port {BACKEND_PORT}");
            axum::serve(listener, app).await.ok();
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_oauth_flow,
            save_secret,
            load_secret,
            delete_secret,
        ])
        .setup(|app| {
            // Start embedded backend server
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            start_backend_server(app_data_dir);

            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            window.eval(&webview_init_script()).ok();

            // Disable WKWebView magnification at the native level.
            #[cfg(target_os = "macos")]
            disable_webview_magnification(&window);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn disable_webview_magnification(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        unsafe {
            let wk_webview: *const AnyObject = webview.inner().cast();
            let _: () = msg_send![wk_webview, setAllowsMagnification: false];
        }
    });
}
