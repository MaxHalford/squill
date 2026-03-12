# squill-hocuspocus

Real-time collaborative canvas sync for Squill Pro users, powered by [Hocuspocus](https://tiptap.dev/hocuspocus) and [Yjs](https://yjs.dev).

## What it does

- Accepts WebSocket connections from the Squill frontend (`canvas:{canvasId}` document names)
- Authenticates connections using either a **JWT session token** (Pro user, full write access) or a **share token** (anyone with the link, read-only or write)
- Loads and persists Yjs binary state from the `canvases.yjs_state` column in PostgreSQL
- Enforces read-only mode server-side for anonymous share-link viewers

## Requirements

- [Bun](https://bun.sh) v1.0+
- A **PostgreSQL** database (the same one used by the FastAPI backend)
  - SQLite is not supported — the `pg` driver requires Postgres

## Setup

```bash
cp .env.example .env
# fill in JWT_SECRET (must match backend/.env) and DATABASE_URL
bun install
```

## Running

```bash
# Development (hot-reload)
bun run dev

# Production
bun run start
```

Listens on `PORT` (default `1234`). The frontend connects via `VITE_HOCUSPOCUS_URL` (e.g. `ws://localhost:1234` for local dev, `wss://hocuspocus.squill.dev` in production).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | Must match `JWT_SECRET` in `backend/.env`. Used to verify user session tokens. |
| `DATABASE_URL` | ✅ | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/dbname` |
| `PORT` | | WebSocket port. Defaults to `1234`. |

## Deployment (Railway)

Deploy as a separate Railway service in the same project as the FastAPI backend:

1. Set `DATABASE_URL` to the same Postgres instance the backend uses
2. Set `JWT_SECRET` to the same value as the backend
3. Set `PORT` via Railway's port settings (or leave at 1234)
4. Set `VITE_HOCUSPOCUS_URL` in the frontend service to `wss://your-hocuspocus.railway.app`
