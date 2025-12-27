/**
 * Query analyzer utility to detect target engine (BigQuery or DuckDB)
 */

/**
 * Extract table references from SQL query
 * @param {string} query - SQL query to analyze
 * @returns {string[]} - Array of table names referenced in the query
 */
export function extractTableReferences(query) {
  const tableRefs = []

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
 * @param {string} query - SQL query to analyze
 * @param {string[]} duckDBTables - List of available DuckDB tables
 * @returns {boolean} - True if query targets BigQuery
 */
export function isBigQueryQuery(query, duckDBTables = []) {
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
    const tableName = ref.split('.').pop().replace(/`/g, '').toLowerCase()
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
 * @param {string} query - SQL query to analyze
 * @param {string[]} duckDBTables - List of available DuckDB tables
 * @returns {'bigquery'|'duckdb'} - Engine to use
 */
export function detectQueryEngine(query, duckDBTables = []) {
  const tableRefs = extractTableReferences(query)
  const engine = isBigQueryQuery(query, duckDBTables) ? 'bigquery' : 'duckdb'

  console.log(`🔍 Query Detection:`)
  console.log(`  Tables referenced:`, tableRefs)
  console.log(`  Available DuckDB tables:`, duckDBTables)
  console.log(`  Selected engine: ${engine}`)

  return engine
}
