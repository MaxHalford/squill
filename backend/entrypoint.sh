#!/bin/sh

# Fail fast if admin credentials are missing
if [ -z "$ADMIN_PASSWORD_HASH" ]; then
    echo "ERROR: ADMIN_PASSWORD_HASH must be set" >&2
    exit 1
fi

# Extract file path from DATABASE_URL (e.g. "sqlite:///data/squill.db" -> "/data/squill.db")
DB_PATH="${DATABASE_URL#sqlite:}"

# Start sqlite-web on loopback only (Caddy handles external access with basicauth)
/opt/sqlite-web/bin/sqlite_web "$DB_PATH" \
    --host 127.0.0.1 \
    --port 8001 \
    --url-prefix /admin \
    --no-browser \
    --foreign-keys \
    -P \
    &

# Start the Rust backend on internal port
squill-server --port 8002 &

# Start Caddy as reverse proxy on the Railway-exposed port
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
