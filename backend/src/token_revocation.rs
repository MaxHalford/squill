//! JWT token revocation list backed by SQLite.
//!
//! Stores SHA-256 hashes of revoked tokens so that logout actually invalidates
//! sessions before their natural expiry.

use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// Hash a raw JWT string for storage in the revocation table.
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Add a token to the revocation list.
pub async fn revoke_token(
    db: &SqlitePool,
    token: &str,
    expires_at: &str,
) -> Result<(), sqlx::Error> {
    let token_hash = hash_token(token);
    sqlx::query(
        "INSERT OR IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)",
    )
    .bind(&token_hash)
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok(())
}

/// Check whether a token has been revoked.
pub async fn is_token_revoked(db: &SqlitePool, token: &str) -> bool {
    let token_hash = hash_token(token);
    sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM revoked_tokens WHERE token_hash = ?",
    )
    .bind(&token_hash)
    .fetch_one(db)
    .await
    .unwrap_or(0)
        > 0
}

/// Delete revoked tokens whose JWT has already expired (cleanup).
pub async fn cleanup_expired_revocations(db: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM revoked_tokens WHERE expires_at < datetime('now')",
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}
