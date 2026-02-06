/**
 * Snowflake store for connection management, query execution, and schema operations.
 * Credentials are kept in memory only and fetched on-demand from the backend.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import { useUserStore } from './user'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface SnowflakeCredentials {
  account: string
  username: string
  password: string
  warehouse: string | null
  database: string | null
  schemaName: string | null
  role: string | null
}

export interface SnowflakeQueryResult {
  rows: Record<string, unknown>[]
  schema?: { name: string; type: string }[]
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface SnowflakePaginatedQueryResult {
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

export interface SnowflakeDatabaseInfo {
  name: string
}

export interface SnowflakeSchemaInfo {
  name: string
}

export interface SnowflakeTableInfo {
  databaseName: string
  schemaName: string
  name: string
  type: 'table' | 'view'
}

export interface SnowflakeColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

export const useSnowflakeStore = defineStore('snowflake', () => {
  const connectionsStore = useConnectionsStore()
  const userStore = useUserStore()

  // In-memory credentials cache (NOT persisted)
  const credentialsCache = ref<Map<string, SnowflakeCredentials>>(new Map())

  // Schema caches
  const databasesCache = ref<Map<string, SnowflakeDatabaseInfo[]>>(new Map())
  const schemasCache = ref<Map<string, SnowflakeSchemaInfo[]>>(new Map())
  const tablesCache = ref<Map<string, SnowflakeTableInfo[]>>(new Map())
  const columnsCache = ref<Map<string, SnowflakeColumnInfo[]>>(new Map())

  // Loading states
  const isConnecting = ref(false)
  const isExecutingQuery = ref(false)
  const isTesting = ref(false)

  // Schema version for reactivity (incremented when schema changes)
  const schemaVersion = ref(0)

  // Track in-flight fetchAllColumns requests to prevent duplicates
  const allColumnsLoading = new Map<string, Promise<void>>()

  /**
   * Test a Snowflake connection without saving it.
   */
  const testConnection = async (
    account: string,
    username: string,
    password: string,
    warehouse: string | null,
    database: string | null,
    schemaName: string | null,
    role: string | null
  ): Promise<TestConnectionResult> => {
    isTesting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/snowflake/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
        body: JSON.stringify({
          account,
          username,
          password,
          warehouse: warehouse || undefined,
          database: database || undefined,
          schema_name: schemaName || undefined,
          role: role || undefined
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
   * Create a new Snowflake connection.
   * Tests the connection, encrypts credentials, and stores in backend.
   */
  const createConnection = async (
    name: string,
    account: string,
    username: string,
    password: string,
    warehouse: string | null,
    database: string | null,
    schemaName: string | null,
    role: string | null
  ): Promise<string> => {
    isConnecting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/snowflake/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
        body: JSON.stringify({
          name,
          account,
          username,
          password,
          warehouse: warehouse || undefined,
          database: database || undefined,
          schema_name: schemaName || undefined,
          role: role || undefined
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to create connection')
      }

      const data = await response.json()

      // Cache credentials in memory
      credentialsCache.value.set(data.id, {
        account,
        username,
        password,
        warehouse,
        database,
        schemaName,
        role
      })

      // Add to connections store
      connectionsStore.upsertConnection({
        id: data.id,
        type: 'snowflake',
        name,
        database: database || undefined,
        createdAt: Date.now()
      })

      return data.id
    } finally {
      isConnecting.value = false
    }
  }

  /**
   * Get credentials for a connection.
   * Returns from cache if available, otherwise fetches from backend.
   */
  const getCredentials = async (connectionId: string): Promise<SnowflakeCredentials> => {
    // Check cache first
    const cached = credentialsCache.value.get(connectionId)
    if (cached) {
      return cached
    }

    // Fetch from backend
    const response = await fetch(
      `${BACKEND_URL}/snowflake/connections/${connectionId}/credentials`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch credentials')
    }

    const data = await response.json()
    const credentials: SnowflakeCredentials = {
      account: data.account,
      username: data.username,
      password: data.password,
      warehouse: data.warehouse,
      database: data.database,
      schemaName: data.schema_name,
      role: data.role
    }

    // Cache in memory
    credentialsCache.value.set(connectionId, credentials)
    return credentials
  }

  /**
   * Execute a SQL query on a Snowflake connection.
   */
  const runQuery = async (
    connectionId: string,
    query: string,
    signal?: AbortSignal | null
  ): Promise<SnowflakeQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/snowflake/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
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
   */
  const runQueryPaginated = async (
    connectionId: string,
    query: string,
    batchSize: number = 5000,
    offset: number = 0,
    includeCount: boolean = true,
    signal?: AbortSignal | null
  ): Promise<SnowflakePaginatedQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/snowflake/query/paginated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
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
   * Fetch all databases for a connection.
   * Returns from cache if available, unless force is true.
   */
  const fetchDatabases = async (connectionId: string, force = false): Promise<SnowflakeDatabaseInfo[]> => {
    // Check cache first (unless force refresh)
    if (!force) {
      const cached = databasesCache.value.get(connectionId)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/snowflake/schema/${connectionId}/databases`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch databases')
    }

    const data = await response.json()
    const databases: SnowflakeDatabaseInfo[] = data.databases.map((d: { name: string }) => ({
      name: d.name
    }))

    databasesCache.value.set(connectionId, databases)
    return databases
  }

  /**
   * Fetch all schemas for a database.
   * Returns from cache if available, unless force is true.
   */
  const fetchSchemas = async (connectionId: string, databaseName: string, force = false): Promise<SnowflakeSchemaInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}`

    // Check cache first (unless force refresh)
    if (!force) {
      const cached = schemasCache.value.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/snowflake/schema/${connectionId}/schemas/${encodeURIComponent(databaseName)}`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch schemas')
    }

    const data = await response.json()
    const schemas: SnowflakeSchemaInfo[] = data.schemas.map((s: { name: string }) => ({
      name: s.name
    }))

    schemasCache.value.set(cacheKey, schemas)
    return schemas
  }

  /**
   * Fetch tables for a specific database and schema.
   * Returns from cache if available, unless force is true.
   */
  const fetchTablesForSchema = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    force = false
  ): Promise<SnowflakeTableInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${schemaName}`

    // Check cache first (unless force refresh)
    if (!force) {
      const cached = tablesCache.value.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Get all tables and filter by database and schema
    const allTables = await fetchTables(connectionId, force)
    const filteredTables = allTables.filter(
      t => t.databaseName === databaseName && t.schemaName === schemaName
    )

    tablesCache.value.set(cacheKey, filteredTables)
    return filteredTables
  }

  /**
   * Fetch all tables for a connection.
   * Returns from cache if available, unless force is true.
   */
  const fetchTables = async (connectionId: string, force = false): Promise<SnowflakeTableInfo[]> => {
    // Check cache first (unless force refresh)
    if (!force) {
      const cached = tablesCache.value.get(connectionId)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/snowflake/schema/${connectionId}/tables`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch tables')
    }

    const data = await response.json()
    const tables: SnowflakeTableInfo[] = data.tables.map((t: {
      database_name: string
      schema_name: string
      name: string
      type: string
    }) => ({
      databaseName: t.database_name,
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
    databaseName: string,
    schemaName: string,
    tableName: string
  ): Promise<SnowflakeColumnInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${schemaName}.${tableName}`

    // Check cache first
    const cached = columnsCache.value.get(cacheKey)
    if (cached) {
      return cached
    }

    const response = await fetch(
      `${BACKEND_URL}/snowflake/schema/${connectionId}/columns/${databaseName}/${schemaName}/${tableName}`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch columns')
    }

    const data = await response.json()
    const columns: SnowflakeColumnInfo[] = data.columns

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
      // Ensure tables are fetched first (needed for buildSnowflakeSchema)
      if (!tablesCache.value.has(connectionId)) {
        await fetchTables(connectionId)
      }

      const response = await fetch(
        `${BACKEND_URL}/snowflake/schema/${connectionId}/all-columns`,
        { headers: userStore.getAuthHeaders() }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch all columns')
      }

      const data = await response.json()
      const columnsByTable: Record<string, SnowflakeColumnInfo[]> = data.columns

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
   * Delete a Snowflake connection.
   */
  const deleteConnection = async (connectionId: string): Promise<void> => {
    const response = await fetch(
      `${BACKEND_URL}/snowflake/connections/${connectionId}`,
      { method: 'DELETE', headers: userStore.getAuthHeaders() }
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
    databasesCache,
    schemasCache,
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
    fetchDatabases,
    fetchSchemas,
    fetchTablesForSchema,
    fetchTables,
    fetchColumns,
    fetchAllColumns,
    deleteConnection,
    clearConnectionCache,
    hasCredentials,
    refreshSchemas
  }
})
