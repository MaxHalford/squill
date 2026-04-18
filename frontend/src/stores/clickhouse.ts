/**
 * ClickHouse store — manages connections, queries, and schema browsing.
 *
 * Queries run client-side via ClickHouse HTTP API.
 * Passwords are NEVER stored in IndexedDB:
 *   - Web: stored encrypted on Squill backend, fetched on-demand
 *   - Desktop: stored in OS keychain (macOS Keychain / Windows Credential Manager)
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import {
  createClickHouseHttpClient,
  type ClickHouseCredentials,
  type ClickHouseQueryResult,
  type ClickHousePaginatedQueryResult,
  type ClickHouseDatabaseInfo,
  type ClickHouseTableInfo,
  type ClickHouseColumnInfo,
} from '../services/clickhouse/httpClient'
import type { TableMetadataInfo } from '../types/database'
import { isTauri } from '../utils/tauri'

export type {
  ClickHouseCredentials,
  ClickHouseQueryResult,
  ClickHousePaginatedQueryResult,
  ClickHouseDatabaseInfo,
  ClickHouseTableInfo,
  ClickHouseColumnInfo,
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export const useClickHouseStore = defineStore('clickhouse', () => {
  const connectionsStore = useConnectionsStore()

  // In-memory credentials cache (passwords live here only, never in IndexedDB)
  const credentialsCache = ref<Map<string, ClickHouseCredentials>>(new Map())

  // Schema caches
  const databasesCache = ref<Map<string, ClickHouseDatabaseInfo[]>>(new Map())
  const tablesCache = ref<Map<string, ClickHouseTableInfo[]>>(new Map())
  const columnsCache = ref<Map<string, ClickHouseColumnInfo[]>>(new Map())
  const metadataCache = ref<Map<string, TableMetadataInfo>>(new Map())

  // Loading states
  const isConnecting = ref(false)
  const isExecutingQuery = ref(false)
  const isTesting = ref(false)

  // Track in-flight fetchAllColumns
  const allColumnsLoading = new Map<string, Promise<void>>()

  /**
   * Get auth headers for backend API calls (web only).
   */
  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { useUserStore } = await import('./user')
    return useUserStore().getAuthHeaders()
  }

  /**
   * Get credentials for a connection.
   * Checks in-memory cache first, then fetches from backend (web) or keychain (desktop).
   */
  async function getCredentials(connectionId: string): Promise<ClickHouseCredentials> {
    const cached = credentialsCache.value.get(connectionId)
    if (cached) return cached

    const conn = connectionsStore.connections.find(c => c.id === connectionId)
    if (!conn || conn.type !== 'clickhouse') {
      throw new Error('ClickHouse connection not found')
    }

    let password: string

    if (isTauri()) {
      // Desktop: load password from OS keychain
      const { loadSecret } = await import('../services/secureStore')
      password = (await loadSecret(`conn:clickhouse:${connectionId}`)) ?? ''
    } else {
      // Web: fetch password from backend
      const response = await fetch(
        `${BACKEND_URL}/clickhouse/connections/${connectionId}/credentials`,
        { headers: await getAuthHeaders() },
      )
      if (!response.ok) throw new Error('Failed to fetch credentials')
      const data = await response.json()
      password = data.password
    }

    const credentials: ClickHouseCredentials = {
      host: conn.clickhouseHost!,
      port: conn.clickhousePort ?? 8443,
      username: conn.clickhouseUsername ?? '',
      password,
      database: conn.database ?? null,
      secure: conn.clickhouseSecure ?? true,
    }

    credentialsCache.value.set(connectionId, credentials)
    return credentials
  }

  /**
   * Get an HTTP client for a connection.
   */
  async function clientFor(connectionId: string) {
    return createClickHouseHttpClient(await getCredentials(connectionId))
  }

  /**
   * Test a connection (client-side — never touches the backend).
   */
  const testConnection = async (
    host: string,
    port: number,
    username: string,
    password: string,
    database: string | null,
    secure: boolean,
  ): Promise<TestConnectionResult> => {
    isTesting.value = true
    try {
      const client = createClickHouseHttpClient({ host, port, username, password, database, secure })
      return await client.testConnection()
    } finally {
      isTesting.value = false
    }
  }

  /**
   * Create a new connection.
   * Web: stores encrypted password on backend.
   * Desktop: stores password in OS keychain.
   * Both: stores non-secret metadata in IndexedDB.
   */
  const createConnection = async (
    name: string,
    host: string,
    port: number,
    username: string,
    password: string,
    database: string | null,
    secure: boolean,
  ): Promise<string> => {
    isConnecting.value = true
    try {
      let id: string

      if (isTauri()) {
        // Desktop: generate ID locally, store password in OS keychain
        id = `clickhouse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const { saveSecret } = await import('../services/secureStore')
        await saveSecret(`conn:clickhouse:${id}`, password)
      } else {
        // Web: POST to backend, get back server-generated ID
        const response = await fetch(`${BACKEND_URL}/clickhouse/connections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify({ name, host, port, username, password, database: database || undefined, secure }),
        })
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.detail || 'Failed to create connection')
        }
        const data = await response.json()
        id = data.id
      }

      // Store non-secret metadata in IndexedDB (NO password)
      connectionsStore.upsertConnection({
        id,
        type: 'clickhouse',
        name,
        database: database || undefined,
        createdAt: Date.now(),
        clickhouseHost: host,
        clickhousePort: port,
        clickhouseUsername: username,
        clickhouseSecure: secure,
      })

      // Cache credentials in memory for immediate use
      credentialsCache.value.set(id, { host, port, username, password, database, secure })

      return id
    } finally {
      isConnecting.value = false
    }
  }

  const runQuery = async (
    connectionId: string,
    query: string,
    signal?: AbortSignal | null,
  ): Promise<ClickHouseQueryResult> => {
    isExecutingQuery.value = true
    try {
      return await (await clientFor(connectionId)).runQuery(query, signal)
    } finally {
      isExecutingQuery.value = false
    }
  }

  const runQueryPaginated = async (
    connectionId: string,
    query: string,
    batchSize: number = 5000,
    offset: number = 0,
    includeCount: boolean = true,
    signal?: AbortSignal | null,
  ): Promise<ClickHousePaginatedQueryResult> => {
    isExecutingQuery.value = true
    try {
      return await (await clientFor(connectionId)).runQueryPaginated(query, batchSize, offset, includeCount, signal)
    } finally {
      isExecutingQuery.value = false
    }
  }

  const fetchDatabases = async (connectionId: string, force = false): Promise<ClickHouseDatabaseInfo[]> => {
    if (!force) {
      const cached = databasesCache.value.get(connectionId)
      if (cached) return cached
    }
    const databases = await (await clientFor(connectionId)).fetchDatabases()
    databasesCache.value.set(connectionId, databases)
    return databases
  }

  const fetchTables = async (connectionId: string, force = false): Promise<ClickHouseTableInfo[]> => {
    if (!force) {
      const cached = tablesCache.value.get(connectionId)
      if (cached) return cached
    }
    const tables = await (await clientFor(connectionId)).fetchTables()
    tablesCache.value.set(connectionId, tables)
    return tables
  }

  const fetchTablesForDatabase = async (
    connectionId: string,
    databaseName: string,
    force = false,
  ): Promise<ClickHouseTableInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}`
    if (!force) {
      const cached = tablesCache.value.get(cacheKey)
      if (cached) return cached
    }
    const allTables = await fetchTables(connectionId, force)
    const filtered = allTables.filter(t => t.databaseName === databaseName)
    tablesCache.value.set(cacheKey, filtered)
    return filtered
  }

  const fetchColumns = async (
    connectionId: string,
    databaseName: string,
    tableName: string,
  ): Promise<ClickHouseColumnInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${tableName}`
    const cached = columnsCache.value.get(cacheKey)
    if (cached) return cached
    const columns = await (await clientFor(connectionId)).fetchColumns(databaseName, tableName)
    columnsCache.value.set(cacheKey, columns)
    return columns
  }

  const fetchAllColumns = async (connectionId: string): Promise<void> => {
    const existing = allColumnsLoading.get(connectionId)
    if (existing) return existing

    const promise = (async () => {
      const columnsByTable = await (await clientFor(connectionId)).fetchAllColumns()
      const { useDuckDBStore } = await import('./duckdb')
      const duckdbStore = useDuckDBStore()

      const schemaRows = Object.entries(columnsByTable).flatMap(([tableKey, columns]) => {
        const parts = tableKey.split('.')
        const dbName = parts[0]
        const tableName = parts.slice(1).join('.')
        return columns.map(col => ({
          connection_type: 'clickhouse',
          connection_id: connectionId,
          catalog: dbName,
          schema_name: '',
          table_name: tableName,
          column_name: col.name,
          column_type: col.type,
          is_nullable: col.nullable,
        }))
      })

      await duckdbStore.replaceConnectionSchemas('clickhouse', connectionId, schemaRows)
    })()

    allColumnsLoading.set(connectionId, promise)
    try { await promise } finally { allColumnsLoading.delete(connectionId) }
  }

  const fetchTableMetadata = async (
    connectionId: string,
    databaseName: string,
    tableName: string,
  ): Promise<TableMetadataInfo> => {
    const cacheKey = `${connectionId}:${databaseName}.${tableName}`
    const cached = metadataCache.value.get(cacheKey)
    if (cached) return cached
    const raw = await (await clientFor(connectionId)).fetchTableMetadata(databaseName, tableName)
    const metadata: TableMetadataInfo = {
      rowCount: raw.rowCount,
      sizeBytes: raw.sizeBytes,
      tableType: raw.engine,
      engine: 'clickhouse',
    }
    metadataCache.value.set(cacheKey, metadata)
    return metadata
  }

  const deleteConnection = async (connectionId: string): Promise<void> => {
    clearConnectionCache(connectionId)

    if (isTauri()) {
      const { deleteSecret } = await import('../services/secureStore')
      await deleteSecret(`conn:clickhouse:${connectionId}`)
    } else {
      // Web: delete from backend (ignore errors if connection doesn't exist there)
      try {
        await fetch(`${BACKEND_URL}/clickhouse/connections/${connectionId}`, {
          method: 'DELETE',
          headers: await getAuthHeaders(),
        })
      } catch { /* best-effort */ }
    }

    connectionsStore.removeConnection(connectionId)
  }

  const clearConnectionCache = (connectionId: string): void => {
    credentialsCache.value.delete(connectionId)
    databasesCache.value.delete(connectionId)
    tablesCache.value.delete(connectionId)
    for (const key of tablesCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) tablesCache.value.delete(key)
    }
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) columnsCache.value.delete(key)
    }
    for (const key of metadataCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) metadataCache.value.delete(key)
    }
  }

  const refreshSchemas = async (connectionId: string): Promise<void> => {
    for (const key of columnsCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) columnsCache.value.delete(key)
    }
    await fetchTables(connectionId, true)
  }

  return {
    credentialsCache,
    databasesCache,
    tablesCache,
    columnsCache,
    isConnecting,
    isExecutingQuery,
    isTesting,
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
    refreshSchemas,
  }
})
