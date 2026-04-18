mod cli_executor;
mod oauth;
mod secure_store;

use oauth::start_oauth_flow;
use secure_store::{save_secret, load_secret, delete_secret};
use tauri::Manager;

/// JS injected before page scripts. Prevents keyboard zoom (Cmd+/-/0),
/// Ctrl+wheel zoom, trackpad gesture zoom, and elastic overscroll.
const WEBVIEW_INIT_SCRIPT: &str = r#"
(function() {
    document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false, capture: true });
    document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false, capture: true });
    document.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false, capture: true });
    document.addEventListener('wheel', function(e) {
        if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '-' || e.key === '0')) {
            e.preventDefault();
        }
    });
    document.documentElement.style.overscrollBehavior = 'none';
})();
"#;

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
            let window = app.get_webview_window("main")
                .expect("main window not found");

            window.eval(WEBVIEW_INIT_SCRIPT).ok();

            // Disable WKWebView magnification at the native level.
            // This is the definitive fix — JS gesture prevention is a fallback.
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
