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
 * Table reference with position information for Cmd+click navigation
 */
export interface TableReferenceWithPosition {
  tableName: string      // Full reference including quotes: "`project.dataset.table`"
  rawName: string        // Name without quotes: "project.dataset.table"
  from: number           // Start offset in document
  to: number             // End offset in document
  parts: string[]        // Split components: ["project", "dataset", "table"]
}

/**
 * Extract qualified table references with their positions in the document.
 * Only returns qualified names (containing dots) that can be unambiguously resolved.
 * Used for Cmd+click navigation feature.
 */
export function extractTableReferencesWithPositions(query: string): TableReferenceWithPosition[] {
  const refs: TableReferenceWithPosition[] = []

  // Pattern matches FROM/JOIN followed by:
  // - Backtick-quoted: `project.dataset.table`
  // - Double-quoted parts: "db"."schema"."table"
  // - Unquoted: schema.table
  // Captures the full table reference including any quotes
  const pattern = /(?:FROM|JOIN)\s+(`[^`]+`|"[^"]+(?:"\s*\.\s*"[^"]+)*"|[^\s,;()]+)/gi

  let match
  while ((match = pattern.exec(query)) !== null) {
    const fullMatch = match[0]
    const tableRef = match[1]

    // Calculate position of the table reference within the full match
    const keywordAndSpace = fullMatch.slice(0, fullMatch.length - tableRef.length)
    const from = match.index + keywordAndSpace.length
    const to = from + tableRef.length

    // Parse the table name, removing quotes
    let rawName: string
    let parts: string[]

    if (tableRef.startsWith('`') && tableRef.endsWith('`')) {
      // BigQuery backtick format: `project.dataset.table`
      rawName = tableRef.slice(1, -1)
      parts = rawName.split('.')
    } else if (tableRef.includes('"')) {
      // Double-quoted format: "db"."schema"."table"
      rawName = tableRef.replace(/"/g, '').replace(/\s*\.\s*/g, '.')
      parts = rawName.split('.')
    } else {
      // Unquoted format: schema.table
      rawName = tableRef
      parts = tableRef.split('.')
    }

    // Only include qualified names (with at least one dot)
    if (parts.length >= 2) {
      refs.push({
        tableName: tableRef,
        rawName,
        from,
        to,
        parts
      })
    }
  }

  return refs
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
