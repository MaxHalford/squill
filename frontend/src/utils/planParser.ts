/**
 * Common query execution plan representation and per-engine parsers.
 *
 * Each engine's EXPLAIN JSON is normalized into a uniform PlanNode tree
 * so the visualization component can render any engine identically.
 */

export interface PlanNode {
  id: number
  operator: string
  table?: string
  rows?: number
  /** Real execution time in milliseconds (PG Actual Total Time, BQ stage duration) */
  durationMs?: number
  /** Abstract planner cost units (PG Total Cost, DuckDB Cost) */
  cost?: number
  /** Bytes shuffled (BigQuery stages) */
  shuffleBytes?: number
  extra: Record<string, string>
  children: PlanNode[]
}

let nextNodeId = 0

// ---------------------------------------------------------------------------
// DuckDB — EXPLAIN (FORMAT json)
// Structure: [{ name, children[], extra_info: { ... } }]
// ---------------------------------------------------------------------------

interface DuckDBNode {
  // Regular EXPLAIN fields
  name?: string
  // EXPLAIN ANALYZE fields
  operator_type?: string
  operator_timing?: number
  operator_cardinality?: number
  // Common fields
  children?: DuckDBNode[]
  extra_info?: Record<string, string>
  timing?: number
  cardinality?: number
}

function parseDuckDBNode(raw: DuckDBNode): PlanNode {
  const extra: Record<string, string> = {}
  let rows: number | undefined
  let cost: number | undefined
  let durationMs: number | undefined

  // EXPLAIN ANALYZE provides actual timing (seconds) and cardinality
  const timing = raw.operator_timing ?? raw.timing
  const cardinality = raw.operator_cardinality ?? raw.cardinality
  if (timing !== undefined) {
    durationMs = timing * 1000
  }
  if (cardinality !== undefined) {
    rows = cardinality
  }

  if (raw.extra_info) {
    for (const [k, v] of Object.entries(raw.extra_info)) {
      if (k === 'Estimated Cardinality') {
        // Only use estimated if we don't have actual cardinality
        if (rows === undefined) rows = Number(v) || undefined
      } else if (k === 'Cost') {
        cost = Number(v) || undefined
      } else {
        extra[k] = String(v)
      }
    }
  }

  return {
    id: nextNodeId++,
    operator: raw.operator_type || raw.name || 'Unknown',
    rows,
    durationMs,
    cost,
    table: extra['Table'] || extra['table'] || undefined,
    extra,
    children: (raw.children || []).map(parseDuckDBNode),
  }
}

function parseDuckDBPlan(raw: unknown): PlanNode | null {
  if (!raw) return null
  // EXPLAIN (FORMAT json) returns an array with one root node
  const root = Array.isArray(raw) ? raw[0] : raw
  if (!root || typeof root !== 'object') return null

  const node = root as DuckDBNode
  // EXPLAIN ANALYZE wraps the plan in: virtual root (no operator_type) → EXPLAIN_ANALYZE → actual plan
  // Skip these wrapper levels to get the real plan tree
  if (!node.operator_type && !node.name && node.children?.length === 1) {
    const wrapper = node.children[0]
    if (wrapper.operator_type === 'EXPLAIN_ANALYZE' && wrapper.children?.length) {
      // May have one or multiple children under the EXPLAIN_ANALYZE wrapper
      if (wrapper.children.length === 1) {
        return parseDuckDBNode(wrapper.children[0])
      }
      // Multiple roots — wrap in a virtual node
      return {
        id: nextNodeId++,
        operator: 'Query',
        extra: {},
        children: wrapper.children.map(parseDuckDBNode),
      }
    }
  }

  return parseDuckDBNode(node)
}

// ---------------------------------------------------------------------------
// PostgreSQL — EXPLAIN (FORMAT JSON)
// Structure: [{ "Plan": { "Node Type", "Plans": [...], ... } }]
// ---------------------------------------------------------------------------

interface PGPlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Alias'?: string
  'Plan Rows'?: number
  'Actual Rows'?: number
  'Total Cost'?: number
  'Startup Cost'?: number
  'Actual Total Time'?: number
  'Plan Width'?: number
  'Join Type'?: string
  'Index Name'?: string
  Plans?: PGPlanNode[]
  [key: string]: unknown
}

// Keys we already handle structurally — skip them in extra
const PG_STRUCTURAL_KEYS = new Set([
  'Node Type', 'Relation Name', 'Alias', 'Plan Rows', 'Actual Rows',
  'Total Cost', 'Startup Cost', 'Actual Total Time', 'Plan Width', 'Plans',
])

function parsePGNode(raw: PGPlanNode): PlanNode {
  const extra: Record<string, string> = {}

  for (const [k, v] of Object.entries(raw)) {
    if (!PG_STRUCTURAL_KEYS.has(k) && v !== undefined && v !== null) {
      extra[k] = String(v)
    }
  }

  return {
    id: nextNodeId++,
    operator: raw['Node Type'] || 'Unknown',
    table: raw['Relation Name'],
    rows: raw['Actual Rows'] ?? raw['Plan Rows'],
    durationMs: raw['Actual Total Time'],
    cost: raw['Total Cost'],
    extra,
    children: (raw.Plans || []).map(parsePGNode),
  }
}

function parsePostgresPlan(raw: unknown): PlanNode | null {
  if (!raw) return null
  // PG returns [{ Plan: { ... } }]
  const arr = Array.isArray(raw) ? raw : [raw]
  const first = arr[0]
  const planObj = first?.Plan ?? first?.plan ?? first
  if (!planObj || typeof planObj !== 'object') return null
  return parsePGNode(planObj as PGPlanNode)
}

// ---------------------------------------------------------------------------
// BigQuery — statistics.query.queryPlan from jobs.get
// Structure: flat array of stages with inputStages DAG references
// ---------------------------------------------------------------------------

interface BQStage {
  name: string
  id: string
  inputStages?: string[]
  recordsRead?: string
  recordsWritten?: string
  startMs?: string
  endMs?: string
  status?: string
  waitRatioAvg?: number
  readRatioAvg?: number
  computeRatioAvg?: number
  writeRatioAvg?: number
  shuffleOutputBytes?: string
  steps?: Array<{ kind: string; substeps?: string[] }>
}

function parseBQStage(stage: BQStage): PlanNode {
  const extra: Record<string, string> = {}

  if (stage.status) extra['Status'] = stage.status
  if (stage.recordsWritten) extra['Records Written'] = String(stage.recordsWritten)

  if (stage.steps && stage.steps.length > 0) {
    extra['Steps'] = stage.steps
      .map(s => `${s.kind}${s.substeps ? ': ' + s.substeps.join(', ') : ''}`)
      .join('\n')
  }

  const startMs = stage.startMs ? Number(stage.startMs) : undefined
  const endMs = stage.endMs ? Number(stage.endMs) : undefined
  const durationMs = startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined

  return {
    id: nextNodeId++,
    operator: stage.name || `Stage ${stage.id}`,
    rows: stage.recordsRead ? Number(stage.recordsRead) : undefined,
    durationMs,
    shuffleBytes: stage.shuffleOutputBytes ? Number(stage.shuffleOutputBytes) : undefined,
    extra,
    children: [], // filled in by tree reconstruction
  }
}

function parseBigQueryPlan(raw: unknown): PlanNode | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  const stages = raw as BQStage[]
  const nodeMap = new Map<string, PlanNode>()
  const childIds = new Set<string>()

  // Create nodes
  for (const stage of stages) {
    nodeMap.set(stage.id, parseBQStage(stage))
  }

  // Build tree from inputStages (parent → children)
  for (const stage of stages) {
    const node = nodeMap.get(stage.id)!
    if (stage.inputStages) {
      for (const inputId of stage.inputStages) {
        const child = nodeMap.get(inputId)
        if (child) {
          node.children.push(child)
          childIds.add(inputId)
        }
      }
    }
  }

  // Root nodes = stages that are not a child of anyone
  const roots = stages
    .filter(s => !childIds.has(s.id))
    .map(s => nodeMap.get(s.id)!)

  if (roots.length === 0) return null
  if (roots.length === 1) return roots[0]

  // Multiple roots → wrap in a virtual root
  return {
    id: nextNodeId++,
    operator: 'Query',
    extra: {},
    children: roots,
  }
}

// ---------------------------------------------------------------------------
// Snowflake — EXPLAIN USING JSON
// Structure similar to DuckDB: tree with operation/expressions
// ---------------------------------------------------------------------------

interface SnowflakeNode {
  operation?: string
  expressions?: string[]
  globalStats?: Record<string, unknown>
  id?: number
  inputs?: SnowflakeNode[]
  [key: string]: unknown
}

function parseSnowflakeNode(raw: SnowflakeNode): PlanNode {
  const extra: Record<string, string> = {}

  if (raw.expressions && raw.expressions.length > 0) {
    extra['Expressions'] = raw.expressions.join(', ')
  }
  if (raw.globalStats) {
    for (const [k, v] of Object.entries(raw.globalStats)) {
      if (v !== undefined && v !== null) extra[k] = String(v)
    }
  }

  return {
    id: nextNodeId++,
    operator: raw.operation || 'Unknown',
    extra,
    children: (raw.inputs || []).map(parseSnowflakeNode),
  }
}

function parseSnowflakePlan(raw: unknown): PlanNode | null {
  if (!raw) return null
  // Snowflake may return an array or a single object
  const arr = Array.isArray(raw) ? raw : [raw]
  if (arr.length === 0) return null
  return parseSnowflakeNode(arr[0] as SnowflakeNode)
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function parsePlan(engine: string, raw: unknown): PlanNode | null {
  try {
    switch (engine) {
      case 'duckdb': return parseDuckDBPlan(raw)
      case 'postgres': return parsePostgresPlan(raw)
      case 'bigquery': return parseBigQueryPlan(raw)
      case 'snowflake': return parseSnowflakePlan(raw)
      default: return null
    }
  } catch (err) {
    console.warn(`Failed to parse ${engine} plan:`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Ranking — find top 3 slowest/costliest nodes
// Uses durationMs when available, falls back to cost
// ---------------------------------------------------------------------------

function nodeWeight(n: PlanNode): number {
  if (n.durationMs !== undefined && n.durationMs > 0) return n.durationMs
  if (n.cost !== undefined && n.cost > 0) return n.cost
  return 0
}

export function rankNodesByCost(root: PlanNode): Map<PlanNode, number> {
  const all: PlanNode[] = []
  const collect = (node: PlanNode) => {
    all.push(node)
    node.children.forEach(collect)
  }
  collect(root)

  const withWeight = all.filter(n => nodeWeight(n) > 0)
  withWeight.sort((a, b) => nodeWeight(b) - nodeWeight(a))

  const ranks = new Map<PlanNode, number>()
  for (let i = 0; i < Math.min(3, withWeight.length); i++) {
    ranks.set(withWeight[i], i + 1)
  }
  return ranks
}
