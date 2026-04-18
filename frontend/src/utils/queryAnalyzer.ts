/**
 * Query analyzer utility for detecting table references
 *
 * The engine selection logic:
 * 1. Each query box has an associated connection (BigQuery, DuckDB, ClickHouse, etc.)
 * 2. The connection type determines the default execution engine
 * 3. If the query references a local DuckDB table, it overrides to DuckDB
 *    (since query results from all connections are stored in DuckDB)
 */

import type { ConnectionType } from '../types/connection'
import type { Box } from '../types/canvas'
import { isLocalConnectionType } from './connectionHelpers'
import { sanitizeTableName } from './sqlSanitize'
import { sqlKeywordSet } from './sqlDialects'

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
 * Determine the effective engine for a query based on connection and table references.
 *
 * Same-connection chaining: if a query references another box on the same remote
 * connection, those references will be inlined as CTEs (handled by cteResolver).
 * Only cross-connection DuckDB table references force a switch to DuckDB.
 *
 * @param connectionType - The connection type from the box's assigned connection
 * @param query - The SQL query text
 * @param duckDBTables - List of available DuckDB table names
 * @param currentConnectionId - The box's connection ID (for same-connection detection)
 * @param canvasBoxes - All canvas boxes (for same-connection detection)
 * @returns The connection type to use for execution
 */
export function getEffectiveEngine(
  connectionType: ConnectionType | undefined,
  query: string,
  duckDBTables: string[],
  currentConnectionId?: string,
  canvasBoxes?: Box[],
): ConnectionType {
  // No connection or DuckDB connection → always DuckDB
  if (!connectionType || isLocalConnectionType(connectionType)) {
    // Still need to check DuckDB table refs for the isLocal case
    return 'duckdb'
  }

  // If we have canvas context, use same-connection awareness
  if (currentConnectionId && canvasBoxes) {
    const tableRefs = extractTableReferences(query)
    const unqualifiedRefs = tableRefs.filter(r => !r.includes('.'))

    for (const ref of unqualifiedRefs) {
      const tableName = ref.replace(/`/g, '').toLowerCase()

      // Check if this is a same-connection box reference
      const matchingBox = canvasBoxes.find(
        b => sanitizeTableName(b.name) === tableName && b.type === 'sql',
      )

      if (matchingBox && matchingBox.connectionId === currentConnectionId) {
        continue // same-connection ref → will be inlined as CTE
      }

      // Not a same-connection box ref — if it's a DuckDB table, force DuckDB
      if (duckDBTables.includes(tableName)) {
        return 'duckdb'
      }
    }

    // All refs are either same-connection or remote schema refs → stay on remote engine
    return connectionType
  }

  // Legacy path: no canvas context, use original behavior
  if (referencesLocalDuckDBTable(query, duckDBTables)) {
    return 'duckdb'
  }

  return connectionType
}

/**
 * Extract the SQL statement containing the given cursor position.
 * Splits on semicolons (outside of quotes) and returns the relevant fragment.
 */
export function extractCurrentStatement(doc: string, cursorPos: number): string {
  // Simple semicolon split — good enough for statement isolation.
  // Doesn't handle semicolons inside string literals, but those are rare
  // in the FROM/JOIN clauses we care about.
  let start = doc.lastIndexOf(';', cursorPos - 1)
  start = start === -1 ? 0 : start + 1
  let end = doc.indexOf(';', cursorPos)
  end = end === -1 ? doc.length : end
  return doc.slice(start, end)
}

/**
 * Extract table alias mappings from a SQL string.
 * Returns a Map from lowercase alias to the original table name (cleaned of quotes).
 * Handles: FROM/JOIN table alias, FROM/JOIN table AS alias.
 */
export function extractAliases(query: string): Map<string, string> {
  const aliases = new Map<string, string>()

  // Match: FROM/JOIN + table reference + optional AS + alias
  // Table ref can be: `backtick.quoted`, "double"."quoted", or unquoted.path
  // Note: comma is intentionally excluded — commas in SELECT lists (e.g. ", col FROM")
  // cause false matches that consume the FROM keyword and break real alias detection.
  const pattern = /(?:FROM|JOIN)\s+(`[^`]+`|"[^"]+(?:"\s*\.\s*"[^"]+)*"|[\w][\w.-]*)\s+(?:AS\s+)?(\w+)/gi

  let match
  while ((match = pattern.exec(query)) !== null) {
    const tableRef = match[1]
    const alias = match[2]

    if (!alias || sqlKeywordSet.has(alias.toLowerCase())) continue

    // Clean up table name (remove backticks/double quotes)
    let cleanTable: string
    if (tableRef.startsWith('`') && tableRef.endsWith('`')) {
      cleanTable = tableRef.slice(1, -1)
    } else if (tableRef.includes('"')) {
      cleanTable = tableRef.replace(/"/g, '').replace(/\s*\.\s*/g, '.')
    } else {
      cleanTable = tableRef
    }

    aliases.set(alias.toLowerCase(), cleanTable)
  }

  return aliases
}

// Re-export for convenience
export { isLocalConnectionType }
