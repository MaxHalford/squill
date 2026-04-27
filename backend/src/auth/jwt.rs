use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

/// JWT claims — must match the Python backend's payload exactly.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub email: String,
    pub exp: i64,
}

/// Create a JWT session token (HS256) identical to the Python backend.
pub fn create_session_token(
    user_id: &str,
    email: &str,
    secret: &str,
    expiration_days: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = Utc::now() + Duration::days(expiration_days);
    let claims = Claims {
        user_id: user_id.to_string(),
        email: email.to_string(),
        exp: exp.timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Verify and decode a JWT session token.
pub fn verify_session_token(
    token: &str,
    secret: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.set_required_spec_claims(&["exp"]);

    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}
