# Agent Instructions

## Architecture

- Static Vue and TypeScript application built with Vite and Bun.
- Hosted from `frontend/dist` on GitHub Pages.
- BigQuery is the only external database integration.
- DuckDB WebAssembly is an internal client-side result cache and query engine.
- There is no application backend, user account system, subscription, or server-side secret storage.
- Google access tokens stay in memory; persisted connections contain metadata only.
- Never trigger a query without an explicit user action.

## Commands

```sh
cd frontend && bun install
cd frontend && bun run dev
make check
```
