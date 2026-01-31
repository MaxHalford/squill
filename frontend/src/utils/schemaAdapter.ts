/**
 * Schema adapter for collecting and formatting database schemas
 * across BigQuery, DuckDB, and PostgreSQL in a unified format
 *
 * Includes localStorage-backed caching for performance with large schemas.
 * Schema is only refreshed when explicitly requested by the user.
 */

import { useSchemaStore } from '../stores/bigquerySchema'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import type { SchemaItem, ScoredSchemaItem } from './textSimilarity'

export type ConnectionType = 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'

// localStorage key for schema cache
const SCHEMA_CACHE_KEY = 'squill-schema-cache'

interface SchemaCacheEntry {
  items: SchemaItem[]
  timestamp: number
}

interface SchemaCache {
  [key: string]: SchemaCacheEntry
}

// In-memory cache (loaded from localStorage on first access)
let memoryCache: SchemaCache | null = null

/**
 * Get cache key for a connection
 */
function getCacheKey(connectionType: ConnectionType, connectionId?: string): string {
  return connectionId ? `${connectionType}:${connectionId}` : connectionType
}

/**
 * Load schema cache from localStorage
 */
function loadCache(): SchemaCache {
  if (memoryCache !== null) return memoryCache

  try {
    const stored = localStorage.getItem(SCHEMA_CACHE_KEY)
    memoryCache = stored ? JSON.parse(stored) : {}
  } catch {
    memoryCache = {}
  }
  return memoryCache!
}

/**
 * Save schema cache to localStorage
 */
function saveCache(): void {
  if (!memoryCache) return
  try {
    localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify(memoryCache))
  } catch (err) {
    // localStorage might be full or unavailable
    console.warn('Failed to save schema cache:', err)
  }
}

/**
 * Get cached schema for a connection (returns empty array if not cached)
 */
export function getCachedSchema(
  connectionType: ConnectionType,
  connectionId?: string
): SchemaItem[] {
  const cache = loadCache()
  const key = getCacheKey(connectionType, connectionId)
  return cache[key]?.items || []
}

/**
 * Check if schema is cached for a connection
 */
export function hasSchemaCache(
  connectionType: ConnectionType,
  connectionId?: string
): boolean {
  const cache = loadCache()
  const key = getCacheKey(connectionType, connectionId)
  return key in cache
}

/**
 * Refresh and cache schema for a connection.
 * This should only be called when user explicitly requests a refresh.
 */
export function refreshSchemaCache(
  connectionType: ConnectionType,
  connectionId?: string
): SchemaItem[] {
  const items = doCollectSchema(connectionType, connectionId)
  const cache = loadCache()
  const key = getCacheKey(connectionType, connectionId)

  cache[key] = {
    items,
    timestamp: Date.now()
  }

  saveCache()
  return items
}

/**
 * Clear schema cache for a specific connection or all connections
 */
export function clearSchemaCache(
  connectionType?: ConnectionType,
  connectionId?: string
): void {
  const cache = loadCache()

  if (connectionType) {
    const key = getCacheKey(connectionType, connectionId)
    delete cache[key]
  } else {
    // Clear all
    Object.keys(cache).forEach(key => delete cache[key])
  }

  saveCache()
}

/**
 * Collect schema items from the appropriate store based on connection type.
 * Returns cached data if available, otherwise collects fresh data and caches it.
 *
 * For performance-critical paths (like search), use getCachedSchema() directly.
 */
export function collectSchemaForConnection(
  connectionType: ConnectionType,
  connectionId?: string
): SchemaItem[] {
  // Return cached data if available
  const cached = getCachedSchema(connectionType, connectionId)
  if (cached.length > 0) {
    return cached
  }

  // No cache - collect fresh and cache it
  return refreshSchemaCache(connectionType, connectionId)
}

/**
 * Internal: Actually collect schema from stores (no caching)
 */
function doCollectSchema(
  connectionType: ConnectionType,
  connectionId?: string
): SchemaItem[] {
  switch (connectionType) {
    case 'bigquery':
      return collectBigQuerySchema()
    case 'duckdb':
      return collectDuckDBSchema()
    case 'postgres':
      return collectPostgresSchema(connectionId)
    case 'snowflake':
      return collectSnowflakeSchema(connectionId)
    default:
      return []
  }
}

/**
 * Collect BigQuery schema from the schema store
 * Format: "project.dataset.table" -> columns
 */
function collectBigQuerySchema(): SchemaItem[] {
  const schemaStore = useSchemaStore()
  const items: SchemaItem[] = []

  for (const [fullTableName, columns] of Object.entries(schemaStore.bigQuerySchemas)) {
    items.push({
      tableName: fullTableName,
      columns: columns.map((col) => ({ name: col.name, type: col.type })),
    })
  }

  return items
}

/**
 * Collect DuckDB schema from the duckdb store
 * Format: tableName -> { columns?: string[] }
 */
function collectDuckDBSchema(): SchemaItem[] {
  const duckdbStore = useDuckDBStore()
  const items: SchemaItem[] = []

  for (const [tableName, metadata] of Object.entries(duckdbStore.tables)) {
    items.push({
      tableName,
      columns: (metadata.columns || []).map((name) => ({ name, type: 'unknown' })),
    })
  }

  return items
}

/**
 * Collect PostgreSQL schema from the postgres store
 * Uses cached tables and columns
 */
function collectPostgresSchema(connectionId?: string): SchemaItem[] {
  if (!connectionId) return []

  const postgresStore = usePostgresStore()
  const items: SchemaItem[] = []

  const tables = postgresStore.tablesCache.get(connectionId) || []

  for (const table of tables) {
    const cacheKey = `${connectionId}:${table.schemaName}.${table.name}`
    const columns = postgresStore.columnsCache.get(cacheKey) || []

    items.push({
      tableName: `${table.schemaName}.${table.name}`,
      columns: columns.map((col) => ({ name: col.name, type: col.type })),
    })
  }

  return items
}

/**
 * Collect Snowflake schema from the snowflake store
 * Uses cached tables and columns
 */
function collectSnowflakeSchema(connectionId?: string): SchemaItem[] {
  if (!connectionId) return []

  const snowflakeStore = useSnowflakeStore()
  const items: SchemaItem[] = []

  const tables = snowflakeStore.tablesCache.get(connectionId) || []

  for (const table of tables) {
    const cacheKey = `${connectionId}:${table.databaseName}.${table.schemaName}.${table.name}`
    const columns = snowflakeStore.columnsCache.get(cacheKey) || []

    items.push({
      tableName: `${table.databaseName}.${table.schemaName}.${table.name}`,
      columns: columns.map((col) => ({ name: col.name, type: col.type })),
    })
  }

  return items
}

/**
 * Format filtered schema for LLM consumption
 * Uses concise format grouped by dataset/schema
 */
export function formatSchemaForLLM(
  schema: ScoredSchemaItem[],
  connectionType: ConnectionType,
  projectId?: string
): string {
  if (schema.length === 0) return ''

  switch (connectionType) {
    case 'bigquery':
      return formatBigQuerySchema(schema, projectId)
    case 'postgres':
      return formatPostgresSchema(schema)
    case 'snowflake':
      return formatSnowflakeSchema(schema)
    case 'duckdb':
      return formatDuckDBSchema(schema)
    default:
      return ''
  }
}

/**
 * Format BigQuery schema grouped by dataset
 * Output: Tables in `project`:
 *         dataset1: table1(col1, col2), table2(col1)
 *         dataset2: table3(col1)
 */
function formatBigQuerySchema(schema: ScoredSchemaItem[], projectId?: string): string {
  // Group tables by project.dataset
  const grouped = new Map<string, Map<string, string[]>>()

  for (const item of schema) {
    // Parse "project.dataset.table" format
    const parts = item.tableName.split('.')
    if (parts.length !== 3) continue

    const [project, dataset, table] = parts
    const colNames = item.columns.map((c) => c.name).join(', ')

    if (!grouped.has(project)) {
      grouped.set(project, new Map())
    }
    const datasets = grouped.get(project)!
    if (!datasets.has(dataset)) {
      datasets.set(dataset, [])
    }
    datasets.get(dataset)!.push(`${table}(${colNames})`)
  }

  // Format output
  const lines: string[] = []

  for (const [project, datasets] of grouped) {
    // Use provided projectId or extract from schema
    const displayProject = projectId || project
    lines.push(`Tables in \`${displayProject}\`:`)

    for (const [dataset, tables] of datasets) {
      lines.push(`${dataset}: ${tables.join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format PostgreSQL schema grouped by schema name
 * Output: Tables:
 *         public: users(id, email), orders(id, user_id)
 */
function formatPostgresSchema(schema: ScoredSchemaItem[]): string {
  // Group tables by schema
  const grouped = new Map<string, string[]>()

  for (const item of schema) {
    // Parse "schema.table" format
    const parts = item.tableName.split('.')
    const schemaName = parts.length === 2 ? parts[0] : 'public'
    const tableName = parts.length === 2 ? parts[1] : parts[0]

    const colNames = item.columns.map((c) => c.name).join(', ')

    if (!grouped.has(schemaName)) {
      grouped.set(schemaName, [])
    }
    grouped.get(schemaName)!.push(`${tableName}(${colNames})`)
  }

  // Format output
  const lines: string[] = ['Tables:']

  for (const [schemaName, tables] of grouped) {
    lines.push(`${schemaName}: ${tables.join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Format DuckDB schema as a flat list
 * Output: Tables: table1(col1, col2), table2(col1)
 */
function formatDuckDBSchema(schema: ScoredSchemaItem[]): string {
  const tables = schema.map((item) => {
    const colNames = item.columns.map((c) => c.name).join(', ')
    return `${item.tableName}(${colNames})`
  })

  return `Tables: ${tables.join(', ')}`
}

/**
 * Format Snowflake schema grouped by database and schema
 * Output: Tables in `database`:
 *         schema1: table1(col1, col2), table2(col1)
 */
function formatSnowflakeSchema(schema: ScoredSchemaItem[]): string {
  // Group tables by database.schema
  const grouped = new Map<string, Map<string, string[]>>()

  for (const item of schema) {
    // Parse "database.schema.table" format
    const parts = item.tableName.split('.')
    if (parts.length !== 3) continue

    const [database, schemaName, table] = parts
    const colNames = item.columns.map((c) => c.name).join(', ')

    if (!grouped.has(database)) {
      grouped.set(database, new Map())
    }
    const schemas = grouped.get(database)!
    if (!schemas.has(schemaName)) {
      schemas.set(schemaName, [])
    }
    schemas.get(schemaName)!.push(`${table}(${colNames})`)
  }

  // Format output
  const lines: string[] = []

  for (const [database, schemas] of grouped) {
    lines.push(`Tables in \`${database}\`:`)

    for (const [schemaName, tables] of schemas) {
      lines.push(`${schemaName}: ${tables.join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format sample queries for LLM consumption
 * Uses checkmark prefix to indicate successful queries
 */
export function formatSampleQueries(queries: string[]): string {
  if (queries.length === 0) return ''

  return queries.map((q) => `\u2713 ${q.trim()}`).join('\n')
}
