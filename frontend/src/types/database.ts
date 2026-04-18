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
export type DatabaseEngine = 'duckdb' | 'bigquery' | 'clickhouse' | 'snowflake'

/**
 * Array of all supported engines (useful for iteration/validation)
 */
export const DATABASE_ENGINES: readonly DatabaseEngine[] = ['duckdb', 'bigquery', 'clickhouse', 'snowflake'] as const

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
    logo: '/logos/duckdb.svg',
    color: '#FFF100',
    textColor: '#2e2e2e',
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
    logo: '/logos/bigquery.svg',
    color: '#4285F4',
    textColor: '#FFFFFF',
    connectionType: 'client',
    badge: 'Requires OAuth',
    shortDescription: 'Connect to Google BigQuery for cloud data warehouse queries',
    longDescription: 'Connect directly to BigQuery using OAuth. Queries are sent from your browser to BigQuery, and results are streamed back. Squill only stores a refresh token to maintain your session.',
    authMethod: 'OAuth with Google account',
    dataPrivacy: 'Queries run directly against BigQuery from your browser. Only OAuth tokens are stored (encrypted). Query results stay in your browser.'
  },
  clickhouse: {
    id: 'clickhouse',
    name: 'ClickHouse',
    shortName: 'CH',
    logo: '/logos/clickhouse.svg',
    color: '#161616',
    textColor: '#FFFFFF',
    connectionType: 'client',
    badge: 'Requires credentials',
    shortDescription: 'Fast open-source columnar database for real-time analytics',
    longDescription: 'Queries are sent directly from your browser to ClickHouse via its HTTP API. Your credentials and data never pass through Squill servers.',
    authMethod: 'Database credentials (host, port, user, password)',
    dataPrivacy: 'Queries run directly from your browser to ClickHouse. Credentials are stored locally in your browser. No data passes through Squill servers.'
  },
  snowflake: {
    id: 'snowflake',
    name: 'Snowflake',
    shortName: 'SF',
    logo: '/logos/snowflake.svg',
    color: '#29B5E8',
    textColor: '#FFFFFF',
    connectionType: 'client',
    badge: 'Requires credentials',
    shortDescription: 'Cloud data platform for analytics and data warehousing',
    longDescription: 'Queries are sent directly from your browser to Snowflake via its SQL REST API. Your credentials and data never pass through Squill servers.',
    authMethod: 'Snowflake credentials (account, user, password, warehouse)',
    dataPrivacy: 'Queries run directly from your browser to Snowflake. Credentials are stored locally in your browser. No data passes through Squill servers.'
  }
}

/**
 * Get database info by engine
 */
export const getDatabaseInfo = (engine: DatabaseEngine): DatabaseInfo => DATABASE_INFO[engine]

/**
 * Metadata about a table, displayed in the SchemaBox metadata pane.
 */
export interface TableMetadataInfo {
  rowCount: number | null
  sizeBytes: number | null
  tableType?: string | null
  clusteringFields?: string[]
  partitioning?: string | null
  engine: DatabaseEngine
}

/**
 * Event emitted when a query completes execution.
 * Extracted here so plain .ts files can import it without depending on .vue module resolution.
 */
export interface QueryCompleteEvent {
  tableName: string
  rowCount: number
  columns: string[]
  executionTimeMs: number
  engine: DatabaseEngine
  stats?: { totalBytesProcessed?: string; cacheHit?: boolean }
}
