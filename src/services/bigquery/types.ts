/**
 * BigQueryClient interface and result types.
 *
 * The interface keeps BigQuery call sites decoupled from the browser-based
 * OAuth implementation.
 */

import type {
  BigQueryProject,
  BigQueryDataset,
  BigQueryTable,
  BigQueryField,
  BigQueryJobReference,
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
  jobReference?: BigQueryJobReference
  stats: { totalBytesProcessed?: string; cacheHit?: boolean }
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
   * Submit a query or fetch another page from the existing job.
   */
  runQueryPaginated(
    query: string,
    projectId: string,
    options?: {
      maxResults?: number
      pageToken?: string
      jobReference?: BigQueryJobReference
      signal?: AbortSignal | null
    },
  ): Promise<BigQueryPaginatedQueryResult>

  /**
   * Fetch the execution plan for a completed job, or null if unavailable.
   */
  fetchQueryPlan(projectId: string, jobId: string): Promise<unknown>
}
