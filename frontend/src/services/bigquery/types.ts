/**
 * BigQueryClient interface and result types.
 *
 * The interface abstracts how BigQuery is accessed so future transports
 * (e.g. service-account-based auth, native bigquery-rs client) can be added
 * without touching call sites. Today there's a single OAuth implementation
 * that runs equally well in the browser and in the Tauri webview.
 */

import type {
  BigQueryProject,
  BigQueryDataset,
  BigQueryTable,
  BigQueryField,
} from '../../types/bigquery'
import type { TableMetadataInfo } from '../../types/database'

/**
 * Result of a non-paginated query execution. Rows are normalized to the
 * flat `{ column: value }` shape (already converted from BigQuery's
 * `{ f: [{ v: ... }] }` REST format if applicable).
 */
export interface BigQueryQueryResult {
  rows: Record<string, unknown>[]
  schema?: { name: string; type: string }[]
  stats: { totalBytesProcessed?: string; cacheHit?: boolean }
}

export interface BigQueryPaginatedQueryResult {
  rows: Record<string, unknown>[]
  columns: { name: string; type: string }[]
  totalRows: number | null
  hasMore: boolean
  pageToken?: string
  jobReference?: { projectId: string; jobId: string }
  stats: { totalBytesProcessed?: string; cacheHit?: boolean }
}

export interface DryRunResult {
  totalBytesProcessed: string
  estimatedCost: string
  error?: string
}

export interface BigQueryClient {
  /** List BigQuery projects accessible to this connection. */
  listProjects(): Promise<BigQueryProject[]>

  /** List datasets within a project. */
  listDatasets(projectId: string): Promise<BigQueryDataset[]>

  /** List tables in a dataset. */
  listTables(projectId: string, datasetId: string): Promise<BigQueryTable[]>

  /** Fetch the schema and metadata (row count, partitioning, etc.) for one table. */
  getTableSchema(
    projectId: string,
    datasetId: string,
    tableId: string,
  ): Promise<{ fields: BigQueryField[]; metadata: TableMetadataInfo }>

  /** Run a SQL query and return all rows. */
  runQuery(
    query: string,
    projectId: string,
    signal?: AbortSignal | null,
  ): Promise<BigQueryQueryResult>

  /**
   * Run a SQL query with pagination support.
   * Note: the CLI implementation returns the full result in a single page
   * (hasMore: false) since `bq query` doesn't expose pageToken.
   */
  runQueryPaginated(
    query: string,
    projectId: string,
    options?: {
      maxResults?: number
      pageToken?: string
      signal?: AbortSignal | null
    },
  ): Promise<BigQueryPaginatedQueryResult>

  /** Estimate query cost without executing. */
  dryRunQuery(query: string, projectId: string): Promise<DryRunResult>

  /**
   * Fetch the execution plan for a completed job, or null if unavailable.
   */
  fetchQueryPlan(projectId: string, jobId: string): Promise<unknown>
}
