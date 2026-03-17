/**
 * MySQL store for connection management, query execution, and schema operations.
 * Credentials are kept in memory only and fetched on-demand from the backend.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import { useUserStore } from './user'
import type { TableMetadataInfo } from '../types/database'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface MysqlCredentials {
  host: string
  port: number
  username: string
  password: string
  database: string | null
  ssl: boolean
}

export interface MysqlQueryResult {
  rows: Record<string, unknown>[]
  schema?: { name: string; type: string }[]
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface MysqlPaginatedQueryResult {
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

export interface MysqlDatabaseInfo {
  name: string
}

export interface MysqlTableInfo {
  databaseName: string
  name: string
  type: 'table' | 'view'
}

export interface MysqlColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

export const useMysqlStore = defineStore('mysql', () => {
  const connectionsStore = useConnectionsStore()
  const userStore = useUserStore()

  // In-memory credentials cache (NOT persisted)
  const credentialsCache = ref<Map<string, MysqlCredentials>>(new Map())

  // Schema caches
  const databasesCache = ref<Map<string, MysqlDatabaseInfo[]>>(new Map())
  const tablesCache = ref<Map<string, MysqlTableInfo[]>>(new Map())
  const columnsCache = ref<Map<string, MysqlColumnInfo[]>>(new Map())
  const metadataCache = ref<Map<string, TableMetadataInfo>>(new Map())

  // Loading states
  const isConnecting = ref(false)
  const isExecutingQuery = ref(false)
  const isTesting = ref(false)

  // Track in-flight fetchAllColumns requests to prevent duplicates
  const allColumnsLoading = new Map<string, Promise<void>>()

  /**
   * Test a MySQL connection without saving it.
   */
  const testConnection = async (
    host: string,
    port: number,
    username: string,
    password: string,
    database: string | null,
    ssl: boolean
  ): Promise<TestConnectionResult> => {
    isTesting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/mysql/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
        body: JSON.stringify({
          host,
          port,
          username,
          password,
          database: database || undefined,
          ssl
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
   * Create a new MySQL connection.
   * Tests the connection, encrypts credentials, and stores in backend.
   */
  const createConnection = async (
    name: string,
    host: string,
    port: number,
    username: string,
    password: string,
    database: string | null,
    ssl: boolean
  ): Promise<string> => {
    isConnecting.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/mysql/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userStore.getAuthHeaders() },
        body: JSON.stringify({
          name,
          host,
          port,
          username,
          password,
          database: database || undefined,
          ssl
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
        username,
        password,
        database,
        ssl
      })

      // Add to connections store
      connectionsStore.upsertConnection({
        id: data.id,
        type: 'mysql',
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
  const getCredentials = async (connectionId: string): Promise<MysqlCredentials> => {
    const cached = credentialsCache.value.get(connectionId)
    if (cached) {
      return cached
    }

    const response = await fetch(
      `${BACKEND_URL}/mysql/connections/${connectionId}/credentials`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch credentials')
    }

    const data = await response.json()
    const credentials: MysqlCredentials = {
      host: data.host,
      port: data.port,
      username: data.username,
      password: data.password,
      database: data.database,
      ssl: data.ssl
    }

    credentialsCache.value.set(connectionId, credentials)
    return credentials
  }

  /**
   * Execute a SQL query on a MySQL connection.
   */
  const runQuery = async (
    connectionId: string,
    query: string,
    signal?: AbortSignal | null
  ): Promise<MysqlQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/mysql/query`, {
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
  ): Promise<MysqlPaginatedQueryResult> => {
    isExecutingQuery.value = true

    try {
      const response = await fetch(`${BACKEND_URL}/mysql/query/paginated`, {
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
   */
  const fetchDatabases = async (connectionId: string, force = false): Promise<MysqlDatabaseInfo[]> => {
    if (!force) {
      const cached = databasesCache.value.get(connectionId)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/mysql/schema/${connectionId}/databases`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch databases')
    }

    const data = await response.json()
    const databases: MysqlDatabaseInfo[] = data.databases.map((d: { name: string }) => ({
      name: d.name
    }))

    databasesCache.value.set(connectionId, databases)
    return databases
  }

  /**
   * Fetch all tables for a connection.
   */
  const fetchTables = async (connectionId: string, force = false): Promise<MysqlTableInfo[]> => {
    if (!force) {
      const cached = tablesCache.value.get(connectionId)
      if (cached) {
        return cached
      }
    }

    const response = await fetch(
      `${BACKEND_URL}/mysql/schema/${connectionId}/tables`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch tables')
    }

    const data = await response.json()
    const tables: MysqlTableInfo[] = data.tables.map((t: {
      database_name: string
      name: string
      type: string
    }) => ({
      databaseName: t.database_name,
      name: t.name,
      type: t.type as 'table' | 'view'
    }))

    tablesCache.value.set(connectionId, tables)
    return tables
  }

  /**
   * Fetch tables for a specific database.
   */
  const fetchTablesForDatabase = async (
    connectionId: string,
    databaseName: string,
    force = false
  ): Promise<MysqlTableInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}`

    if (!force) {
      const cached = tablesCache.value.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    const allTables = await fetchTables(connectionId, force)
    const filteredTables = allTables.filter(t => t.databaseName === databaseName)

    tablesCache.value.set(cacheKey, filteredTables)
    return filteredTables
  }

  /**
   * Fetch columns for a specific table.
   */
  const fetchColumns = async (
    connectionId: string,
    databaseName: string,
    tableName: string
  ): Promise<MysqlColumnInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${tableName}`

    const cached = columnsCache.value.get(cacheKey)
    if (cached) {
      return cached
    }

    const response = await fetch(
      `${BACKEND_URL}/mysql/schema/${connectionId}/columns/${encodeURIComponent(databaseName)}/${encodeURIComponent(tableName)}`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch columns')
    }

    const data = await response.json()
    const columns: MysqlColumnInfo[] = data.columns

    columnsCache.value.set(cacheKey, columns)
    return columns
  }

  /**
   * Fetch columns for all tables in a connection.
   * Used to populate autocompletion data.
   */
  const fetchAllColumns = async (connectionId: string): Promise<void> => {
    const existing = allColumnsLoading.get(connectionId)
    if (existing) {
      return existing
    }

    const promise = (async () => {
      const response = await fetch(
        `${BACKEND_URL}/mysql/schema/${connectionId}/all-columns`,
        { headers: userStore.getAuthHeaders() }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch all columns')
      }

      const data = await response.json()
      const columnsByTable: Record<string, MysqlColumnInfo[]> = data.columns

      const { useDuckDBStore } = await import('./duckdb')
      const duckdbStore = useDuckDBStore()

      const schemaRows = Object.entries(columnsByTable).flatMap(([tableKey, columns]) => {
        const parts = tableKey.split('.')
        const dbName = parts[0]
        const tableName = parts.slice(1).join('.')
        return columns.map(col => ({
          connection_type: 'mysql',
          connection_id: connectionId,
          catalog: dbName,
          schema_name: '',
          table_name: tableName,
          column_name: col.name,
          column_type: col.type,
          is_nullable: col.nullable,
        }))
      })

      await duckdbStore.replaceConnectionSchemas('mysql', connectionId, schemaRows)
    })()

    allColumnsLoading.set(connectionId, promise)

    try {
      await promise
    } finally {
      allColumnsLoading.delete(connectionId)
    }
  }

  /**
   * Delete a MySQL connection.
   */
  const deleteConnection = async (connectionId: string): Promise<void> => {
    const response = await fetch(
      `${BACKEND_URL}/mysql/connections/${connectionId}`,
      { method: 'DELETE', headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) {
      throw new Error('Failed to delete connection')
    }

    clearConnectionCache(connectionId)
    connectionsStore.removeConnection(connectionId)
  }

  /**
   * Fetch table metadata (row count, size) for a specific table.
   */
  const fetchTableMetadata = async (
    connectionId: string,
    databaseName: string,
    tableName: string
  ): Promise<TableMetadataInfo> => {
    const cacheKey = `${connectionId}:${databaseName}.${tableName}`
    const cached = metadataCache.value.get(cacheKey)
    if (cached) return cached

    const response = await fetch(
      `${BACKEND_URL}/mysql/schema/${connectionId}/table-metadata/${encodeURIComponent(databaseName)}/${encodeURIComponent(tableName)}`,
      { headers: userStore.getAuthHeaders() }
    )

    if (!response.ok) throw new Error('Failed to fetch table metadata')

    const data = await response.json()
    const metadata: TableMetadataInfo = {
      rowCount: data.row_count,
      sizeBytes: data.size_bytes,
      tableType: data.engine || data.table_type,
      engine: 'mysql',
    }

    metadataCache.value.set(cacheKey, metadata)
    return metadata
  }

  /**
   * Clear cached data for a connection.
   */
  const clearConnectionCache = (connectionId: string): void => {
    credentialsCache.value.delete(connectionId)
    databasesCache.value.delete(connectionId)

    tablesCache.value.delete(connectionId)
    for (const key of tablesCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        tablesCache.value.delete(key)
      }
    }
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        columnsCache.value.delete(key)
      }
    }
    for (const key of metadataCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        metadataCache.value.delete(key)
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
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        columnsCache.value.delete(key)
      }
    }
    await fetchTables(connectionId, true)
  }

  return {
    // State
    databasesCache,
    tablesCache,
    columnsCache,
    isConnecting,
    isExecutingQuery,
    isTesting,
    // Methods
    testConnection,
    createConnection,
    getCredentials,
    runQuery,
    runQueryPaginated,
    fetchDatabases,
    fetchTables,
    fetchTablesForDatabase,
    fetchColumns,
    fetchAllColumns,
    fetchTableMetadata,
    deleteConnection,
    clearConnectionCache,
    hasCredentials,
    refreshSchemas
  }
})
