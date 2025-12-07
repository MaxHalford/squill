/**
 * Schema adapter for collecting and formatting database schemas
 * across BigQuery, DuckDB, and PostgreSQL in a unified format
 */

import { useSchemaStore } from '../stores/bigquerySchema'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import type { SchemaItem, ScoredSchemaItem } from './textSimilarity'

export type ConnectionType = 'bigquery' | 'duckdb' | 'postgres'

/**
 * Collect schema items from the appropriate store based on connection type
 */
export function collectSchemaForConnection(
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
 * Format sample queries for LLM consumption
 * Uses checkmark prefix to indicate successful queries
 */
export function formatSampleQueries(queries: string[]): string {
  if (queries.length === 0) return ''

  return queries.map((q) => `\u2713 ${q.trim()}`).join('\n')
}
