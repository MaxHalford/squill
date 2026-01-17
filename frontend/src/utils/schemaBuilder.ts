import type { PostgresTableInfo, PostgresColumnInfo } from '../stores/postgres'
import type { SnowflakeTableInfo, SnowflakeColumnInfo } from '../stores/snowflake'

export interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
}

// Build schema from DuckDB tables for CodeMirror autocompletion
export function buildDuckDBSchema(tables: Record<string, TableMetadata>): Record<string, any> {
  const schema: Record<string, any> = {}

  for (const [tableName, metadata] of Object.entries(tables)) {
    // Simple array of column names
    schema[tableName] = metadata.columns || []
  }

  return schema
}

// Build schema from BigQuery data
// Takes the bigQuerySchemas from schema store
// Key format: "project.dataset.table" -> [{ name, type }]
export function buildBigQuerySchema(
  bigQuerySchemas: Record<string, Array<{ name: string; type: string }>>,
  activeProject?: string
): Record<string, any> {
  const schema: Record<string, any> = {}

  // Build hierarchical structure: project -> dataset -> table -> columns
  for (const [fullTableName, columns] of Object.entries(bigQuerySchemas)) {
    const parts = fullTableName.split('.')
    if (parts.length !== 3) continue

    const [project, dataset, table] = parts

    // Initialize project level
    if (!schema[project]) {
      schema[project] = {}
    }

    // Initialize dataset level
    if (!schema[project][dataset]) {
      schema[project][dataset] = {}
    }

    // Add table with columns (just column names as strings)
    schema[project][dataset][table] = columns.map(col => col.name)

    // If this is the active project, also add dataset-level shortcuts
    if (activeProject && project === activeProject) {
      // Add dataset.table shortcut
      const datasetTableKey = `${dataset}.${table}`
      if (!schema[datasetTableKey]) {
        schema[datasetTableKey] = columns.map(col => col.name)
      }

      // Also add dataset as top-level with its tables
      if (!schema[dataset]) {
        schema[dataset] = {}
      }
      if (!schema[dataset][table]) {
        schema[dataset][table] = columns.map(col => col.name)
      }
    }
  }

  return schema
}

// Build schema from PostgreSQL data for CodeMirror autocompletion
export function buildPostgresSchema(
  tablesCache: Map<string, PostgresTableInfo[]>,
  columnsCache: Map<string, PostgresColumnInfo[]>,
  connectionId: string
): Record<string, any> {
  const schema: Record<string, any> = {}

  const tables = tablesCache.get(connectionId)
  if (!tables) return schema

  for (const table of tables) {
    const cacheKey = `${connectionId}:${table.schemaName}.${table.name}`
    const columns = columnsCache.get(cacheKey)
    const columnNames = columns?.map(col => col.name) || []

    // Add schema-qualified name: schema.table
    const qualifiedName = `${table.schemaName}.${table.name}`
    schema[qualifiedName] = columnNames

    // For 'public' schema, also add unqualified table name for convenience
    if (table.schemaName === 'public') {
      schema[table.name] = columnNames
    }
  }

  return schema
}

// Build schema from Snowflake data for CodeMirror autocompletion
export function buildSnowflakeSchema(
  tablesCache: Map<string, SnowflakeTableInfo[]>,
  columnsCache: Map<string, SnowflakeColumnInfo[]>,
  connectionId: string
): Record<string, any> {
  const schema: Record<string, any> = {}

  const tables = tablesCache.get(connectionId)
  if (!tables) return schema

  for (const table of tables) {
    const cacheKey = `${connectionId}:${table.databaseName}.${table.schemaName}.${table.name}`
    const columns = columnsCache.get(cacheKey)
    const columnNames = columns?.map(col => col.name) || []

    // Add fully-qualified name: database.schema.table
    const fullyQualifiedName = `${table.databaseName}.${table.schemaName}.${table.name}`
    schema[fullyQualifiedName] = columnNames

    // Add schema-qualified name: schema.table
    const schemaQualifiedName = `${table.schemaName}.${table.name}`
    if (!schema[schemaQualifiedName]) {
      schema[schemaQualifiedName] = columnNames
    }

    // For 'PUBLIC' schema, also add unqualified table name for convenience
    if (table.schemaName.toUpperCase() === 'PUBLIC') {
      if (!schema[table.name]) {
        schema[table.name] = columnNames
      }
    }
  }

  return schema
}

// Combine schemas for autocompletion
export function combineSchemas(
  duckdb: Record<string, any>,
  bigquery: Record<string, any>,
  postgres: Record<string, any> = {},
  snowflake: Record<string, any> = {}
): Record<string, any> {
  return { ...duckdb, ...bigquery, ...postgres, ...snowflake }
}
