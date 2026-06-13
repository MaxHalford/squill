-- BigQuery OAuth is now fully client-side (PKCE); refresh tokens live in the
-- browser's IndexedDB. The server no longer has any record of BigQuery
-- connections, so this table can be dropped.
DROP TABLE IF EXISTS bigquery_connections;
