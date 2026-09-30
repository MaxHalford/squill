# Squill

[![CI](https://github.com/MaxHalford/squill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MaxHalford/squill/actions/workflows/ci.yml)

I am not satisfied with existing SQL editors, so I built [my own](https://maxhalford.github.io/squill/). It's free, it's private, it doesn't get in your way. Enjoy!

## Local development

DuckDB works without any cloud configuration. To develop with BigQuery:

1. Create a Google OAuth 2.0 **Web application** client.
2. Add `http://localhost:5173` as an authorized JavaScript origin.
3. Enable the BigQuery API in the Google Cloud project.
4. Copy `.env.example` to `.env.local` and set the client ID.
5. Run:

```sh
npm install
npm run dev
```

Quality checks:

```sh
make check
```

## Security notes for BigQuery administrators

Squill requests Google account email and `bigquery.readonly`, and keeps access tokens in memory. The BigQuery read-only scope can also authorize Cloud Storage reads where the user's IAM permissions allow them. Restrict sensitive GCS data through IAM or organization policy before approving the OAuth client. Limit BigQuery access to the intended projects through IAM; OAuth scopes cannot confine this browser client to one project. The app applies a configurable BigQuery bytes-billed cap per query, with a default of 10 GiB.

Squill is licensed under the [AGPL-3.0](LICENSE).
