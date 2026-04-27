use std::collections::HashSet;
use std::env;

/// Application settings, read from environment variables (same names as the Python backend).
#[derive(Debug, Clone)]
pub struct Config {
    // Database
    pub database_url: String,

    // Google OAuth
    pub google_client_id: String,
    pub google_client_secret: String,

    // GitHub OAuth (optional)
    pub github_client_id: String,
    pub github_client_secret: String,

    // Microsoft OAuth (optional)
    pub microsoft_client_id: String,
    pub microsoft_client_secret: String,

    // Encryption key for credentials (32-byte base64-encoded)
    pub token_encryption_key: String,

    // JWT
    pub jwt_secret: String,
    pub jwt_expiration_days: i64,

    // OpenAI
    pub openai_api_key: String,

    // Polar billing
    pub polar_access_token: String,
    pub polar_webhook_secret: String,
    pub polar_product_id: String,
    pub polar_server: String,
    pub frontend_url: String,

    // CORS
    pub cors_origins: Vec<String>,

    // VIP emails
    pub vip_emails: HashSet<String>,

    // Test mode
    pub test_mode: bool,

    // MCP local user ID (for desktop app — bypasses OAuth)
    pub mcp_user_id: String,
}

impl Config {
    /// Load configuration from environment variables.
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:./squill.db".to_string()),

            google_client_id: env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
            google_client_secret: env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),

            github_client_id: env::var("GITHUB_CLIENT_ID").unwrap_or_default(),
            github_client_secret: env::var("GITHUB_CLIENT_SECRET").unwrap_or_default(),

            microsoft_client_id: env::var("MICROSOFT_CLIENT_ID").unwrap_or_default(),
            microsoft_client_secret: env::var("MICROSOFT_CLIENT_SECRET").unwrap_or_default(),

            token_encryption_key: env::var("TOKEN_ENCRYPTION_KEY").unwrap_or_default(),

            jwt_secret: env::var("JWT_SECRET").unwrap_or_default(),
            jwt_expiration_days: env::var("JWT_EXPIRATION_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),

            openai_api_key: env::var("OPENAI_API_KEY").unwrap_or_default(),

            polar_access_token: env::var("POLAR_ACCESS_TOKEN").unwrap_or_default(),
            polar_webhook_secret: env::var("POLAR_WEBHOOK_SECRET").unwrap_or_default(),
            polar_product_id: env::var("POLAR_PRODUCT_ID").unwrap_or_default(),
            polar_server: env::var("POLAR_SERVER").unwrap_or_else(|_| "sandbox".to_string()),
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),

            cors_origins: env::var("CORS_ORIGINS")
                .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_else(|_| {
                    vec![
                        "https://www.squill.dev".to_string(),
                        "https://squill.dev".to_string(),
                        "http://localhost:5173".to_string(),
                    ]
                }),

            vip_emails: env::var("VIP_EMAILS")
                .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_else(|_| {
                    HashSet::from([
                        "maxhalford25@gmail.com".to_string(),
                        "max@carbonfact.com".to_string(),
                    ])
                }),

            test_mode: env::var("SQUILL_TEST_MODE")
                .map(|v| v == "1" || v == "true")
                .unwrap_or(false),

            mcp_user_id: env::var("MCP_USER_ID")
                .unwrap_or_else(|_| "00000000-0000-0000-0000-000000000001".to_string()),
        }
    }

    /// Create config with explicit overrides for desktop embedding.
    pub fn from_env_with_overrides(database_url: &str, test_mode: bool) -> Self {
        let mut config = Self::from_env();
        config.database_url = database_url.to_string();
        config.test_mode = test_mode;
        // Desktop mode: add localhost with the embedded port to CORS origins
        if !config.cors_origins.iter().any(|o| o.contains("18222")) {
            config.cors_origins.push("http://localhost:18222".to_string());
        }
        config
    }
}
