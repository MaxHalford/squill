# Agent Instructions

## Technology stack

- Frontend: Vue.js with TypeScript, Vite, bun.js
- Backend: Python 3.14, FastAPI, SQLAlchemy, Pydantic
- Database: PostgreSQL (production), SQLite (local)
- Pre-commit: prek with ruff + ty

## Project structure

- `/src` - Vue frontend
- `/backend` - FastAPI backend
  - `/routers` - API endpoints
  - `/services` - Business logic
  - `/models.py` - SQLAlchemy models
  - `/config.py` - Pydantic settings (reads from .env)

## Commands

```bash
# Frontend
bun install
bun run dev

# Backend
cd backend && uv sync
uv run uvicorn main:app --reload

# Code quality
prek run --all-files
```

## Features

- Web-based interface for querying and exploring databases
- Multi-database support: DuckDB, PostgreSQL, BigQuery, Snowflake
- SQL editor with syntax highlighting and error fixing
- Visual schema exploration

## UI/UX

- Desktop OS aesthetic: menu bar, movable/resizable windows, canvas dragging
- Minimalist retro look with limited color palette
- Use the semantic design system in style.css

## Code style

- Keep code clean, simple, and maintainable
- Refactor when needed to improve structure
- Add logging when debugging complex issues
- Use modern CSS features

## Error handling

- Backend: Raise HTTPException with appropriate status codes
- Frontend: Show user-friendly error messages
