//! OAuth service implementations for Google, GitHub, and Microsoft.
//!
//! Each provider has an `exchange_code` method plus provider-specific helpers.
//! All services support a `test_mode` flag: when enabled and the code starts
//! with `test-`, real HTTP calls are skipped and canned data is returned.

use std::collections::HashMap;

use reqwest::Client;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OAuthResult = Result<HashMap<String, Value>, String>;

fn is_test_code(test_mode: bool, code: &str) -> bool {
    test_mode && code.starts_with("test-")
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

pub struct GoogleOAuthService {
    client_id: String,
    client_secret: String,
    test_mode: bool,
    client: Client,
}

impl GoogleOAuthService {
    const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
    const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
    const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

    pub fn new(client_id: &str, client_secret: &str, test_mode: bool, client: Client) -> Self {
        Self {
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            test_mode,
            client,
        }
    }

    /// Exchange an authorization code for tokens.
    pub async fn exchange_code(&self, code: &str, redirect_uri: &str) -> OAuthResult {
        if is_test_code(self.test_mode, code) {
            let mut m = HashMap::new();
            m.insert("access_token".into(), Value::String("test-token".into()));
            m.insert(
                "refresh_token".into(),
                Value::String("test-refresh".into()),
            );
            m.insert("expires_in".into(), Value::Number(3600.into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .post(Self::TOKEN_URL)
            .form(&[
                ("code", code),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("Google token request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Google token exchange failed: status={status}, body={body}"
            ));
        }

        resp.json::<HashMap<String, Value>>()
            .await
            .map_err(|e| format!("Failed to parse Google token response: {e}"))
    }

    /// Fetch user info (email, given_name, family_name) from Google.
    pub async fn get_user_info(&self, access_token: &str) -> OAuthResult {
        if self.test_mode && access_token == "test-token" {
            // In test mode we don't have the original code, so return generic data.
            // The caller can override email from the code if needed.
            let mut m = HashMap::new();
            m.insert("email".into(), Value::String("test@example.com".into()));
            m.insert("given_name".into(), Value::String("Test".into()));
            m.insert("family_name".into(), Value::String("User".into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .get(Self::USERINFO_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| format!("Google userinfo request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Google userinfo failed: status={status}, body={body}"
            ));
        }

        resp.json::<HashMap<String, Value>>()
            .await
            .map_err(|e| format!("Failed to parse Google userinfo: {e}"))
    }

    /// Get a new access token using a stored refresh token.
    pub async fn refresh_access_token(&self, refresh_token: &str) -> OAuthResult {
        if self.test_mode && refresh_token.starts_with("test-") {
            let mut m = HashMap::new();
            m.insert(
                "access_token".into(),
                Value::String("test-refreshed-token".into()),
            );
            m.insert("expires_in".into(), Value::Number(3600.into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .post(Self::TOKEN_URL)
            .form(&[
                ("refresh_token", refresh_token),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| format!("Google refresh request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Google refresh failed: status={status}, body={body}"
            ));
        }

        resp.json::<HashMap<String, Value>>()
            .await
            .map_err(|e| format!("Failed to parse Google refresh response: {e}"))
    }

    /// Revoke a token (best effort).
    pub async fn revoke_token(&self, token: &str) -> Result<(), String> {
        if self.test_mode {
            return Ok(());
        }

        let client = &self.client;
        let _ = client
            .post(Self::REVOKE_URL)
            .form(&[("token", token)])
            .send()
            .await;
        Ok(())
    }

    /// Helper for test mode: build a user_info map with a specific email.
    pub fn test_user_info(email: &str) -> HashMap<String, Value> {
        let mut m = HashMap::new();
        m.insert("email".into(), Value::String(email.to_string()));
        m.insert("given_name".into(), Value::String("Test".into()));
        m.insert("family_name".into(), Value::String("User".into()));
        m
    }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

pub struct GitHubOAuthService {
    client_id: String,
    client_secret: String,
    test_mode: bool,
    client: Client,
}

impl GitHubOAuthService {
    const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
    const USER_URL: &str = "https://api.github.com/user";
    const EMAILS_URL: &str = "https://api.github.com/user/emails";

    pub fn new(client_id: &str, client_secret: &str, test_mode: bool, client: Client) -> Self {
        Self {
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            test_mode,
            client,
        }
    }

    /// Exchange an authorization code for tokens.
    pub async fn exchange_code(&self, code: &str, redirect_uri: &str) -> OAuthResult {
        if is_test_code(self.test_mode, code) {
            let mut m = HashMap::new();
            m.insert("access_token".into(), Value::String("test-gh-token".into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .post(Self::TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("code", code),
                ("redirect_uri", redirect_uri),
            ])
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("GitHub token request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub token exchange failed: status={status}, body={body}"
            ));
        }

        resp.json::<HashMap<String, Value>>()
            .await
            .map_err(|e| format!("Failed to parse GitHub token response: {e}"))
    }

    /// Fetch the user's primary verified email from GitHub.
    pub async fn get_primary_email(&self, access_token: &str) -> Result<Option<String>, String> {
        if self.test_mode && access_token.starts_with("test-") {
            // Return the email that was encoded in the original test code.
            // The route handler passes the email through, so we return a default here.
            return Ok(Some("test@example.com".into()));
        }

        let client = &self.client;
        let resp = client
            .get(Self::EMAILS_URL)
            .bearer_auth(access_token)
            .header("Accept", "application/json")
            .header("User-Agent", "squill-server")
            .send()
            .await
            .map_err(|e| format!("GitHub emails request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub emails failed: status={status}, body={body}"
            ));
        }

        let emails: Vec<Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub emails: {e}"))?;

        let verified: Vec<&Value> = emails
            .iter()
            .filter(|e| e.get("verified").and_then(|v| v.as_bool()).unwrap_or(false))
            .collect();

        if verified.is_empty() {
            return Ok(None);
        }

        // Prefer the primary email
        for entry in &verified {
            if entry
                .get("primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                if let Some(email) = entry.get("email").and_then(|v| v.as_str()) {
                    return Ok(Some(email.to_string()));
                }
            }
        }

        // Fall back to first verified
        Ok(verified[0]
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }

    /// Fetch the user's GitHub username (login).
    pub async fn get_user_login(&self, access_token: &str) -> Result<Option<String>, String> {
        if self.test_mode && access_token.starts_with("test-") {
            return Ok(Some("test-user".into()));
        }

        let client = &self.client;
        let resp = client
            .get(Self::USER_URL)
            .bearer_auth(access_token)
            .header("Accept", "application/json")
            .header("User-Agent", "squill-server")
            .send()
            .await
            .map_err(|e| format!("GitHub user request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub user failed: status={status}, body={body}"
            ));
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub user: {e}"))?;

        Ok(data.get("login").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }
}

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

pub struct MicrosoftOAuthService {
    client_id: String,
    client_secret: String,
    test_mode: bool,
    client: Client,
}

impl MicrosoftOAuthService {
    const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    const USER_URL: &str = "https://graph.microsoft.com/v1.0/me";

    pub fn new(client_id: &str, client_secret: &str, test_mode: bool, client: Client) -> Self {
        Self {
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            test_mode,
            client,
        }
    }

    /// Exchange an authorization code for tokens.
    pub async fn exchange_code(&self, code: &str, redirect_uri: &str) -> OAuthResult {
        if is_test_code(self.test_mode, code) {
            let mut m = HashMap::new();
            m.insert("access_token".into(), Value::String("test-ms-token".into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .post(Self::TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Microsoft token request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Microsoft token exchange failed: status={status}, body={body}"
            ));
        }

        resp.json::<HashMap<String, Value>>()
            .await
            .map_err(|e| format!("Failed to parse Microsoft token response: {e}"))
    }

    /// Fetch user info (email, first_name, last_name) from Microsoft Graph.
    pub async fn get_user_info(
        &self,
        access_token: &str,
    ) -> Result<HashMap<String, Value>, String> {
        if self.test_mode && access_token.starts_with("test-") {
            let mut m = HashMap::new();
            m.insert("email".into(), Value::String("test@example.com".into()));
            m.insert("first_name".into(), Value::String("Test".into()));
            m.insert("last_name".into(), Value::String("User".into()));
            return Ok(m);
        }

        let client = &self.client;
        let resp = client
            .get(Self::USER_URL)
            .bearer_auth(access_token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Microsoft user request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Microsoft user info failed: status={status}, body={body}"
            ));
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Microsoft user info: {e}"))?;

        let email = data
            .get("mail")
            .or_else(|| data.get("userPrincipalName"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let first_name = data
            .get("givenName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let last_name = data
            .get("surname")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let mut m = HashMap::new();
        m.insert("email".into(), Value::String(email));
        m.insert("first_name".into(), Value::String(first_name));
        m.insert("last_name".into(), Value::String(last_name));
        Ok(m)
    }
}
