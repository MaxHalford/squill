//! Billing endpoints — Polar checkout, subscription management, and webhooks.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use chrono::NaiveDateTime;
use hmac::{Mac, Hmac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::auth::middleware::AuthUser;
use crate::error::error_response;
use crate::AppState;

/// Verify the Polar webhook signature using the standard-webhooks algorithm.
///
/// 1. Extract `webhook-id`, `webhook-timestamp`, `webhook-signature` headers.
/// 2. Verify the timestamp is within 5 minutes of now.
/// 3. Compute HMAC-SHA256 over `"{msg_id}.{timestamp}.{body}"`.
/// 4. Check if any `v1,` prefixed signature in the header matches.
fn verify_webhook_signature(
    headers: &HeaderMap,
    body: &[u8],
    secret: &str,
) -> Result<(), Response> {
    let msg_id = headers
        .get("webhook-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "Missing webhook-id header"))?;

    let timestamp_str = headers
        .get("webhook-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            error_response(StatusCode::BAD_REQUEST, "Missing webhook-timestamp header")
        })?;

    let signatures = headers
        .get("webhook-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_REQUEST,
                "Missing webhook-signature header",
            )
        })?;

    // Verify timestamp is within 5 minutes
    let timestamp: i64 = timestamp_str.parse().map_err(|_| {
        error_response(StatusCode::BAD_REQUEST, "Invalid webhook-timestamp")
    })?;
    let now = chrono::Utc::now().timestamp();
    if (now - timestamp).abs() > 300 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Webhook timestamp too old or too far in the future",
        ));
    }

    // Build the signed content: "{msg_id}.{timestamp}.{body}"
    let body_str = std::str::from_utf8(body)
        .map_err(|_| error_response(StatusCode::BAD_REQUEST, "Invalid body encoding"))?;
    let to_sign = format!("{msg_id}.{timestamp_str}.{body_str}");

    // The net HMAC key is just secret.as_bytes() — Polar's SDK does
    // base64_encode(secret) then Webhook does base64_decode, which cancels out.
    let mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "HMAC key error"))?;

    // The header may contain multiple space-separated signatures.
    // Use Mac::verify_slice for constant-time comparison.
    let valid = signatures.split(' ').any(|sig| {
        if let Some(b64) = sig.strip_prefix("v1,") {
            if let Ok(sig_bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                let mut mac = mac.clone();
                mac.update(to_sign.as_bytes());
                return mac.verify_slice(&sig_bytes).is_ok();
            }
        }
        false
    });

    if !valid {
        return Err(error_response(StatusCode::BAD_REQUEST, "Invalid signature"));
    }

    Ok(())
}

/// Resolve the Polar API base URL from the config `polar_server` field.
fn polar_api_base(polar_server: &str) -> &str {
    if polar_server == "sandbox" {
        "https://sandbox-api.polar.sh"
    } else {
        "https://api.polar.sh"
    }
}

// ---------------------------------------------------------------------------
// Request / response models
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WebhookPayload {
    #[serde(rename = "type")]
    event_type: String,
    data: Value,
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/// POST /billing/checkout-session — create a Polar checkout session (auth required).
pub async fn checkout_session(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    if user.plan == "pro" {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Already subscribed to Pro",
        ));
    }

    let config = &state.config;

    // Test mode shortcut
    if config.test_mode {
        return Ok(Json(
            json!({"checkout_url": "https://test.polar.sh/checkout"}),
        ));
    }

    // Call Polar API to create a checkout session
    let base = polar_api_base(&config.polar_server);
    let client = &state.http_client;
    let resp = client
        .post(format!("{base}/v1/checkouts"))
        .header("Authorization", format!("Bearer {}", config.polar_access_token))
        .json(&json!({
            "product_price_id": config.polar_product_id,
            "success_url": format!("{}/checkout/success", config.frontend_url),
            "customer_email": user.email,
            "metadata": {
                "user_id": user.id,
            },
        }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Polar checkout request failed: {e}");
            error_response(StatusCode::BAD_GATEWAY, "Failed to create checkout session")
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("Polar checkout error {status}: {body}");
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Polar API returned an error",
        ));
    }

    let data: Value = resp.json().await.map_err(|_| {
        error_response(StatusCode::BAD_GATEWAY, "Invalid response from Polar")
    })?;

    let checkout_url = data["url"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    Ok(Json(json!({"checkout_url": checkout_url})))
}

/// POST /billing/cancel-subscription — cancel at period end (auth required).
pub async fn cancel_subscription(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    if user.plan != "pro" {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "No active Pro subscription",
        ));
    }

    let sub_id = user.polar_subscription_id.as_deref().ok_or_else(|| {
        error_response(StatusCode::BAD_REQUEST, "No subscription ID on record")
    })?;

    let config = &state.config;

    if config.test_mode {
        return Ok(Json(json!({"status": "ok"})));
    }

    let base = polar_api_base(&config.polar_server);
    let client = &state.http_client;
    let resp = client
        .patch(format!("{base}/v1/subscriptions/{sub_id}"))
        .header("Authorization", format!("Bearer {}", config.polar_access_token))
        .json(&json!({"cancel_at_period_end": true}))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Polar cancel request failed: {e}");
            error_response(StatusCode::BAD_GATEWAY, "Failed to cancel subscription")
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("Polar cancel error {status}: {body}");
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Polar API returned an error",
        ));
    }

    Ok(Json(json!({"status": "ok"})))
}

/// POST /billing/resubscribe — undo pending cancellation (auth required).
pub async fn resubscribe(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<impl IntoResponse, Response> {
    if !user.subscription_cancel_at_period_end {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Subscription is not pending cancellation",
        ));
    }

    let sub_id = user.polar_subscription_id.as_deref().ok_or_else(|| {
        error_response(StatusCode::BAD_REQUEST, "No subscription ID on record")
    })?;

    let config = &state.config;

    if config.test_mode {
        return Ok(Json(json!({"status": "ok"})));
    }

    let base = polar_api_base(&config.polar_server);
    let client = &state.http_client;
    let resp = client
        .patch(format!("{base}/v1/subscriptions/{sub_id}"))
        .header("Authorization", format!("Bearer {}", config.polar_access_token))
        .json(&json!({"cancel_at_period_end": false}))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Polar resubscribe request failed: {e}");
            error_response(StatusCode::BAD_GATEWAY, "Failed to resubscribe")
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("Polar resubscribe error {status}: {body}");
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "Polar API returned an error",
        ));
    }

    Ok(Json(json!({"status": "ok"})))
}

/// POST /billing/webhook — Polar webhook receiver (NO auth).
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, Response> {
    let config = &state.config;

    // Verify webhook signature
    verify_webhook_signature(&headers, &body, &config.polar_webhook_secret)?;

    // Parse payload
    let payload: WebhookPayload = serde_json::from_slice(&body).map_err(|e| {
        tracing::error!("Failed to parse webhook body: {e}");
        error_response(StatusCode::BAD_REQUEST, "Invalid JSON body")
    })?;

    let data = &payload.data;
    let db = &state.db;

    match payload.event_type.as_str() {
        "subscription.active" => {
            // Find user by customer email, or metadata.user_id fallback
            let email = data
                .pointer("/customer/email")
                .and_then(|v| v.as_str());
            let metadata_user_id = data
                .pointer("/metadata/user_id")
                .and_then(|v| v.as_str());

            let user_id: Option<String> = if let Some(email) = email {
                sqlx::query_scalar("SELECT id FROM users WHERE email = ?")
                    .bind(email)
                    .fetch_optional(db)
                    .await
                    .unwrap_or(None)
            } else {
                None
            };

            let user_id = user_id.or_else(|| metadata_user_id.map(|s| s.to_string()));

            let Some(user_id) = user_id else {
                tracing::warn!(
                    "subscription.active: could not resolve user (email={email:?}, metadata_user_id={metadata_user_id:?})"
                );
                return Ok(Json(json!({"status": "ok"})));
            };

            let customer_id = data["customer_id"].as_str().filter(|s| !s.is_empty());
            let subscription_id = data["id"].as_str().unwrap_or_default();
            let period_end = parse_period_end(data.get("current_period_end"));

            sqlx::query(
                "UPDATE users SET plan = 'pro', polar_customer_id = COALESCE(?, polar_customer_id),
                 polar_subscription_id = ?,
                 subscription_cancel_at_period_end = 0, plan_expires_at = ? WHERE id = ?",
            )
            .bind(customer_id)
            .bind(subscription_id)
            .bind(period_end)
            .bind(&user_id)
            .execute(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error on subscription.active: {e}");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            })?;

            tracing::info!("subscription.active: user {user_id} upgraded to pro");
        }

        "subscription.canceled" => {
            let sub_id = data["id"].as_str().unwrap_or_default();
            let period_end = parse_period_end(data.get("current_period_end"));

            sqlx::query(
                "UPDATE users SET subscription_cancel_at_period_end = 1, plan_expires_at = ?
                 WHERE polar_subscription_id = ?",
            )
            .bind(period_end)
            .bind(sub_id)
            .execute(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error on subscription.canceled: {e}");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            })?;

            tracing::info!("subscription.canceled: sub {sub_id} marked cancel-at-period-end");
        }

        "subscription.uncanceled" => {
            let sub_id = data["id"].as_str().unwrap_or_default();

            sqlx::query(
                "UPDATE users SET subscription_cancel_at_period_end = 0
                 WHERE polar_subscription_id = ?",
            )
            .bind(sub_id)
            .execute(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error on subscription.uncanceled: {e}");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            })?;

            tracing::info!("subscription.uncanceled: sub {sub_id} reactivated");
        }

        "subscription.revoked" => {
            let sub_id = data["id"].as_str().unwrap_or_default();

            sqlx::query(
                "UPDATE users SET plan = 'free', polar_subscription_id = NULL,
                 plan_expires_at = NULL, subscription_cancel_at_period_end = 0
                 WHERE polar_subscription_id = ?",
            )
            .bind(sub_id)
            .execute(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error on subscription.revoked: {e}");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            })?;

            tracing::info!("subscription.revoked: sub {sub_id} downgraded to free");
        }

        "subscription.updated" => {
            let sub_id = data["id"].as_str().unwrap_or_default();
            let period_end = parse_period_end(data.get("current_period_end"));

            sqlx::query(
                "UPDATE users SET plan_expires_at = ? WHERE polar_subscription_id = ?",
            )
            .bind(period_end)
            .bind(sub_id)
            .execute(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error on subscription.updated: {e}");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            })?;

            tracing::info!("subscription.updated: sub {sub_id} period end updated");
        }

        "subscription.past_due" => {
            tracing::warn!(
                "subscription.past_due: sub {} is past due",
                data["id"].as_str().unwrap_or("?")
            );
            // No DB changes — just log.
        }

        other => {
            tracing::debug!("Unhandled webhook event type: {other}");
        }
    }

    Ok(Json(json!({"status": "ok"})))
}

/// Parse `current_period_end` from the webhook data into a NaiveDateTime.
/// Accepts ISO 8601 strings (e.g. "2025-05-01T00:00:00Z").
fn parse_period_end(value: Option<&Value>) -> Option<NaiveDateTime> {
    value
        .and_then(|v| v.as_str())
        .and_then(|s| {
            // Try parsing as full DateTime first, then fall back to NaiveDateTime
            s.parse::<chrono::DateTime<chrono::Utc>>()
                .map(|dt| dt.naive_utc())
                .ok()
                .or_else(|| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok())
        })
}
