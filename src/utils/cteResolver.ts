/**
 * CTE resolver for same-connection query chaining.
 *
 * When two boxes share the same remote connection, upstream box queries
 * are inlined as CTEs instead of being routed through DuckDB. This allows
 * exploded CTE boxes to round-trip back into a single remote query.
 */

import type { Box } from '../types/canvas'
import { sanitizeTableName } from './sqlSanitize'
import { extractTableReferences } from './queryAnalyzer'

export interface BoxReference {
  tableName: string
  boxId: number
  box: Box
}

export interface ClassifiedReferences {
  /** Boxes on the same remote connection — will be inlined as CTEs */
  sameConnection: BoxReference[]
  /** Boxes on a different connection or DuckDB tables — require DuckDB */
  crossConnection: string[]
}

/**
 * Classify unqualified table references in a query as same-connection
 * (can be inlined as CTEs) or cross-connection (require DuckDB).
 */
export function classifyReferences(
  query: string,
  currentConnectionId: string | undefined,
  currentBoxId: number,
  canvasBoxes: Box[],
  duckDBTables: string[],
): ClassifiedReferences {
  const tableRefs = extractTableReferences(query)
  const sameConnection: BoxReference[] = []
  const crossConnection: string[] = []

  for (const ref of tableRefs) {
    // Qualified names (schema.table) are remote schema references, not box refs
    if (ref.includes('.')) continue

    const tableName = ref.replace(/`/g, '').toLowerCase()

    // Try to find a canvas box with this name
    const matchingBox = canvasBoxes.find(
      b => b.id !== currentBoxId && sanitizeTableName(b.name) === tableName && b.type === 'sql',
    )

    if (matchingBox && currentConnectionId && matchingBox.connectionId === currentConnectionId) {
      sameConnection.push({ tableName, boxId: matchingBox.id, box: matchingBox })
    } else if (duckDBTables.includes(tableName)) {
      crossConnection.push(tableName)
    }
  }

  return { sameConnection, crossConnection }
}

interface CollectedCTE {
  name: string
  query: string
  /** Dependency depth — 0 = leaf, higher = depends on lower */
  depth: number
}

/**
 * Build a CTE-wrapped query by recursively inlining same-connection
 * upstream box queries.
 *
 * Returns the original query unchanged if there are no same-connection
 * references to inline.
 */
export function buildCTEQuery(
  query: string,
  currentBoxId: number,
  connectionId: string | undefined,
  canvasBoxes: Box[],
  duckDBTables: string[],
): { assembledQuery: string; inlinedBoxIds: number[] } {
  if (!connectionId) {
    return { assembledQuery: query, inlinedBoxIds: [] }
  }

  // First check: if there are ANY cross-connection refs, bail out entirely.
  // The caller (getEffectiveEngine) should have already routed to DuckDB,
  // but this is a safety net.
  const classified = classifyReferences(query, connectionId, currentBoxId, canvasBoxes, duckDBTables)
  if (classified.crossConnection.length > 0 || classified.sameConnection.length === 0) {
    return { assembledQuery: query, inlinedBoxIds: [] }
  }

  // Recursively collect all upstream CTEs
  const collected = new Map<string, CollectedCTE>()
  const visiting = new Set<number>()

  const collect = (boxId: number, depth: number): void => {
    if (visiting.has(boxId)) return // cycle
    visiting.add(boxId)

    const box = canvasBoxes.find(b => b.id === boxId)
    if (!box || !box.query?.trim() || box.connectionId !== connectionId) {
      visiting.delete(boxId)
      return
    }

    const tableName = sanitizeTableName(box.name)

    // Recurse into this box's same-connection references first
    const upstreamRefs = classifyReferences(box.query, connectionId, boxId, canvasBoxes, duckDBTables)

    // If the upstream box has cross-connection refs, we can't inline it
    if (upstreamRefs.crossConnection.length > 0) {
      visiting.delete(boxId)
      return
    }

    for (const ref of upstreamRefs.sameConnection) {
      collect(ref.boxId, depth + 1)
    }

    // Update depth to be the max seen (ensures topological ordering)
    const existing = collected.get(tableName)
    if (!existing || depth > existing.depth) {
      collected.set(tableName, { name: tableName, query: box.query.trim(), depth })
    }

    visiting.delete(boxId)
  }

  // Seed from the current query's direct same-connection references
  for (const ref of classified.sameConnection) {
    collect(ref.boxId, 0)
  }

  if (collected.size === 0) {
    return { assembledQuery: query, inlinedBoxIds: [] }
  }

  // Sort by depth descending (deepest dependencies first = leaf CTEs first)
  const sorted = [...collected.values()].sort((a, b) => b.depth - a.depth)

  const cteParts = sorted.map(cte => `${cte.name} AS (\n${cte.query}\n)`)

  // If the original query already starts with WITH, merge the CTE blocks
  // to avoid invalid `WITH ... WITH ...` syntax
  let assembledQuery: string
  const withMatch = query.match(/^\s*WITH\s+/i)
  if (withMatch) {
    // Strip the leading WITH and prepend our CTEs
    const queryWithoutWith = query.slice(withMatch[0].length)
    assembledQuery = `WITH ${cteParts.join(',\n')},\n${queryWithoutWith}`
  } else {
    assembledQuery = `WITH ${cteParts.join(',\n')}\n${query}`
  }

  const inlinedBoxIds = sorted
    .map(cte => {
      const box = canvasBoxes.find(b => sanitizeTableName(b.name) === cte.name && b.connectionId === connectionId)
      return box?.id
    })
    .filter((id): id is number => id !== undefined)

  return { assembledQuery, inlinedBoxIds }
}
