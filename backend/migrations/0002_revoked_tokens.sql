-- JWT revocation list: tokens added here are rejected by the auth middleware.
-- Expired entries are periodically cleaned up by a background task.

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,  -- SHA-256 of the JWT (avoids storing raw tokens)
    expires_at TEXT NOT NULL,              -- same expiry as the JWT; used for cleanup
    revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
