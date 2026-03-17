/**
 * CTE layout utilities.
 *
 * Parsing is delegated to SQLGlot (see sqlglot store / worker).
 * This module owns the layout algorithm and shared types only.
 */

export interface ParsedCTE {
  /** CTE name as written in the query (case-preserved) */
  name: string
  /** The SELECT body inside the CTE parentheses */
  body: string
  /** Names of other CTEs referenced in this body */
  referencedCTEs: string[]
}

export interface ExplodedQuery {
  ctes: ParsedCTE[]
  /** The final SELECT after the WITH block */
  finalQuery: string
}

export interface ExplodeLayoutItem {
  name: string
  query: string
  x: number
  y: number
}

export interface ExplodeLayout {
  items: ExplodeLayoutItem[]
}

// ---------------------------------------------------------------------------
// Quick check (no SQLGlot needed)
// ---------------------------------------------------------------------------

/** Fast heuristic: does this SQL start with a WITH clause? */
export function hasCTEs(sql: string): boolean {
  // Strip leading whitespace, line comments (--), and block comments (/* */)
  const stripped = sql.replace(/^\s*(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/g, '')
  return /^\s*with\s+/i.test(stripped)
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Compute canvas positions for the exploded boxes.
 *
 * Columns run left-to-right by CTE dependency depth:
 *   level 0 = root CTEs (no CTE deps)
 *   level N = CTEs whose deepest dependency is at level N-1
 *   last column = final query
 *
 * Boxes within a column are stacked vertically, centred on the original box's Y midpoint.
 */
export function computeExplodeLayout(
  exploded: ExplodedQuery,
  originalBoxName: string,
  startX: number,
  startY: number,
  origHeight: number,
  boxWidth = 600,
  boxHeight = 500,
  hGap = 80,
  vGap = 60,
): ExplodeLayout {
  const { ctes, finalQuery } = exploded

  const levelMap = computeLevels(ctes)
  const maxCTELevel = ctes.length > 0 ? Math.max(...levelMap.values()) : -1
  const finalLevel = maxCTELevel + 1

  // Group CTEs by level (preserving original CTE order within each level)
  const byLevel = new Map<number, ParsedCTE[]>()
  for (const cte of ctes) {
    const level = levelMap.get(cte.name) ?? 0
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level)!.push(cte)
  }

  const centerY = startY + origHeight / 2
  const items: ExplodeLayoutItem[] = []

  for (const [level, levelCTEs] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const totalH = levelCTEs.length * boxHeight + (levelCTEs.length - 1) * vGap
    const colX = startX + level * (boxWidth + hGap)
    const colStartY = centerY - totalH / 2

    levelCTEs.forEach((cte, idx) => {
      items.push({
        name: cte.name,
        query: cte.body,
        x: colX,
        y: colStartY + idx * (boxHeight + vGap),
      })
    })
  }

  // Final query box — rightmost column, vertically centred
  if (finalQuery) {
    items.push({
      name: originalBoxName,
      query: finalQuery,
      x: startX + finalLevel * (boxWidth + hGap),
      y: centerY - boxHeight / 2,
    })
  }

  return { items }
}

// ---------------------------------------------------------------------------
// Internal: topological level assignment
// ---------------------------------------------------------------------------

function computeLevels(ctes: ParsedCTE[]): Map<string, number> {
  const levelMap = new Map<string, number>()
  const cteByNameLower = new Map(ctes.map(c => [c.name.toLowerCase(), c]))

  const getLevel = (nameLower: string, visiting = new Set<string>()): number => {
    if (levelMap.has(nameLower)) return levelMap.get(nameLower)!
    if (visiting.has(nameLower)) return 0 // cycle → treat as root

    const cte = cteByNameLower.get(nameLower)
    if (!cte || cte.referencedCTEs.length === 0) {
      levelMap.set(nameLower, 0)
      return 0
    }

    visiting.add(nameLower)
    const maxDep = Math.max(
      ...cte.referencedCTEs.map(dep => getLevel(dep.toLowerCase(), new Set(visiting)))
    )
    const level = maxDep + 1
    levelMap.set(nameLower, level)
    return level
  }

  for (const cte of ctes) {
    getLevel(cte.name.toLowerCase())
  }

  // Return map keyed by original-case names
  const result = new Map<string, number>()
  for (const cte of ctes) {
    result.set(cte.name, levelMap.get(cte.name.toLowerCase()) ?? 0)
  }
  return result
}
