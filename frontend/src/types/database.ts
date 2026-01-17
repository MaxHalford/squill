/**
 * Database Types
 *
 * Single source of truth for database engine/dialect types.
 * All supported database engines must be listed here.
 */

/**
 * Supported database engines.
 * Used for query execution, SQL dialect selection, and connection types.
 */
export type DatabaseEngine = 'duckdb' | 'bigquery' | 'postgres' | 'snowflake'

/**
 * Array of all supported engines (useful for iteration/validation)
 */
export const DATABASE_ENGINES: readonly DatabaseEngine[] = ['duckdb', 'bigquery', 'postgres', 'snowflake'] as const

/**
 * Connection type - how queries are executed
 */
export type ConnectionType = 'client' | 'server'

/**
 * Database information for display and configuration
 */
export interface DatabaseInfo {
  id: DatabaseEngine
  name: string
  shortName: string
  logo: string
  color: string
  textColor: string  // Text color for badges (contrast with color)
  connectionType: ConnectionType
  badge: string
  shortDescription: string
  longDescription: string
  authMethod: string
  dataPrivacy: string
}

/**
 * Complete database information - single source of truth for logos, descriptions, etc.
 */
export const DATABASE_INFO: Record<DatabaseEngine, DatabaseInfo> = {
  duckdb: {
    id: 'duckdb',
    name: 'DuckDB',
    shortName: 'DK',
    logo: 'https://images.seeklogo.com/logo-png/55/1/duckdb-icon-logo-png_seeklogo-554697.png',
    color: '#FFF000',
    textColor: '#000000',
    connectionType: 'client',
    badge: 'No setup needed',
    shortDescription: 'Local database that runs in your browser with CSV support',
    longDescription: 'DuckDB runs entirely in your browser using WebAssembly. Your data never leaves your device. Perfect for quick analysis of CSV files and local data exploration.',
    authMethod: 'None required',
    dataPrivacy: 'All processing happens locally in your browser. No data is sent to any server.'
  },
  bigquery: {
    id: 'bigquery',
    name: 'BigQuery',
    shortName: 'BQ',
    logo: 'https://cdn.worldvectorlogo.com/logos/google-bigquery-logo-1.svg',
    color: '#4285F4',
    textColor: '#FFFFFF',
    connectionType: 'client',
    badge: 'Requires OAuth',
    shortDescription: 'Connect to Google BigQuery for cloud data warehouse queries',
    longDescription: 'Connect directly to BigQuery using OAuth. Queries are sent from your browser to BigQuery, and results are streamed back. Squill only stores a refresh token to maintain your session.',
    authMethod: 'OAuth with Google account',
    dataPrivacy: 'Queries run directly against BigQuery from your browser. Only OAuth tokens are stored (encrypted). Query results stay in your browser.'
  },
  postgres: {
    id: 'postgres',
    name: 'PostgreSQL',
    shortName: 'PG',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Postgresql_elephant.svg/993px-Postgresql_elephant.svg.png',
    color: '#336791',
    textColor: '#FFFFFF',
    connectionType: 'server',
    badge: 'Requires credentials',
    shortDescription: 'Connect to PostgreSQL databases for powerful relational queries',
    longDescription: 'PostgreSQL connections require a backend server to proxy queries. The Squill backend executes your query and streams results to your browser without storing them.',
    authMethod: 'Database credentials (host, port, user, password)',
    dataPrivacy: 'Queries are proxied through the Squill backend but results are not stored. Connection credentials are encrypted at rest.'
  },
  snowflake: {
    id: 'snowflake',
    name: 'Snowflake',
    shortName: 'SF',
    logo: 'https://avatars.githubusercontent.com/u/6453780?s=280&v=4',
    color: '#29B5E8',
    textColor: '#FFFFFF',
    connectionType: 'server',
    badge: 'Requires credentials',
    shortDescription: 'Cloud data platform for analytics and data warehousing',
    longDescription: 'Snowflake connections require a backend server to proxy queries. The Squill backend executes your query and streams results to your browser without storing them.',
    authMethod: 'Snowflake credentials (account, user, password, warehouse)',
    dataPrivacy: 'Queries are proxied through the Squill backend but results are not stored. Connection credentials are encrypted at rest.'
  }
}

/**
 * Get database info by engine
 */
export const getDatabaseInfo = (engine: DatabaseEngine): DatabaseInfo => DATABASE_INFO[engine]
