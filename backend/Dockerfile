FROM rust:1.92-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
COPY migrations/ migrations/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    sqlite3 \
    python3 \
    python3-pip \
    python3-venv \
    caddy \
    && python3 -m venv /opt/sqlite-web \
    && /opt/sqlite-web/bin/pip install sqlite-web \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/squill-server /usr/local/bin/squill-server
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000

CMD ["entrypoint.sh"]
