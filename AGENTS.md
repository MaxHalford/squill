# Agent instructions

## Architecture

- Static Vue and TypeScript application built with Vite and npm.
- Hosted from `dist` on GitHub Pages.
- BigQuery is the only external database integration.
- DuckDB WebAssembly is an internal client-side result cache and query engine.
- There is no application backend, user account system, subscription, or server-side secret storage.
- Google access tokens stay in memory; persisted connections contain metadata only.
- Never trigger a query without an explicit user action.

## Commands

```sh
npm install
npm run dev
make check
```
