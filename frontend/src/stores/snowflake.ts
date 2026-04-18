/**
 * Snowflake store — manages connections, queries, and schema browsing.
 *
 * Queries run client-side via Snowflake SQL REST API.
 * Passwords are NEVER stored in IndexedDB:
 *   - Web: stored encrypted on Squill backend, fetched on-demand
 *   - Desktop: stored in OS keychain (macOS Keychain / Windows Credential Manager)
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import {
  createSnowflakeRestClient,
  type SnowflakeCredentials,
  type SnowflakeQueryResult,
  type SnowflakePaginatedQueryResult,
  type SnowflakeDatabaseInfo,
  type SnowflakeSchemaInfo,
  type SnowflakeTableInfo,
  type SnowflakeColumnInfo,
} from '../services/snowflake/restClient'
import type { TableMetadataInfo } from '../types/database'
import { isTauri } from '../utils/tauri'

export type {
  SnowflakeCredentials,
  SnowflakeQueryResult,
  SnowflakePaginatedQueryResult,
  SnowflakeDatabaseInfo,
  SnowflakeSchemaInfo,
  SnowflakeTableInfo,
  SnowflakeColumnInfo,
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export const useSnowflakeStore = defineStore('snowflake', () => {
  const connectionsStore = useConnectionsStore()

  // In-memory credentials cache (passwords live here only, never in IndexedDB)
  const credentialsCache = ref<Map<string, SnowflakeCredentials>>(new Map())

  // Schema caches
  const databasesCache = ref<Map<string, SnowflakeDatabaseInfo[]>>(new Map())
  const schemasCache = ref<Map<string, SnowflakeSchemaInfo[]>>(new Map())
  const tablesCache = ref<Map<string, SnowflakeTableInfo[]>>(new Map())
  const columnsCache = ref<Map<string, SnowflakeColumnInfo[]>>(new Map())
  const metadataCache = ref<Map<string, TableMetadataInfo>>(new Map())

  // Loading states
  const isConnecting = ref(false)
  const isExecutingQuery = ref(false)
  const isTesting = ref(false)

  const allColumnsLoading = new Map<string, Promise<void>>()

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { useUserStore } = await import('./user')
    return useUserStore().getAuthHeaders()
  }

  async function getCredentials(connectionId: string): Promise<SnowflakeCredentials> {
    const cached = credentialsCache.value.get(connectionId)
    if (cached) return cached

    const conn = connectionsStore.connections.find(c => c.id === connectionId)
    if (!conn || conn.type !== 'snowflake') {
      throw new Error('Snowflake connection not found')
    }

    let password: string

    if (isTauri()) {
      const { loadSecret } = await import('../services/secureStore')
      password = (await loadSecret(`conn:snowflake:${connectionId}`)) ?? ''
    } else {
      const response = await fetch(
        `${BACKEND_URL}/snowflake/connections/${connectionId}/credentials`,
        { headers: await getAuthHeaders() },
      )
      if (!response.ok) throw new Error('Failed to fetch credentials')
      const data = await response.json()
      password = data.password
    }

    const credentials: SnowflakeCredentials = {
      account: conn.snowflakeAccount!,
      username: conn.snowflakeUsername ?? '',
      password,
      warehouse: conn.snowflakeWarehouse ?? null,
      database: conn.database ?? null,
      schemaName: conn.snowflakeSchema ?? null,
      role: conn.snowflakeRole ?? null,
    }

    credentialsCache.value.set(connectionId, credentials)
    return credentials
  }

  async function clientFor(connectionId: string) {
    return createSnowflakeRestClient(await getCredentials(connectionId))
  }

  const testConnection = async (
    account: string,
    username: string,
    password: string,
    warehouse: string | null,
    database: string | null,
    schemaName: string | null,
    role: string | null,
  ): Promise<TestConnectionResult> => {
    isTesting.value = true
    try {
      const client = createSnowflakeRestClient({ account, username, password, warehouse, database, schemaName, role })
      return await client.testConnection()
    } finally {
      isTesting.value = false
    }
  }

  const createConnection = async (
    name: string,
    account: string,
    username: string,
    password: string,
    warehouse: string | null,
    database: string | null,
    schemaName: string | null,
    role: string | null,
  ): Promise<string> => {
    isConnecting.value = true
    try {
      let id: string

      if (isTauri()) {
        id = `snowflake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const { saveSecret } = await import('../services/secureStore')
        await saveSecret(`conn:snowflake:${id}`, password)
      } else {
        const response = await fetch(`${BACKEND_URL}/snowflake/connections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify({
            name, account, username, password,
            warehouse: warehouse || undefined,
            database: database || undefined,
            schema_name: schemaName || undefined,
            role: role || undefined,
          }),
        })
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.detail || 'Failed to create connection')
        }
        const data = await response.json()
        id = data.id
      }

      connectionsStore.upsertConnection({
        id,
        type: 'snowflake',
        name,
        database: database || undefined,
        createdAt: Date.now(),
        snowflakeAccount: account,
        snowflakeUsername: username,
        snowflakeWarehouse: warehouse || undefined,
        snowflakeSchema: schemaName || undefined,
        snowflakeRole: role || undefined,
      })

      credentialsCache.value.set(id, { account, username, password, warehouse, database, schemaName, role })

      return id
    } finally {
      isConnecting.value = false
    }
  }

  const runQuery = async (
    connectionId: string,
    query: string,
    signal?: AbortSignal | null,
  ): Promise<SnowflakeQueryResult> => {
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
  ): Promise<SnowflakePaginatedQueryResult> => {
    isExecutingQuery.value = true
    try {
      return await (await clientFor(connectionId)).runQueryPaginated(query, batchSize, offset, includeCount, signal)
    } finally {
      isExecutingQuery.value = false
    }
  }

  const fetchDatabases = async (connectionId: string, force = false): Promise<SnowflakeDatabaseInfo[]> => {
    if (!force) {
      const cached = databasesCache.value.get(connectionId)
      if (cached) return cached
    }
    const databases = await (await clientFor(connectionId)).fetchDatabases()
    databasesCache.value.set(connectionId, databases)
    return databases
  }

  const fetchSchemas = async (connectionId: string, databaseName: string, force = false): Promise<SnowflakeSchemaInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}`
    if (!force) {
      const cached = schemasCache.value.get(cacheKey)
      if (cached) return cached
    }
    const schemas = await (await clientFor(connectionId)).fetchSchemas(databaseName)
    schemasCache.value.set(cacheKey, schemas)
    return schemas
  }

  const fetchTables = async (connectionId: string, force = false): Promise<SnowflakeTableInfo[]> => {
    if (!force) {
      const cached = tablesCache.value.get(connectionId)
      if (cached) return cached
    }
    const tables = await (await clientFor(connectionId)).fetchTables()
    tablesCache.value.set(connectionId, tables)
    return tables
  }

  const fetchTablesForSchema = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    force = false,
  ): Promise<SnowflakeTableInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${schemaName}`
    if (!force) {
      const cached = tablesCache.value.get(cacheKey)
      if (cached) return cached
    }
    const allTables = await fetchTables(connectionId, force)
    const filtered = allTables.filter(t => t.databaseName === databaseName && t.schemaName === schemaName)
    tablesCache.value.set(cacheKey, filtered)
    return filtered
  }

  const fetchColumns = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    tableName: string,
  ): Promise<SnowflakeColumnInfo[]> => {
    const cacheKey = `${connectionId}:${databaseName}.${schemaName}.${tableName}`
    const cached = columnsCache.value.get(cacheKey)
    if (cached) return cached
    const columns = await (await clientFor(connectionId)).fetchColumns(databaseName, schemaName, tableName)
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
        const sfSchemaName = parts[1]
        const tableName = parts.slice(2).join('.')
        return columns.map(col => ({
          connection_type: 'snowflake',
          connection_id: connectionId,
          catalog: dbName,
          schema_name: sfSchemaName,
          table_name: tableName,
          column_name: col.name,
          column_type: col.type,
          is_nullable: col.nullable,
        }))
      })

      await duckdbStore.replaceConnectionSchemas('snowflake', connectionId, schemaRows)
    })()

    allColumnsLoading.set(connectionId, promise)
    try { await promise } finally { allColumnsLoading.delete(connectionId) }
  }

  const fetchTableMetadata = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    tableName: string,
  ): Promise<TableMetadataInfo> => {
    const cacheKey = `${connectionId}:${databaseName}.${schemaName}.${tableName}`
    const cached = metadataCache.value.get(cacheKey)
    if (cached) return cached
    const raw = await (await clientFor(connectionId)).fetchTableMetadata(databaseName, schemaName, tableName)
    const metadata: TableMetadataInfo = {
      rowCount: raw.rowCount,
      sizeBytes: raw.sizeBytes,
      tableType: raw.tableType,
      engine: 'snowflake',
    }
    metadataCache.value.set(cacheKey, metadata)
    return metadata
  }

  const deleteConnection = async (connectionId: string): Promise<void> => {
    clearConnectionCache(connectionId)

    if (isTauri()) {
      const { deleteSecret } = await import('../services/secureStore')
      await deleteSecret(`conn:snowflake:${connectionId}`)
    } else {
      try {
        await fetch(`${BACKEND_URL}/snowflake/connections/${connectionId}`, {
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
    for (const key of schemasCache.value.keys()) {
      if (key.startsWith(`${connectionId}:`)) schemasCache.value.delete(key)
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
    schemasCache,
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
    fetchSchemas,
    fetchTablesForSchema,
    fetchTables,
    fetchColumns,
    fetchAllColumns,
    fetchTableMetadata,
    deleteConnection,
    clearConnectionCache,
    refreshSchemas,
  }
})
