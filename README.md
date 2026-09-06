# Squill

[![CI](https://github.com/MaxHalford/squill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MaxHalford/squill/actions/workflows/ci.yml)

Squill is a static, local-first BigQuery canvas. It runs on GitHub Pages, sends BigQuery API requests directly from your browser to Google, and stores canvases, settings, history, schema caches, and query-result caches on your device.

There is no Squill backend, user account, subscription, server-side credential store, or analytics service.

## Security and authorization

Squill uses the Google Identity Services browser token flow.

- Google access tokens are short-lived and kept in memory only.
- Refresh tokens and OAuth client secrets are never used or stored.
- OAuth access is limited to Google's read-only BigQuery and Cloud Platform scopes.
- A Google popup can appear when you click Connect, Run, or another action that needs a new token.
- Google's existing grant normally makes repeat authorization quick.
- Queries never run automatically. Creating a dependent query or column-analysis box does not execute it.

## Local development

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
2. Add an Actions repository variable named `GOOGLE_CLIENT_ID`.
3. Add the production origin, such as `https://squill.dev`, to the OAuth client's authorized JavaScript origins.
4. If you do not use `squill.dev`, change or remove `frontend/public/CNAME` and adjust Vite's base path as needed.

## Quality checks

```sh
make check
```

Squill is licensed under the [AGPL-3.0](LICENSE).
