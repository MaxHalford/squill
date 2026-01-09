-- Squill database schema
-- Run this to set up the PostgreSQL database

CREATE TABLE IF NOT EXISTS user_tokens (
    email VARCHAR(255) PRIMARY KEY,
    refresh_token_encrypted BYTEA NOT NULL,
    encryption_iv BYTEA NOT NULL,
    user_name VARCHAR(255),
    user_photo VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups by email (already covered by PRIMARY KEY, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_user_tokens_email ON user_tokens(email);
