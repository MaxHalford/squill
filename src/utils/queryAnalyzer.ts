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
export function referencesLocalDuckDBTable(query: string, duckDBTables: string[]): boolean {
  if (duckDBTables.length === 0) return false

  const tableRefs = extractTableReferences(query)

  return tableRefs.some(ref => {
    // Extract just the table name (last part after dots)
    const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
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

/**
 * Check if a connection type represents a local/in-memory database
 * Currently only DuckDB is local, but this could include SQLite in the future
 */
export function isLocalDatabase(connectionType: ConnectionType | undefined): boolean {
  return connectionType === 'duckdb'
}

// ============================================
// DEPRECATED: Legacy functions for backwards compatibility
// These are maintained during migration but should be removed
// ============================================

/**
 * @deprecated Use getEffectiveEngine() instead
 * Detect if query targets BigQuery based on patterns
 */
export function isBigQueryQuery(query: string, duckDBTables: string[] = []): boolean {
  // Check if any referenced table exists in DuckDB
  if (referencesLocalDuckDBTable(query, duckDBTables)) {
    return false
  }

  // Without a connection context, we can't definitively say it's BigQuery
  // Default to false (DuckDB) for safety
  return false
}

/**
 * @deprecated Use getEffectiveEngine() instead
 * Detect which engine should execute the query
 */
export function detectQueryEngine(query: string, duckDBTables: string[] = []): 'bigquery' | 'duckdb' {
  return isBigQueryQuery(query, duckDBTables) ? 'bigquery' : 'duckdb'
}
