/**
 * Query analyzer utility to detect target engine (BigQuery or DuckDB)
 */

/**
 * Extract table references from SQL query
 */
export function extractTableReferences(query: string): string[] {
  const tableRefs: string[] = []

  // Pattern: FROM/JOIN followed by optional dataset.table or just table
  // Matches:
  //   - `project.dataset.table`
  //   - `dataset.table`
  //   - `table_name`
  //   - `query_1`, `my_results`, etc.
  const fromPattern = /(?:FROM|JOIN)\s+(?:`([^`]+)`|(\S+))/gi

  let match
  while ((match = fromPattern.exec(query)) !== null) {
    const tableName = match[1] || match[2]
    tableRefs.push(tableName)
  }

  return tableRefs
}

/**
 * Detect if query targets BigQuery based on patterns
 */
export function isBigQueryQuery(query: string, duckDBTables: string[] = []): boolean {
  // Normalize for comparison
  const normalized = query.toLowerCase().trim()

  // Explicit BigQuery project references (contains dots suggesting project.dataset.table)
  // Pattern: backticks with at least 2 dots, or unquoted identifier with 2+ dots
  const hasBQProjectRef = /(?:FROM|JOIN)\s+`?[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+`?/i.test(query)
  if (hasBQProjectRef) return true

  // Check if any referenced table exists in DuckDB
  const tableRefs = extractTableReferences(query)
  const referencesLocalTable = tableRefs.some(ref => {
    // Extract just the table name (last part after dots)
    const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
    return duckDBTables.includes(tableName)
  })

  if (referencesLocalTable) return false

  // BigQuery-specific functions (some common ones)
  const bqFunctions = [
    'safe_cast', 'safe_divide', 'generate_uuid',
    'approx_count_distinct', 'approx_quantiles'
  ]

  const hasBQFunction = bqFunctions.some(fn =>
    normalized.includes(fn)
  )

  // If no local tables referenced and no specific DuckDB patterns, assume BigQuery
  // This maintains backward compatibility
  return !referencesLocalTable
}

/**
 * Detect which engine should execute the query
 */
export function detectQueryEngine(query: string, duckDBTables: string[] = []): 'bigquery' | 'duckdb' {
  return isBigQueryQuery(query, duckDBTables) ? 'bigquery' : 'duckdb'
}
