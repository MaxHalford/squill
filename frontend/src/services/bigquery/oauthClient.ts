/**
 * OAuth-based BigQueryClient implementation.
 *
 * Talks to the BigQuery REST API directly from the browser using OAuth tokens
 * managed by the connections store (which handles refresh).
 */

import { useConnectionsStore } from '../../stores/connections'
import { convertBigQueryRows, extractSimpleSchema } from '../../utils/bigqueryConversion'
import { formatBytes } from '../../utils/formatUtils'
import type {
  BigQueryProject,
  BigQueryDataset,
  BigQueryTable,
  BigQueryField,
  BigQueryQueryResponse,
  BigQueryTableDetail,
} from '../../types/bigquery'
import type { TableMetadataInfo } from '../../types/database'
import type {
  BigQueryClient,
  BigQueryQueryResult,
  BigQueryPaginatedQueryResult,
  DryRunResult,
} from './types'

const BQ_BASE = 'https://bigquery.googleapis.com/bigquery/v2'

function extractTableMetadata(data: BigQueryTableDetail): TableMetadataInfo {
  return {
    rowCount: data.numRows ? parseInt(data.numRows, 10) : null,
    sizeBytes: data.numBytes ? parseInt(data.numBytes, 10) : null,
    tableType: data.type || null,
    clusteringFields: data.clustering?.fields,
    partitioning: data.timePartitioning
      ? `${data.timePartitioning.type || 'DAY'}${data.timePartitioning.field ? ` on ${data.timePartitioning.field}` : ''}`
      : undefined,
    engine: 'bigquery',
  }
}

export function createOAuthClient(connectionId: string): BigQueryClient {
  const connectionsStore = useConnectionsStore()

  async function getToken(): Promise<string> {
    const cached = connectionsStore.getAccessToken(connectionId)
    if (cached) return cached
    return connectionsStore.refreshAccessToken(connectionId)
  }

  /** Run one fetch, auto-retry once on 401 after refreshing the token. */
  async function fetchWith401Retry(
    makeRequest: (token: string) => Promise<Response>,
  ): Promise<Response> {
    let token = await getToken()
    let response = await makeRequest(token)
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await makeRequest(token)
    }
    return response
  }

  /** Fetch + 401-retry + parse JSON. Throws on non-OK with the API error message. */
  async function apiCall<T>(makeRequest: (token: string) => Promise<Response>): Promise<T> {
    const response = await fetchWith401Retry(makeRequest)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || 'API call failed')
    }
    return response.json()
  }

  async function paginatedList<T>(baseUrl: string, itemsKey: string): Promise<T[]> {
    const allItems: T[] = []
    let pageToken: string | undefined

    do {
      const url = pageToken ? `${baseUrl}?${new URLSearchParams({ pageToken })}` : baseUrl
      const data = await apiCall<Record<string, unknown>>(token =>
        fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
      )
      const items = (data[itemsKey] as T[] | undefined) || []
      allItems.push(...items)
      pageToken = data.nextPageToken as string | undefined
    } while (pageToken)

    return allItems
  }

  /** Poll getQueryResults with exponential backoff until the job completes. */
  async function pollQueryResults(
    projectId: string,
    jobId: string,
    signal: AbortSignal | null,
    maxResults?: number,
  ): Promise<BigQueryQueryResponse> {
    const baseDelay = 500
    const maxDelay = 5000
    let attempt = 0

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      const delay = Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay)
      await new Promise(resolve => setTimeout(resolve, delay))
      attempt++

      const params = new URLSearchParams({ timeoutMs: '10000' })
      if (maxResults !== undefined) params.set('maxResults', String(maxResults))

      const data = await apiCall<BigQueryQueryResponse>(token => {
        const fetchOptions: RequestInit = {
          headers: { Authorization: `Bearer ${token}` },
        }
        if (signal) fetchOptions.signal = signal
        return fetch(`${BQ_BASE}/projects/${projectId}/queries/${jobId}?${params}`, fetchOptions)
      })
      if (data.jobComplete !== false) return data
    }
  }

  /**
   * Submit a query to jobs.query, handle 401-retry, and poll if the job didn't
   * complete synchronously. Shared by runQuery / runQueryPaginated / dryRunQuery.
   */
  async function submitQuery(
    projectId: string,
    body: Record<string, unknown>,
    signal: AbortSignal | null,
    pollMaxResults?: number,
  ): Promise<BigQueryQueryResponse> {
    const data = await apiCall<BigQueryQueryResponse>(token => {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
      if (signal) fetchOptions.signal = signal
      return fetch(`${BQ_BASE}/projects/${projectId}/queries`, fetchOptions)
    })

    if (data.jobComplete === false && data.jobReference) {
      return pollQueryResults(projectId, data.jobReference.jobId, signal, pollMaxResults)
    }
    return data
  }

  return {
    async listProjects(): Promise<BigQueryProject[]> {
      const data = await apiCall<{
        projects?: Array<{ projectId: string; displayName?: string; state: string }>
      }>(token =>
        fetch(
          'https://cloudresourcemanager.googleapis.com/v3/projects:search?query=state:ACTIVE',
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      )
      return (data.projects || []).map(p => ({
        projectId: p.projectId,
        name: p.displayName || p.projectId,
      }))
    },

    async listDatasets(projectId: string): Promise<BigQueryDataset[]> {
      return paginatedList<BigQueryDataset>(
        `${BQ_BASE}/projects/${projectId}/datasets`,
        'datasets',
      )
    },

    async listTables(projectId: string, datasetId: string): Promise<BigQueryTable[]> {
      return paginatedList<BigQueryTable>(
        `${BQ_BASE}/projects/${projectId}/datasets/${datasetId}/tables`,
        'tables',
      )
    },

    async getTableSchema(
      projectId: string,
      datasetId: string,
      tableId: string,
    ): Promise<{ fields: BigQueryField[]; metadata: TableMetadataInfo }> {
      const data = await apiCall<BigQueryTableDetail>(token =>
        fetch(
          `${BQ_BASE}/projects/${projectId}/datasets/${datasetId}/tables/${tableId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      )
      return {
        fields: data.schema?.fields || [],
        metadata: extractTableMetadata(data),
      }
    },

    async runQuery(
      query: string,
      projectId: string,
      signal: AbortSignal | null = null,
    ): Promise<BigQueryQueryResult> {
      const data = await submitQuery(projectId, {
        query,
        useLegacySql: false,
        useQueryCache: true,
        formatOptions: { useInt64Timestamp: false },
      }, signal)

      const stats = {
        totalBytesProcessed: data.totalBytesProcessed || '0',
        cacheHit: data.cacheHit || false,
      }
      if (data.schema && data.rows) {
        const rows = convertBigQueryRows(data.rows, data.schema.fields)
        return { rows, schema: extractSimpleSchema(data.schema.fields), stats }
      }
      return { rows: [], schema: [], stats }
    },

    async runQueryPaginated(
      query: string,
      projectId: string,
      options: { maxResults?: number; pageToken?: string; signal?: AbortSignal | null } = {},
    ): Promise<BigQueryPaginatedQueryResult> {
      const maxResults = options.maxResults ?? 5000
      const signal = options.signal ?? null

      const body: Record<string, unknown> = {
        query,
        useLegacySql: false,
        useQueryCache: true,
        maxResults,
        formatOptions: { useInt64Timestamp: false },
      }
      if (options.pageToken) body.pageToken = options.pageToken

      const data = await submitQuery(projectId, body, signal, maxResults)

      const stats = {
        totalBytesProcessed: data.totalBytesProcessed || '0',
        cacheHit: data.cacheHit || false,
      }
      const totalRows = data.totalRows ? parseInt(data.totalRows as unknown as string, 10) : null
      const hasMore = !!data.pageToken
      const jobReference = data.jobReference
        ? { projectId: data.jobReference.projectId, jobId: data.jobReference.jobId }
        : undefined

      if (data.schema && data.rows) {
        const rows = convertBigQueryRows(data.rows, data.schema.fields)
        const columns = extractSimpleSchema(data.schema.fields)
        return { rows, columns, totalRows, hasMore, pageToken: data.pageToken, jobReference, stats }
      }
      return { rows: [], columns: [], totalRows: 0, hasMore: false, jobReference, stats }
    },

    async dryRunQuery(query: string, projectId: string): Promise<DryRunResult> {
      try {
        const data = await submitQuery(projectId, {
          query,
          useLegacySql: false,
          dryRun: true,
        }, null)
        const bytes = parseInt((data.totalBytesProcessed as string | undefined) || '0', 10)
        return formatDryRunResult(bytes)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed'
        return { totalBytesProcessed: '0', estimatedCost: '', error: message }
      }
    },

    async fetchQueryPlan(projectId: string, jobId: string): Promise<unknown> {
      const data = await apiCall<{ statistics?: { query?: { queryPlan?: unknown } } }>(token =>
        fetch(
          `${BQ_BASE}/projects/${projectId}/jobs/${jobId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      )
      return data.statistics?.query?.queryPlan ?? null
    },
  }
}

/** BigQuery charges $6.25 per TiB scanned; convert bytes to pricing display strings. */
export function formatDryRunResult(bytes: number): DryRunResult {
  const costPerTiB = 6.25
  const tib = bytes / 1099511627776
  const cost = tib * costPerTiB

  let estimatedCost: string
  if (bytes === 0) estimatedCost = 'Free'
  else if (cost < 0.01) estimatedCost = '<$0.01'
  else estimatedCost = `$${cost.toFixed(2)}`

  return { totalBytesProcessed: formatBytes(bytes), estimatedCost }
}
