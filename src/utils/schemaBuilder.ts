export interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
}

// Completion object type
interface CompletionItem {
  label: string
  apply?: string
  type?: string
  detail?: string
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

// Combine schemas for autocompletion
export function combineSchemas(
  duckdb: Record<string, any>,
  bigquery: Record<string, any>
): Record<string, any> {
  return { ...duckdb, ...bigquery }
}
