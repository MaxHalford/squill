import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConnectionsStore } from './connections'
import { loadItem, saveItem, deleteItem } from '../utils/storage'
import type { BigQueryProject, BigQueryDataset, BigQueryTable, BigQueryField, BigQueryQueryResponse } from '../types/bigquery'
import { convertBigQueryRows, extractSimpleSchema } from '../utils/bigqueryConversion'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const OAUTH_STATE_KEY = 'squill-oauth-state'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Generate cryptographically secure random state for CSRF protection
const generateOAuthState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// BigQuery OAuth scopes - read-only BigQuery access + email (needed by backend to identify user)
const BIGQUERY_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform.read-only'
]

interface QueryResult {
  rows: Record<string, unknown>[]
  schema?: { name: string; type: string }[]
  stats: {
    totalBytesProcessed?: string
    cacheHit?: boolean
  }
}

// Dry run result for cost estimation
export interface DryRunResult {
  totalBytesProcessed: string
  estimatedCost: string  // e.g., "$0.03" or "<$0.01"
  error?: string
}

// Simple cache for dry run results (query+connectionId → result)
interface DryRunCacheEntry {
  result: DryRunResult
  timestamp: number
}
const dryRunCache = new Map<string, DryRunCacheEntry>()
const DRY_RUN_CACHE_TTL = 60000 // 60 seconds

// Paginated query result for BigQuery
export interface BigQueryPaginatedQueryResult {
  rows: Record<string, unknown>[]
  columns: { name: string; type: string }[]
  totalRows: number | null
  hasMore: boolean
  pageToken?: string
  stats: {
    totalBytesProcessed?: string
    cacheHit?: boolean
  }
}

// Poll BigQuery for query results when jobComplete is false
// Uses getQueryResults endpoint with exponential backoff
const pollQueryResults = async (
  projectId: string,
  jobId: string,
  token: string,
  signal: AbortSignal | null,
  maxResults?: number
): Promise<BigQueryQueryResponse> => {
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
    if (maxResults !== undefined) {
      params.set('maxResults', String(maxResults))
    }

    const fetchOptions: RequestInit = {
      headers: { 'Authorization': `Bearer ${token}` },
    }
    if (signal) {
      fetchOptions.signal = signal
    }

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?${params}`,
      fetchOptions
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || 'Failed to poll query results')
    }

    const data: BigQueryQueryResponse = await response.json()

    if (data.jobComplete !== false) {
      return data
    }
  }
}

export const useBigQueryStore = defineStore('bigquery', () => {
  // Delegate to connections store
  const connectionsStore = useConnectionsStore()

  // Project ID
  const projectId = ref<string | null>(null)

  const loadState = async () => {
    await connectionsStore.ready
    const saved = await loadItem<string>('bigquery-project')
    if (saved) {
      projectId.value = saved
    }
  }

  const ready = loadState()

  // Computed: get current access token (from in-memory storage)
  const accessToken = computed(() => {
    if (!connectionsStore.activeConnectionId) return null
    return connectionsStore.getAccessToken(connectionsStore.activeConnectionId)
  })

  // Computed properties for user info
  const userEmail = computed(() => connectionsStore.activeConnection?.email || null)
  const userName = computed(() => connectionsStore.activeConnection?.name || null)

  const isAuthenticated = computed(() => {
    return connectionsStore.activeConnection !== null &&
           connectionsStore.activeConnection.type === 'bigquery' &&
           !connectionsStore.isActiveTokenExpired
  })

  // For backward compatibility - projects list
  const projects = ref<BigQueryProject[]>([])

  // Core helper: Execute API call with token, handle 401 retry
  const executeWithTokenRefresh = async <T>(
    connectionId: string,
    initialToken: string,
    apiCall: (token: string) => Promise<Response>
  ): Promise<T> => {
    let token = initialToken
    let response = await apiCall(token)

    // If 401, refresh token and retry once
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await apiCall(token)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || 'API call failed')
    }

    return response.json()
  }

  // Helper: Make API call with automatic token refresh using active connection
  const apiCallWithRefresh = async <T>(
    apiCall: (token: string) => Promise<Response>
  ): Promise<T> => {
    const connectionId = connectionsStore.activeConnectionId
    if (!connectionId) {
      throw new Error('No active connection')
    }

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      token = await connectionsStore.refreshAccessToken(connectionId)
    }

    return executeWithTokenRefresh<T>(connectionId, token, apiCall)
  }

  // Helper: Make API call using any BigQuery connection (not just the active one)
  // This is used by SchemaBox to fetch data when BigQuery is not the active connection
  const apiCallWithAnyBigQueryConnection = async <T>(
    apiCall: (token: string) => Promise<Response>
  ): Promise<T> => {
    // Get all BigQuery connections
    const bigqueryConnections = connectionsStore.getConnectionsByType('bigquery')
    if (bigqueryConnections.length === 0) {
      throw new Error('No BigQuery connections available')
    }

    // Find a connection with a valid token, or try to refresh one
    let connectionId: string | null = null
    let token: string | null = null

    for (const conn of bigqueryConnections) {
      token = connectionsStore.getAccessToken(conn.id)
      if (token) {
        connectionId = conn.id
        break
      }
    }

    // If no valid token, try to refresh the first connection
    if (!token || !connectionId) {
      connectionId = bigqueryConnections[0].id
      try {
        token = await connectionsStore.refreshAccessToken(connectionId)
      } catch {
        throw new Error('Failed to refresh BigQuery token. Please reconnect.')
      }
    }

    return executeWithTokenRefresh<T>(connectionId, token, apiCall)
  }

  // Sign in with Google to add BigQuery connection
  // This implements incremental authorization:
  // - If user is not logged in, first complete login flow, then chain BigQuery auth
  // - If user is logged in, only request BigQuery scopes (incremental)
  const signInWithGoogle = async (): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    // Import user store to check login status
    const { useUserStore } = await import('./user')
    const userStore = useUserStore()

    // If user is not logged in, start login flow with BigQuery chain
    if (!userStore.isLoggedIn) {
      await userStore.loginWithGoogle(true) // chainBigQuery = true
      return // loginWithGoogle redirects, so we won't reach here
    }

    // User is logged in - request only BigQuery scopes (incremental auth)
    // Generate and store state for CSRF protection
    const csrfToken = generateOAuthState()
    const state = `${csrfToken}:bigquery`
    sessionStorage.setItem(OAUTH_STATE_KEY, state)

    // Build OAuth URL for BigQuery scopes only
    // 'consent' is required to get a refresh token from Google
    // 'include_granted_scopes' preserves previously granted scopes (email)
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: BIGQUERY_SCOPES.join(' '),
      access_type: 'offline',  // Request refresh token
      prompt: 'consent',       // Required to get refresh token
      include_granted_scopes: 'true', // Incremental auth - preserve email scope
      state
    })

    // Redirect to Google OAuth
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  // Fetch default project (first accessible project with BigQuery enabled)
  const fetchDefaultProject = async () => {
    if (!accessToken.value) return

    try {
      // Fetch projects and pick the first one
      const result = await fetchProjects()
      if (result.length > 0) {
        projectId.value = result[0].projectId
      }
    } catch (err) {
      console.warn('Could not fetch default project:', err)
    }
  }

  // Fetch projects from Resource Manager v3 search API
  // Uses projects:search (not projects.list) — matches what Cloud Console uses
  // and only requires per-project resourcemanager.projects.get permission
  const fetchProjects = async (): Promise<BigQueryProject[]> => {
    try {
      const data = await apiCallWithRefresh<{
        projects?: Array<{ projectId: string; displayName?: string; state: string }>
      }>(
        (token) => fetch(
          'https://cloudresourcemanager.googleapis.com/v3/projects:search?query=state:ACTIVE',
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
      )
      projects.value = (data.projects || []).map(p => ({
        projectId: p.projectId,
        name: p.displayName || p.projectId
      }))
      return projects.value
    } catch (err) {
      console.warn('Could not fetch projects:', err)
      projects.value = []
      return []
    }
  }

  // Fetch projects using any BigQuery connection (for SchemaBox when BigQuery is not active)
  const fetchProjectsWithAnyConnection = async (): Promise<BigQueryProject[]> => {
    try {
      const data = await apiCallWithAnyBigQueryConnection<{
        projects?: Array<{ projectId: string; displayName?: string; state: string }>
      }>(
        (token) => fetch(
          'https://cloudresourcemanager.googleapis.com/v3/projects:search?query=state:ACTIVE',
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
      )
      projects.value = (data.projects || []).map(p => ({
        projectId: p.projectId,
        name: p.displayName || p.projectId
      }))
      return projects.value
    } catch (err) {
      console.warn('Could not fetch projects:', err)
      projects.value = []
      return []
    }
  }

  // Set active project
  const setProjectId = (newProjectId: string | null) => {
    projectId.value = newProjectId
    if (newProjectId) {
      saveItem('bigquery-project', newProjectId).catch(err => {
        console.error('Failed to save project:', err)
      })
    } else {
      deleteItem('bigquery-project').catch(err => {
        console.error('Failed to delete project:', err)
      })
    }
  }

  // Reconnect an existing connection (re-authenticate)
  const reconnectConnection = async (_connectionId: string): Promise<void> => {
    // For the new flow, reconnecting means going through OAuth again
    await signInWithGoogle()
  }

  // Sign out
  const signOut = async () => {
    const email = connectionsStore.activeConnection?.email

    // Remove connection via connections store
    if (connectionsStore.activeConnectionId) {
      connectionsStore.removeConnection(connectionsStore.activeConnectionId)
    }

    projectId.value = null
    deleteItem('bigquery-project').catch(console.error)

    // Tell backend to revoke refresh token
    if (email) {
      try {
        await fetch(`${BACKEND_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })
      } catch (err) {
        console.warn('Failed to revoke refresh token:', err)
      }
    }
  }

  // Paginated fetch helper for BigQuery list APIs (datasets.list, tables.list).
  // Follows nextPageToken until all results are collected.
  const paginatedFetch = async <T>(
    caller: <R>(apiCall: (token: string) => Promise<Response>) => Promise<R>,
    baseUrl: string,
    itemsKey: string,
  ): Promise<T[]> => {
    const allItems: T[] = []
    let pageToken: string | undefined

    do {
      const url = pageToken ? `${baseUrl}?pageToken=${pageToken}` : baseUrl
      const data = await caller<Record<string, unknown>>(
        (token) => fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      )
      const items = (data[itemsKey] as T[] | undefined) || []
      allItems.push(...items)
      pageToken = data.nextPageToken as string | undefined
    } while (pageToken)

    return allItems
  }

  // Fetch datasets for a project
  const fetchDatasets = async (targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    return paginatedFetch<BigQueryDataset>(
      apiCallWithRefresh,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`,
      'datasets',
    )
  }

  // Fetch datasets using any BigQuery connection (for SchemaBox when BigQuery is not active)
  const fetchDatasetsWithAnyConnection = async (targetProjectId: string) => {
    return paginatedFetch<BigQueryDataset>(
      apiCallWithAnyBigQueryConnection,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/datasets`,
      'datasets',
    )
  }

  // Fetch tables for a dataset
  const fetchTables = async (datasetId: string, targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    return paginatedFetch<BigQueryTable>(
      apiCallWithRefresh,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables`,
      'tables',
    )
  }

  // Fetch tables using any BigQuery connection (for SchemaBox when BigQuery is not active)
  const fetchTablesWithAnyConnection = async (datasetId: string, targetProjectId: string) => {
    return paginatedFetch<BigQueryTable>(
      apiCallWithAnyBigQueryConnection,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/datasets/${datasetId}/tables`,
      'tables',
    )
  }

  // Fetch table schema
  const fetchTableSchema = async (datasetId: string, tableId: string, targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const data = await apiCallWithRefresh<{ schema?: { fields?: BigQueryField[] } }>(
      (token) => fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables/${tableId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
    )

    return data.schema?.fields || []
  }

  // Fetch table schema using any BigQuery connection (for SchemaBox when BigQuery is not active)
  const fetchTableSchemaWithAnyConnection = async (datasetId: string, tableId: string, targetProjectId: string) => {
    const data = await apiCallWithAnyBigQueryConnection<{ schema?: { fields?: BigQueryField[] } }>(
      (token) => fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/datasets/${datasetId}/tables/${tableId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
    )

    return data.schema?.fields || []
  }

  // Run BigQuery query
  // Accepts optional connectionId to support running queries for non-active connections
  const runQuery = async (
    query: string,
    signal: AbortSignal | null = null,
    targetConnectionId?: string
  ): Promise<QueryResult> => {
    // Use provided connectionId, or fall back to active connection
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId

    if (!connectionId) {
      throw new Error('Please sign in with Google first')
    }

    // Get project ID from the connection, fall back to global projectId
    const connection = connectionsStore.connections.find(c => c.id === connectionId)
    const targetProjectId = connection?.projectId || projectId.value

    if (!targetProjectId) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      token = await connectionsStore.refreshAccessToken(connectionId)
    }

    const makeRequest = async (accessToken: string): Promise<Response> => {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          useQueryCache: true,
          // Request timestamps as float seconds (not int64 microseconds)
          // We still convert to ISO strings in bigqueryConversion.ts
          formatOptions: {
            useInt64Timestamp: false,
          },
        }),
      }

      if (signal) {
        fetchOptions.signal = signal
      }

      return fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/queries`,
        fetchOptions
      )
    }

    let response = await makeRequest(token)

    // If 401, refresh and retry
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await makeRequest(token)
    }

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Query execution failed')
    }

    let data: BigQueryQueryResponse = await response.json()

    // Poll if query is still running (long-running queries return jobComplete: false)
    if (data.jobComplete === false && data.jobReference) {
      data = await pollQueryResults(
        targetProjectId,
        data.jobReference.jobId,
        token,
        signal
      )
    }

    // Extract statistics from BigQuery response
    const stats = {
      totalBytesProcessed: data.totalBytesProcessed || '0',
      cacheHit: data.cacheHit || false
    }

    // Transform BigQuery response with proper types
    if (data.schema && data.rows) {
      const rows = convertBigQueryRows(data.rows, data.schema.fields)
      return { rows, schema: data.schema.fields, stats }
    }

    return { rows: [], schema: [], stats }
  }

  /**
   * Run a BigQuery query with pagination support.
   * Uses maxResults and pageToken for efficient batch loading.
   * @param query - The SQL query to execute
   * @param maxResults - Maximum rows per request (default: 5000)
   * @param pageToken - Token for fetching next page (from previous response)
   * @param signal - Optional AbortSignal for cancellation
   * @param targetConnectionId - Optional connection ID
   */
  const runQueryPaginated = async (
    query: string,
    maxResults: number = 5000,
    pageToken?: string,
    signal: AbortSignal | null = null,
    targetConnectionId?: string
  ): Promise<BigQueryPaginatedQueryResult> => {
    // Use provided connectionId, or fall back to active connection
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId

    if (!connectionId) {
      throw new Error('Please sign in with Google first')
    }

    // Get project ID from the connection, fall back to global projectId
    const connection = connectionsStore.connections.find(c => c.id === connectionId)
    const targetProjectId = connection?.projectId || projectId.value

    if (!targetProjectId) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      token = await connectionsStore.refreshAccessToken(connectionId)
    }

    const makeRequest = async (accessToken: string): Promise<Response> => {
      const requestBody: Record<string, unknown> = {
        query,
        useLegacySql: false,
        useQueryCache: true,
        maxResults,
        // Request timestamps as float seconds (not int64 microseconds)
        // We convert to ISO strings in bigqueryConversion.ts for DuckDB
        formatOptions: {
          useInt64Timestamp: false,
        },
      }

      // Add pageToken for continuation requests
      if (pageToken) {
        requestBody.pageToken = pageToken
      }

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }

      if (signal) {
        fetchOptions.signal = signal
      }

      return fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/queries`,
        fetchOptions
      )
    }

    let response = await makeRequest(token)

    // If 401, refresh and retry
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await makeRequest(token)
    }

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Query execution failed')
    }

    let data: BigQueryQueryResponse = await response.json()

    // Poll if query is still running (long-running queries return jobComplete: false)
    if (data.jobComplete === false && data.jobReference) {
      data = await pollQueryResults(
        targetProjectId,
        data.jobReference.jobId,
        token,
        signal,
        maxResults
      )
    }

    // Extract statistics from BigQuery response
    const stats = {
      totalBytesProcessed: data.totalBytesProcessed || '0',
      cacheHit: data.cacheHit || false
    }

    // Parse total rows from response (available as string in BigQuery API)
    const totalRows = data.totalRows ? parseInt(data.totalRows as unknown as string, 10) : null

    // Check if there are more results
    const hasMore = !!data.pageToken

    // Transform BigQuery response with proper types
    if (data.schema && data.rows) {
      const rows = convertBigQueryRows(data.rows, data.schema.fields)
      const columns = extractSimpleSchema(data.schema.fields)
      return {
        rows,
        columns,
        totalRows,
        hasMore,
        pageToken: data.pageToken,
        stats
      }
    }

    return {
      rows: [],
      columns: [],
      totalRows: 0,
      hasMore: false,
      stats
    }
  }

  // Fetch all schemas via INFORMATION_SCHEMA.COLUMNS queries.
  // Uses datasets.list (region-agnostic) to discover datasets and their locations,
  // then groups datasets by location and runs one UNION ALL query per region.
  // This avoids per-table API calls while handling multi-region projects correctly.
  const fetchAllSchemas = async (targetProjectId: string | null = null, targetConnectionId?: string): Promise<void> => {
    const project = targetProjectId || projectId.value
    if (!project) throw new Error('No project specified')

    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) throw new Error('No connection available')
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) token = await connectionsStore.refreshAccessToken(connectionId)

    // Paginated list helper
    const listAll = async <T>(baseUrl: string, itemsKey: string): Promise<T[]> => {
      const allItems: T[] = []
      let pageToken: string | undefined
      do {
        const url = pageToken ? `${baseUrl}?pageToken=${pageToken}` : baseUrl
        const data = await executeWithTokenRefresh<Record<string, unknown>>(connectionId, token!, (t) =>
          fetch(url, { headers: { 'Authorization': `Bearer ${t}` } })
        )
        const items = (data[itemsKey] as T[] | undefined) || []
        allItems.push(...items)
        pageToken = data.nextPageToken as string | undefined
      } while (pageToken)
      return allItems
    }

    const { useSchemaStore } = await import('./bigquerySchema')
    const schemaStore = useSchemaStore()

    // Clear existing schemas for this project so stale entries don't linger
    schemaStore.clearProjectSchemas(project)

    try {
      // Step 1: List all datasets with their locations (paginated)
      const allDatasets = await listAll<BigQueryDataset>(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`,
        'datasets',
      )

      if (allDatasets.length === 0) {
        console.log('No datasets found in project')
        return
      }

      // Step 2: Group datasets by location so each query stays within one region
      const datasetsByLocation = new Map<string, string[]>()
      for (const ds of allDatasets) {
        const location = ds.location || 'US'
        const group = datasetsByLocation.get(location) || []
        group.push(ds.datasetReference.datasetId)
        datasetsByLocation.set(location, group)
      }

      // Step 3: For each region, run one UNION ALL INFORMATION_SCHEMA.COLUMNS query
      // Collect all results, then bulk-write to schema store once at the end
      const allEntries: Array<{ project: string; dataset: string; table: string; columns: Array<{ name: string; type: string }> }> = []

      await Promise.all(
        Array.from(datasetsByLocation.entries()).map(async ([_location, datasetIds]) => {
          try {
            const unionParts = datasetIds.map(dsId =>
              `SELECT table_schema, table_name, column_name, data_type FROM \`${project}.${dsId}.INFORMATION_SCHEMA.COLUMNS\``
            )
            const query = unionParts.join('\nUNION ALL\n')
            const result = await runQuery(query, null, connectionId)

            // Group columns by table
            const tableColumns = new Map<string, { name: string; type: string }[]>()
            for (const row of result.rows) {
              const dsId = row.table_schema as string
              const tbl = row.table_name as string
              const key = `${dsId}\0${tbl}`
              if (!tableColumns.has(key)) tableColumns.set(key, [])
              tableColumns.get(key)!.push({ name: row.column_name as string, type: row.data_type as string })
            }

            for (const [key, columns] of tableColumns) {
              const [dsId, tbl] = key.split('\0')
              allEntries.push({ project, dataset: dsId, table: tbl, columns })
            }
          } catch (err) {
            console.warn(`Could not fetch schemas for datasets [${datasetIds.join(', ')}]:`, err)
          }
        })
      )

      // Single bulk write: one IDB save + one reactive update
      schemaStore.bulkSetTableSchemas(allEntries)

      // Invalidate the autocompletion cache so it rebuilds from fresh schema data
      const { clearSchemaCache } = await import('../utils/schemaAdapter')
      clearSchemaCache('bigquery')

      console.log(`Loaded ${allEntries.length} table schemas via INFORMATION_SCHEMA (${datasetsByLocation.size} region(s))`)
    } catch (error) {
      console.error('Failed to fetch schemas:', error)
      throw error
    }
  }

  // Restore session on app load (refresh tokens for existing connections)
  const restoreSession = async (): Promise<void> => {
    if (!connectionsStore.activeConnectionId) return
    if (connectionsStore.activeConnection?.type !== 'bigquery') return

    // Check if we already have a valid token
    if (connectionsStore.hasValidToken(connectionsStore.activeConnectionId)) return

    try {
      // Try to refresh the token
      await connectionsStore.refreshAccessToken(connectionsStore.activeConnectionId)
      console.log('Session restored successfully')

      // Try to fetch default project if not set
      if (!projectId.value) {
        await fetchDefaultProject()
      }
    } catch (err) {
      console.warn('Failed to restore session:', err)
      // User will need to re-authenticate
    }
  }

  /**
   * Run a dry run query to estimate cost without executing.
   * Results are cached for 60 seconds.
   */
  const dryRunQuery = async (
    query: string,
    targetConnectionId?: string
  ): Promise<DryRunResult> => {
    // Use provided connectionId, or fall back to active connection
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId

    if (!connectionId) {
      return { totalBytesProcessed: '0', estimatedCost: '', error: 'No connection' }
    }

    // Get project ID from the connection, fall back to global projectId
    const connection = connectionsStore.connections.find(c => c.id === connectionId)
    const targetProjectId = connection?.projectId || projectId.value

    if (!targetProjectId) {
      return { totalBytesProcessed: '0', estimatedCost: '', error: 'No project selected' }
    }

    // Check cache first
    const cacheKey = `${connectionId}:${query}`
    const cached = dryRunCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < DRY_RUN_CACHE_TTL) {
      return cached.result
    }

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      try {
        token = await connectionsStore.refreshAccessToken(connectionId)
      } catch {
        return { totalBytesProcessed: '0', estimatedCost: '', error: 'Auth failed' }
      }
    }

    const makeRequest = async (accessToken: string): Promise<Response> => {
      return fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${targetProjectId}/queries`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            useLegacySql: false,
            dryRun: true,
          }),
        }
      )
    }

    try {
      let response = await makeRequest(token)

      // If 401, refresh and retry
      if (response.status === 401) {
        token = await connectionsStore.refreshAccessToken(connectionId)
        response = await makeRequest(token)
      }

      if (!response.ok) {
        // Query has an error (syntax, permissions, etc.)
        return { totalBytesProcessed: '0', estimatedCost: '', error: 'Query error' }
      }

      const data = await response.json()
      const bytes = parseInt(data.totalBytesProcessed || '0', 10)

      // Calculate cost: BigQuery charges $6.25 per TiB processed
      // 1 TiB = 1024^4 bytes = 1099511627776 bytes
      const costPerTiB = 6.25
      const tib = bytes / 1099511627776
      const cost = tib * costPerTiB

      let estimatedCost: string
      if (bytes === 0) {
        estimatedCost = 'Free'
      } else if (cost < 0.01) {
        estimatedCost = '<$0.01'
      } else {
        estimatedCost = `$${cost.toFixed(2)}`
      }

      // Format bytes for display
      let bytesDisplay: string
      if (bytes >= 1e12) {
        bytesDisplay = `${(bytes / 1e12).toFixed(1)} TB`
      } else if (bytes >= 1e9) {
        bytesDisplay = `${(bytes / 1e9).toFixed(1)} GB`
      } else if (bytes >= 1e6) {
        bytesDisplay = `${(bytes / 1e6).toFixed(1)} MB`
      } else if (bytes >= 1e3) {
        bytesDisplay = `${(bytes / 1e3).toFixed(1)} KB`
      } else {
        bytesDisplay = `${bytes} B`
      }

      const result: DryRunResult = {
        totalBytesProcessed: bytesDisplay,
        estimatedCost,
      }

      // Cache the result
      dryRunCache.set(cacheKey, { result, timestamp: Date.now() })

      return result
    } catch {
      return { totalBytesProcessed: '0', estimatedCost: '', error: 'Request failed' }
    }
  }

  return {
    ready,
    accessToken,
    userEmail,
    userName,
    projectId,
    projects,
    isAuthenticated,
    signInWithGoogle,
    reconnectConnection,
    signOut,
    fetchProjects,
    fetchProjectsWithAnyConnection,
    setProjectId,
    fetchDatasets,
    fetchDatasetsWithAnyConnection,
    fetchTables,
    fetchTablesWithAnyConnection,
    fetchTableSchema,
    fetchTableSchemaWithAnyConnection,
    runQuery,
    runQueryPaginated,
    dryRunQuery,
    fetchAllSchemas,
    restoreSession,
  }
})
