/**
 * Shared query execution logic.
 *
 * Encapsulates the "detect engine → dispatch to store → store in DuckDB"
 * pattern used by SqlBox and other box types.
 */

import type { DatabaseEngine } from '../types/database'
import type { ConnectionType } from '../types/connection'
import { useDuckDBStore } from '../stores/duckdb'
import { useBigQueryStore } from '../stores/bigquery'
import { useCanvasStore } from '../stores/canvas'
import { cleanQueryForExecution } from '../utils/sqlSanitize'
import { getEffectiveEngine, isLocalConnectionType } from '../utils/queryAnalyzer'
import { buildCTEQuery } from '../utils/cteResolver'

export interface QueryExecutionResult {
  tableName: string
  rowCount: number
  columns: string[]
  executionTimeMs: number
  engine: DatabaseEngine
  stats?: { totalBytesProcessed?: string; cacheHit?: boolean }
}

export function useQueryExecution() {
  const duckdbStore = useDuckDBStore()
  const bigqueryStore = useBigQueryStore()
  const canvasStore = useCanvasStore()

  /**
   * Execute a SQL query on the appropriate engine and store results in DuckDB.
   *
   * For remote engines, same-connection box references are inlined as CTEs
   * so the query runs entirely on the remote database.
   */
  async function executeQuery(
    query: string,
    tableName: string,
    connectionType?: ConnectionType,
    connectionId?: string,
    options?: { boxId?: number },
  ): Promise<QueryExecutionResult> {
    const cleanedQuery = cleanQueryForExecution(query)

    const availableTables = await duckdbStore.getFreshTableNames()
    const engine = getEffectiveEngine(
      connectionType,
      cleanedQuery,
      availableTables,
      connectionId,
      canvasStore.boxes,
    ) as DatabaseEngine

    // For remote engines, assemble CTE-wrapped query from same-connection upstream boxes
    let finalQuery = cleanedQuery
    if (!isLocalConnectionType(engine) && options?.boxId) {
      const cteResult = buildCTEQuery(cleanedQuery, options.boxId, connectionId, canvasStore.boxes, availableTables)
      finalQuery = cteResult.assembledQuery
    }

    const startTime = performance.now()
    let rowCount = 0
    let columns: string[] = []
    let engineStats: QueryExecutionResult['stats']

    if (isLocalConnectionType(engine)) {
      const result = await duckdbStore.runQueryWithStorage(cleanedQuery, tableName, options?.boxId)
      rowCount = result.stats.rowCount ?? 0
      columns = result.columns || []
    } else if (engine === 'bigquery') {
      if (!connectionId) throw new Error('No BigQuery connection')
      const result = await bigqueryStore.runQuery(finalQuery, null, connectionId)
      await duckdbStore.storeResults(tableName, result.rows as Record<string, unknown>[], options?.boxId, result.schema, 'bigquery')
      rowCount = result.rows.length
      columns = result.schema?.map((c: { name: string }) => c.name) || []
      engineStats = result.stats
    } else {
      throw new Error(`Unsupported engine: ${engine}`)
    }

    const executionTimeMs = Math.round(performance.now() - startTime)

    return { tableName, rowCount, columns, executionTimeMs, engine, stats: engineStats }
  }

  return { executeQuery }
}
