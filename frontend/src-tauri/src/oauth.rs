//! Desktop OAuth helper.
//!
//! Orchestrates the "installed application" OAuth flow for the desktop app:
//!   1. Spin up a one-shot HTTP listener on an ephemeral localhost port.
//!   2. Open the user's default browser at the provider's auth URL.
//!   3. Wait for the provider to redirect back to `http://127.0.0.1:PORT/...`.
//!   4. Return the received `code` and `state` to JavaScript.
//!
//! JS is responsible for PKCE (code_verifier / code_challenge), token exchange
//! with the provider, and token storage. The Rust side only handles the parts
//! a browser webview can't do on its own: opening an external browser and
//! listening for the loopback redirect.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::time::timeout;

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthCallbackResult {
    pub code: String,
    pub state: String,
    /// The exact redirect_uri the provider redirected to — JS must pass this
    /// back in the token exchange request (Google enforces an exact match).
    pub redirect_uri: String,
}

/// Run an OAuth authorization code flow against a loopback redirect.
///
/// `auth_url_template` must contain the literal placeholder `{redirect_uri}`
/// where the provider's `redirect_uri` query parameter belongs. The placeholder
/// gets filled in with the URL-encoded loopback URL the listener binds to.
///
/// Returns the `code` + `state` from the provider's callback. JS verifies
/// `state` (CSRF) and exchanges `code` for tokens.
#[tauri::command]
pub async fn start_oauth_flow(
    auth_url_template: String,
    timeout_seconds: Option<u64>,
) -> Result<OAuthCallbackResult, String> {
    // Port 0 = let the OS pick an available ephemeral port.
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Failed to bind loopback listener: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get listener address: {}", e))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let encoded = urlencoding::encode(&redirect_uri);
    let auth_url = auth_url_template.replace("{redirect_uri}", &encoded);

    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {}", e))?;

    let wait = Duration::from_secs(timeout_seconds.unwrap_or(300));
    let (mut stream, _) = timeout(wait, listener.accept())
        .await
        .map_err(|_| "OAuth flow timed out — no callback received".to_string())?
        .map_err(|e| format!("Failed to accept connection: {}", e))?;

    let (read_half, mut write_half) = stream.split();
    let mut reader = BufReader::new(read_half);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| format!("Failed to read request: {}", e))?;

    // Request line: "GET /callback?code=...&state=... HTTP/1.1"
    let path_and_query = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Malformed HTTP request line")?;

    let query = path_and_query.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params: HashMap<String, String> = url_parse_query(query);

    if let Some(err) = params.get("error") {
        let description = params.get("error_description").cloned().unwrap_or_default();
        let _ = write_html_response(
            &mut write_half,
            "Authentication failed",
            &format!("The provider returned an error: <code>{}</code>", err),
        )
        .await;
        return Err(if description.is_empty() {
            format!("OAuth error: {}", err)
        } else {
            format!("OAuth error: {} — {}", err, description)
        });
    }

    let code = params
        .get("code")
        .cloned()
        .ok_or("Missing authorization code in callback")?;
    let state = params
        .get("state")
        .cloned()
        .ok_or("Missing state in callback")?;

    let _ = write_html_response(
        &mut write_half,
        "Signed in",
        "You can close this tab and return to Squill.",
    )
    .await;

    Ok(OAuthCallbackResult {
        code,
        state,
        redirect_uri,
    })
}

/// Minimal `application/x-www-form-urlencoded` query parser.
fn url_parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            let k = urlencoding::decode(k).ok()?.into_owned();
            let v = urlencoding::decode(v).ok()?.into_owned();
            Some((k, v))
        })
        .collect()
}

async fn write_html_response<W: AsyncWriteExt + Unpin>(
    stream: &mut W,
    title: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Squill — {title}</title>
  <style>
    body {{ font-family: -apple-system, system-ui, sans-serif; text-align: center;
            padding: 4rem 1rem; background: #fafafa; color: #1a1a1a; }}
    h1 {{ font-size: 2rem; }}
    p  {{ color: #555; }}
    code {{ background: #eee; padding: 2px 6px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <p>{message}</p>
</body>
</html>"#,
        title = title,
        message = message
    );

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );

    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}
