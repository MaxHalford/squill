/**
 * BigQuery is the only external query engine. DuckDB runs locally to cache
 * results and evaluate transformations between canvas boxes.
 */
export type DatabaseEngine = 'duckdb' | 'bigquery'

export const DATABASE_ENGINES: readonly DatabaseEngine[] = ['duckdb', 'bigquery'] as const

export type ConnectionType = 'client'

export interface DatabaseInfo {
  id: DatabaseEngine
  name: string
  shortName: string
  logo: string
  color: string
  textColor: string
  connectionType: ConnectionType
  badge: string
  shortDescription: string
  longDescription: string
  authMethod: string
  dataPrivacy: string
}

export const DATABASE_INFO: Record<DatabaseEngine, DatabaseInfo> = {
  duckdb: {
    id: 'duckdb',
    name: 'DuckDB',
    shortName: 'DK',
    logo: '/logos/duckdb.svg',
    color: '#FFF100',
    textColor: '#2e2e2e',
    connectionType: 'client',
    badge: 'Runs locally',
    shortDescription: 'In-browser result cache and transformation engine',
    longDescription: 'DuckDB WebAssembly runs entirely in your browser and stores BigQuery results locally for display and canvas transformations.',
    authMethod: 'None',
    dataPrivacy: 'Processing happens locally in your browser.',
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
    shortDescription: 'Query Google BigQuery directly from your browser',
    longDescription: 'Squill sends explicitly-run queries directly from your browser to BigQuery. Short-lived access tokens remain in memory.',
    authMethod: 'Google Identity Services OAuth',
    dataPrivacy: 'Queries go directly to Google; Squill has no application backend.',
  },
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
