/**
 * Types for the two-tier pagination system:
 * - Fetch pagination: 5000 rows per batch from BigQuery
 * - Display pagination: 100 rows per page in the UI
 */

import type { DatabaseEngine } from './database'

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
  sourceEngine: DatabaseEngine

  /** BigQuery: page token for continuation */
  pageToken?: string

  /** Original query for fetching more rows */
  originalQuery?: string

  /** Connection ID for remote queries */
  connectionId?: string

  /** Schema from source for appending data */
  schema?: { name: string; type: string }[]
}
