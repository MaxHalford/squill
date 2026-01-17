/**
 * Supported database connection types
 * Add new database types here as they are implemented
 */
export type ConnectionType = 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'

/**
 * Database connection configuration
 * Encapsulates connection-related data including session info
 * Note: Access tokens are stored in memory only (not persisted)
 */
export interface Connection {
  id: string
  type: ConnectionType
  name: string
  createdAt: number

  // Session info (for remote connections like BigQuery)
  email?: string

  // Context within the connection
  // For BigQuery: the selected project
  // For Postgres/Snowflake: could be database/schema
  projectId?: string

  // PostgreSQL specific
  database?: string
}

/**
 * Check if a connection type represents a local/in-memory database
 */
export function isLocalConnectionType(type: ConnectionType | undefined): boolean

/**
 * Get the SQL dialect for CodeMirror based on connection type
 * Note: Snowflake uses PostgreSQL dialect as they are largely compatible
 */
export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb' | 'postgres'
