/** BigQuery is the only persisted external connection. DuckDB is internal. */
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
export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb'
