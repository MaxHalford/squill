# Contributing to Squill

Squill is a static Vue and TypeScript application. BigQuery is the only external database; DuckDB WebAssembly is used internally for cached results and local transformations.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later (includes npm)
- A modern browser
- A Google OAuth Web application client for testing authorization

## Setup

```sh
git clone https://github.com/MaxHalford/squill
cd squill
cp .env.example .env.local
npm install
npm run dev
```

Set `VITE_GOOGLE_CLIENT_ID` in `.env.local`. Register `http://localhost:5173` as an authorized JavaScript origin and enable the BigQuery and Cloud Resource Manager APIs.

## Checks

```sh
npm run type-check
npm run lint
npm run test:run
npm run build
```

Please preserve the product's core constraints:

- no application backend or server-side secrets;
- access tokens remain in memory;
- no query executes without an explicit user action;
- persisted connection data contains metadata only; and
- BigQuery is the only external database integration.
