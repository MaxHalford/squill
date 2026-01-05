/**
 * Supported database connection types
 * Add new database types here as they are implemented
 */
export type ConnectionType = 'bigquery' | 'duckdb' // Future: 'postgres' | 'snowflake' | 'mysql'

/**
 * Database connection configuration
 * Encapsulates all connection-related data including auth and context
 */
export interface Connection {
  id: string
  type: ConnectionType
  name: string
  createdAt: number

  // Authentication (for remote connections like BigQuery)
  email?: string
  photo?: string
  token?: string
  tokenExpiry?: number

  // Context within the connection
  // For BigQuery: the selected project
  // For Postgres/Snowflake: could be database/schema
  projectId?: string
}

/**
 * Check if a connection type represents a local/in-memory database
 */
export function isLocalConnectionType(type: ConnectionType | undefined): boolean

/**
 * Get the SQL dialect for CodeMirror based on connection type
 */
export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb'
