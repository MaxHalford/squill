# Squill

[![CI](https://github.com/MaxHalford/squill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MaxHalford/squill/actions/workflows/ci.yml)

Squill is a static, local-first SQL canvas for exploring data with connected queries, schemas, notes, and column-analysis tools. It runs entirely in the browser and stores canvases, settings, history, schema caches, and query-result caches on your device.

There is no Squill backend, user account, subscription, server-side credential store, or analytics service.

Queries can run locally with DuckDB or directly against a connected data warehouse. BigQuery is the first supported cloud warehouse; the canvas itself is not tied to a particular SQL engine.

## BigQuery authorization

The optional BigQuery connection uses the Google Identity Services browser token flow and sends API requests directly from your browser to Google.

- Google access tokens are short-lived and kept in memory only.
- Refresh tokens and OAuth client secrets are never used or stored.
- OAuth access is limited to Google's read-only BigQuery and Cloud Platform scopes.
- A Google popup can appear when you click Connect, Run, or another action that needs a new token.
- Google's existing grant normally makes repeat authorization quick.
- Queries never run automatically. Creating a dependent query or column-analysis box does not execute it.

## Local development

DuckDB works without any cloud configuration. To develop with BigQuery:

1. Create a Google OAuth 2.0 **Web application** client.
2. Add `http://localhost:5173` as an authorized JavaScript origin.
3. Enable the BigQuery API and Cloud Resource Manager API in the Google Cloud project.
4. Copy `frontend/.env.example` to `frontend/.env.local` and set the client ID.
5. Run:

```sh
cd frontend
bun install
bun run dev
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/ci.yml` builds and deploys `frontend/dist` on pushes to `main`.

Configure the repository before the first deployment:

1. Set Pages **Source** to **GitHub Actions**.
2. Add `GOOGLE_CLIENT_ID` as an Actions repository variable or secret (the workflow also accepts `VITE_GOOGLE_CLIENT_ID`).
3. Add `https://maxhalford.github.io` to the OAuth client's authorized JavaScript origins. OAuth origins do not include the `/squill/` path.

The production landing page is `https://maxhalford.github.io/squill/`. The SQL canvas is at `https://maxhalford.github.io/squill/app/`.

## Quality checks

```sh
make check
```

Squill is licensed under the [AGPL-3.0](LICENSE).
