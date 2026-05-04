use axum::extract::FromRequestParts;
use axum::response::IntoResponse;
use http::request::Parts;
use http::StatusCode;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::AppState;

/// Simple in-memory IP-based rate limiter using a sliding window.
///
/// Tracks request timestamps per key (typically client IP) and rejects
/// requests that exceed `max_requests` within `window`.
pub struct RateLimiter {
    cache: Mutex<LruCache<String, Vec<Instant>>>,
    max_requests: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window_secs: u64) -> Self {
        Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(10_000).unwrap())),
            max_requests,
            window: Duration::from_secs(window_secs),
        }
    }

    /// Returns `true` if the request is allowed, `false` if rate-limited.
    pub fn check(&self, key: &str) -> bool {
        let mut cache = self.cache.lock().unwrap();
        let now = Instant::now();

        let entry = cache.get_or_insert_mut(key.to_string(), Vec::new);
        entry.retain(|t| now.duration_since(*t) < self.window);

        if entry.len() >= self.max_requests {
            false
        } else {
            entry.push(now);
            true
        }
    }
}

/// Axum extractor that enforces rate limiting per client IP.
///
/// Add `_: RateLimited` to any handler's parameters to automatically
/// reject requests that exceed the rate limit.
pub struct RateLimited;

impl FromRequestParts<AppState> for RateLimited {
    type Rejection = axum::response::Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ip = parts
            .headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        if !state.rate_limiter.check(&ip) {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                axum::Json(serde_json::json!({
                    "error": "rate_limit_exceeded",
                    "error_description": "Too many requests. Please try again later."
                })),
            )
                .into_response());
        }

        Ok(Self)
    }
}
