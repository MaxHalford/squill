/** BigQuery is an external connection; DuckDB is a local connection. */
export type ConnectionType = 'bigquery' | 'duckdb'

/** Persisted connection metadata. OAuth access tokens live in memory only. */
export interface Connection {
  id: string
  type: ConnectionType
  name: string
  createdAt: number
  email?: string
  projectId?: string
  schemaProjectIds?: string[]
}

export function isLocalConnectionType(type: ConnectionType | undefined): boolean
