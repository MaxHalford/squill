/**
 * PostgreSQL store for connection management, query execution, and schema operations.
 * Credentials are kept in memory only and fetched on-demand from the backend.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface PostgresCredentials {
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: string
}

export interface PostgresQueryResult {
  rows: Record<string, unknown>[]
  schema?: { name: string; type: string }[]
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface PostgresPaginatedQueryResult {
  rows: Record<string, unknown>[]
  columns: { name: string; type: string }[]
  totalRows: number | null
  hasMore: boolean
  nextOffset: number
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface PostgresTableInfo {
  schemaName: string
  name: string
  type: 'table' | 'view'
}

export interface PostgresColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

export const usePostgresStore = defineStore('postgres', () => {
  const connectionsStore = useConnectionsStore()

  // In-memory credentials cache (NOT persisted)
  const credentialsCache = ref<Map<string, PostgresCredentials>>(new Map())

  // Schema caches
  const tablesCache = ref<Map<string, PostgresTableInfo[]>>(new Map())
  const columnsCache = ref<Map<string, PostgresColumnInfo[]>>(new Map())

  // Loading states
  const isConnecting = ref(false)
  const isExecutingQuery = ref(false)
  const isTesting = ref(false)

  // Schema version for reactivity (incremented when schema changes)
  const schemaVersion = ref(0)

  // Track in-flight fetchAllColumns requests to prevent duplicates
  const allColumnsLoading = new Map<string, Promise<void>>()

  /**
   * Test a PostgreSQL connection without saving it.
   */
  const testConnection = async (
    host: string,
    port: number,
    database: string,
    username: string,
    password: string,
    sslMode: string
  ): Promise<TestConnectionResult> => {
    isTesting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/postgres/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          database,
          username,
          password,
          ssl_mode: sslMode
        })
      })

      if (!response.ok) {
        const error = await response.json()
        return {
          success: false,
          message: error.detail || 'Failed to test connection'
        }
      }

      const data = await response.json()
      return {
        success: data.success,
        message: data.message
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed'
      }
    } finally {
      isTesting.value = false
    }
  }

  /**
   * Create a new PostgreSQL connection.
   * Tests the connection, encrypts credentials, and stores in backend.
   */
  const createConnection = async (
    name: string,
    host: string,
    port: number,
    database: string,
    username: string,
    password: string,
    sslMode: string,
    userEmail: string
  ): Promise<string> => {
    isConnecting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/postgres/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          host,
          port,
          database,
          username,
          password,
          ssl_mode: sslMode,
          user_email: userEmail
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to create connection')
      }

      const data = await response.json()

      // Cache credentials in memory
      credentialsCache.value.set(data.id, {
        host,
        port,
        database,
        username,
        password,
        sslMode
      })

      // Add to connections store
      connectionsStore.addPostgresConnection(data.id, name, database)

      return data.id
    } finally {
      isConnecting.value = false
    }
  }

  /**
   * Get credentials for a connection.
   * Returns from cache if available, otherwise fetches from backend.
   */
  const getCredentials = async (connectionId: string): Promise<PostgresCredentials> => {
    // Check cache first
    const cached = credentialsCache.value.get(connectionId)
    if (cached) {
      return cached
    }

    // Fetch from backend
    const response = await fetch(
      `${BACKEND_URL}/postgres/connections/${connectionId}/credentials`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch credentials')
    }

    const data = await response.json()
    const credentials: PostgresCredentials = {
      host: data.host,
      port: data.port,
      database: data.database,
      username: data.username,
      password: data.password,
      sslMode: data.ssl_mode
    }

    // Cache in memory
    credentialsCache.value.set(connectionId, credentials)
    return credentials
  }

  /**
   * Execute a SQL query on a PostgreSQL connection.
   */
  const runQuery = async (
    connectionId: string,
    query: string,
    signal?: AbortSignal | null
  ): Promise<PostgresQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/postgres/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: connectionId,
          query
        }),
        signal: signal || undefined
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Query execution failed')
      }

      const data = await response.json()
      return {
        rows: data.rows,
        stats: {
          executionTimeMs: data.stats.executionTimeMs,
          rowCount: data.stats.rowCount
        }
      }
    } finally {
      isExecutingQuery.value = false
    }
  }

  /**
   * Execute a SQL query with pagination support.
   * @param connectionId - The connection ID
   * @param query - The SQL query to execute
   * @param batchSize - Number of rows per batch (default: 5000)
   * @param offset - Row offset for pagination (default: 0)
   * @param includeCount - Whether to include total row count (default: true on first request)
   * @param signal - Optional AbortSignal for cancellation
   */
  const runQueryPaginated = async (
    connectionId: string,
    query: string,
    batchSize: number = 5000,
    offset: number = 0,
    includeCount: boolean = true,
    signal?: AbortSignal | null
  ): Promise<PostgresPaginatedQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/postgres/query/paginated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: connectionId,
          query,
          batch_size: batchSize,
          offset,
          include_count: includeCount
        }),
        signal: signal || undefined
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Query execution failed')
      }

      const data = await response.json()
      return {
        rows: data.rows,
        columns: data.columns.map((col: { name: string; type: string }) => ({
          name: col.name,
          type: col.type
        })),
        totalRows: data.total_rows,
        hasMore: data.has_more,
        nextOffset: data.next_offset,
        stats: {
          executionTimeMs: data.stats.executionTimeMs,
          rowCount: data.stats.rowCount
        }
      }
    } finally {
      isExecutingQuery.value = false
    }
  }

  /**
   * Fetch all tables for a connection.
   * Returns from cache if available, unless force is true.
   */
  const fetchTables = async (connectionId: string, force = false): Promise<PostgresTableInfo[]> => {
    // Check cache first (unless force refresh)
    if (!force) {
      const cached = tablesCache.value.get(connectionId)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/postgres/schema/${connectionId}/tables`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch tables')
    }

    const data = await response.json()
    const tables: PostgresTableInfo[] = data.tables.map((t: { schema_name: string; name: string; type: string }) => ({
      schemaName: t.schema_name,
      name: t.name,
      type: t.type as 'table' | 'view'
    }))

    tablesCache.value.set(connectionId, tables)
    return tables
  }

  /**
   * Fetch columns for a specific table.
   */
  const fetchColumns = async (
    connectionId: string,
    schemaName: string,
    tableName: string
  ): Promise<PostgresColumnInfo[]> => {
    const cacheKey = `${connectionId}:${schemaName}.${tableName}`

    // Check cache first
    const cached = columnsCache.value.get(cacheKey)
    if (cached) {
      return cached
    }

    const response = await fetch(
      `${BACKEND_URL}/postgres/schema/${connectionId}/columns/${schemaName}/${tableName}`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch columns')
    }

    const data = await response.json()
    const columns: PostgresColumnInfo[] = data.columns

    columnsCache.value.set(cacheKey, columns)
    return columns
  }

  /**
   * Fetch columns for all tables in a connection.
   * Used to populate autocompletion data.
   */
  const fetchAllColumns = async (connectionId: string): Promise<void> => {
    // Return existing promise if already loading
    const existing = allColumnsLoading.get(connectionId)
    if (existing) {
      return existing
    }

    const promise = (async () => {
      // Ensure tables are fetched first (needed for buildPostgresSchema)
      if (!tablesCache.value.has(connectionId)) {
        await fetchTables(connectionId)
      }

      const response = await fetch(
        `${BACKEND_URL}/postgres/schema/${connectionId}/all-columns`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch all columns')
      }

      const data = await response.json()
      const columnsByTable: Record<string, PostgresColumnInfo[]> = data.columns

      // Populate cache with all columns
      for (const [tableKey, columns] of Object.entries(columnsByTable)) {
        const cacheKey = `${connectionId}:${tableKey}`
        columnsCache.value.set(cacheKey, columns)
      }

      // Increment schema version to trigger reactive updates
      schemaVersion.value++
    })()

    allColumnsLoading.set(connectionId, promise)

    try {
      await promise
    } finally {
      allColumnsLoading.delete(connectionId)
    }
  }

  /**
   * Delete a PostgreSQL connection.
   */
  const deleteConnection = async (connectionId: string): Promise<void> => {
    const response = await fetch(
      `${BACKEND_URL}/postgres/connections/${connectionId}`,
      { method: 'DELETE' }
    )

    if (!response.ok) {
      throw new Error('Failed to delete connection')
    }

    // Clear from caches
    clearConnectionCache(connectionId)

    // Remove from connections store
    connectionsStore.removeConnection(connectionId)
  }

  /**
   * Clear cached data for a connection.
   */
  const clearConnectionCache = (connectionId: string): void => {
    credentialsCache.value.delete(connectionId)
    tablesCache.value.delete(connectionId)

    // Clear all column caches for this connection
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        columnsCache.value.delete(key)
      }
    }
  }

  /**
   * Check if credentials are cached for a connection.
   */
  const hasCredentials = (connectionId: string): boolean => {
    return credentialsCache.value.has(connectionId)
  }

  /**
   * Refresh schemas for a connection by clearing cache and re-fetching tables.
   */
  const refreshSchemas = async (connectionId: string): Promise<void> => {
    // Clear column caches for this connection (but keep credentials)
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        columnsCache.value.delete(key)
      }
    }

    // Re-fetch tables (force bypasses cache)
    await fetchTables(connectionId, true)
  }

  return {
    // State
    credentialsCache,
    tablesCache,
    columnsCache,
    isConnecting,
    isExecutingQuery,
    isTesting,
    schemaVersion,

    // Methods
    testConnection,
    createConnection,
    getCredentials,
    runQuery,
    runQueryPaginated,
    fetchTables,
    fetchColumns,
    fetchAllColumns,
    deleteConnection,
    clearConnectionCache,
    hasCredentials,
    refreshSchemas
  }
})
