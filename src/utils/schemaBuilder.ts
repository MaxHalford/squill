export interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
}

/** Schema structure for CodeMirror SQL autocompletion: table names map to column arrays, or nested namespaces */
export interface SchemaNamespace {
  [key: string]: string[] | SchemaNamespace
}

// Build schema from DuckDB tables for CodeMirror autocompletion
export function buildDuckDBSchema(tables: Record<string, TableMetadata>): Record<string, string[]> {
  const schema: Record<string, string[]> = {}

  for (const [tableName, metadata] of Object.entries(tables)) {
    // Simple array of column names
    schema[tableName] = metadata.columns || []
  }

  return schema
}
