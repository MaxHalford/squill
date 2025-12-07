/**
 * Types for the two-tier pagination system:
 * - Fetch pagination: 5000 rows per batch from source databases
 * - Display pagination: 100 rows per page in the UI
 */

export type SourceEngine = 'bigquery' | 'postgres' | 'duckdb'

/**
 * Tracks fetch state for a query result.
 * Managed per SQL box to support incremental loading.
 */
export interface QueryFetchState {
  /** Total rows in source (from COUNT or API metadata) */
  totalRows: number | null
  /** Rows currently loaded in DuckDB */
  fetchedRows: number
  /** More rows available from source */
  hasMoreRows: boolean
  /** Fetch currently in progress */
  isFetching: boolean
  /** Background loading in progress */
  isBackgroundLoading: boolean
  /** Source database engine */
  sourceEngine: SourceEngine

  /** BigQuery: page token for continuation */
  pageToken?: string

  /** Postgres: offset for next fetch */
  nextOffset?: number

  /** Original query for fetching more rows */
  originalQuery?: string

  /** Connection ID for remote queries */
  connectionId?: string

  /** Schema from source for appending data */
  schema?: { name: string; type: string }[]
}

/**
 * Response from paginated query endpoints
 */
export interface PaginatedQueryResponse {
  rows: Record<string, unknown>[]
  schema: { name: string; type: string }[]
  /** Total rows in source (from COUNT) - only on first request */
  totalRows: number | null
  /** More rows available */
  hasMore: boolean
  /** BigQuery page token for next request */
  pageToken?: string
  /** Postgres offset for next request */
  nextOffset?: number
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

/**
 * BigQuery specific paginated response metadata
 */
export interface BigQueryPaginatedMeta {
  totalRows: number
  pageToken?: string
}

/**
 * Postgres specific paginated response
 */
export interface PostgresPaginatedResponse {
  rows: Record<string, unknown>[]
  schema: { name: string; type: string }[]
  totalRows: number | null
  hasMore: boolean
  nextOffset: number
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}
