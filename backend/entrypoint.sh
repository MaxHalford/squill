#!/bin/sh

# Extract file path from DATABASE_URL (e.g. "sqlite:///data/squill.db" -> "/data/squill.db")
DB_PATH="${DATABASE_URL#sqlite:}"

# Start sqlite-web on internal port with /admin prefix
/opt/sqlite-web/bin/sqlite_web "$DB_PATH" \
    --host 0.0.0.0 \
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
