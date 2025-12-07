/**
 * Query analyzer utility for detecting table references
 *
 * The engine selection logic:
 * 1. Each query box has an associated connection (BigQuery, DuckDB, Postgres, etc.)
 * 2. The connection type determines the default execution engine
 * 3. If the query references a local DuckDB table, it overrides to DuckDB
 *    (since query results from all connections are stored in DuckDB)
 */

import type { ConnectionType } from '../types/connection'
import { isLocalConnectionType } from './connectionHelpers'

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
 * Check if query references any local DuckDB table
 * Used to override connection-based routing to DuckDB when needed
 */
function referencesLocalDuckDBTable(query: string, duckDBTables: string[]): boolean {
  if (duckDBTables.length === 0) return false

  const tableRefs = extractTableReferences(query)

  return tableRefs.some(ref => {
    // Qualified names (schema.table, project.dataset.table) are remote references
    // Only unqualified names should match local DuckDB tables
    if (ref.includes('.')) {
      return false
    }

    const tableName = ref.replace(/`/g, '').toLowerCase()
    return duckDBTables.includes(tableName)
  })
}

/**
 * Determine the effective engine for a query based on connection and table references
 *
 * @param connectionType - The connection type from the box's assigned connection
 * @param query - The SQL query text
 * @param duckDBTables - List of available DuckDB table names
 * @returns The connection type to use for execution
 */
export function getEffectiveEngine(
  connectionType: ConnectionType | undefined,
  query: string,
  duckDBTables: string[]
): ConnectionType {
  // If query references a local DuckDB table, always use DuckDB
  // This allows cross-connection analysis using stored query results
  if (referencesLocalDuckDBTable(query, duckDBTables)) {
    return 'duckdb'
  }

  // Otherwise, use the connection type (default to 'duckdb' if no connection)
  return connectionType || 'duckdb'
}

// Re-export for convenience
export { isLocalConnectionType }
