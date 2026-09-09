/** BigQuery runs remotely; DuckDB is also available as a local query engine. */
export type DatabaseEngine = 'duckdb' | 'bigquery'

export interface DatabaseInfo {
  id: DatabaseEngine
  name: string
  shortName: string
  logo: string
  color: string
  textColor: string
  badge: string
  shortDescription: string
  longDescription: string
  authMethod: string
  dataPrivacy: string
}

const PUBLIC_BASE_URL = import.meta.env.BASE_URL

export const DATABASE_INFO: Record<DatabaseEngine, DatabaseInfo> = {
  duckdb: {
    id: 'duckdb',
    name: 'DuckDB',
    shortName: 'DK',
    logo: `${PUBLIC_BASE_URL}logos/duckdb.svg`,
    color: '#FFF100',
    textColor: '#2e2e2e',
    badge: 'Runs locally',
    shortDescription: 'Run SQL locally in your browser',
    longDescription: 'DuckDB WebAssembly runs entirely in your browser for local SQL queries, result display, and canvas transformations.',
    authMethod: 'None',
    dataPrivacy: 'Processing happens locally in your browser.',
  },
  bigquery: {
    id: 'bigquery',
    name: 'BigQuery',
    shortName: 'BQ',
    logo: `${PUBLIC_BASE_URL}logos/bigquery.svg`,
    color: '#4285F4',
    textColor: '#FFFFFF',
    badge: 'Requires OAuth',
    shortDescription: 'Query Google BigQuery directly from your browser',
    longDescription: 'Squill sends explicitly-run queries directly from your browser to BigQuery. Short-lived access tokens remain in memory.',
    authMethod: 'Google Identity Services OAuth',
    dataPrivacy: 'Queries go directly to Google; Squill has no application backend.',
  },
}
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
