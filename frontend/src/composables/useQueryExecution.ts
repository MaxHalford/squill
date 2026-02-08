/**
 * Shared query execution logic.
 *
 * Encapsulates the "detect engine → dispatch to store → store in DuckDB"
 * pattern used by both SqlBox and ChatBox. Adding a new database engine
 * only requires updating this single file.
 */

import type { DatabaseEngine } from '../types/database'
import type { ConnectionType } from '../types/connection'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useBigQueryStore } from '../stores/bigquery'
import { useSnowflakeStore } from '../stores/snowflake'
import { cleanQueryForExecution } from '../utils/sqlSanitize'
import { getEffectiveEngine, isLocalConnectionType } from '../utils/queryAnalyzer'

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
  const postgresStore = usePostgresStore()
  const bigqueryStore = useBigQueryStore()
  const snowflakeStore = useSnowflakeStore()

  /**
   * Execute a SQL query on the appropriate engine and store results in DuckDB.
   *
   * Handles engine detection (DuckDB vs remote), query sanitization, timing,
   * and result storage. Callers handle their own UI state, pagination, etc.
   */
  async function executeQuery(
    query: string,
    tableName: string,
    connectionType?: ConnectionType | string,
    connectionId?: string,
    options?: { boxId?: number },
  ): Promise<QueryExecutionResult> {
    const cleanedQuery = cleanQueryForExecution(query)

    const availableTables = await duckdbStore.getFreshTableNames()
    const engine = getEffectiveEngine(connectionType as ConnectionType | undefined, cleanedQuery, availableTables) as DatabaseEngine

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
      const result = await bigqueryStore.runQuery(cleanedQuery, null, connectionId)
      await duckdbStore.storeResults(tableName, result.rows as Record<string, unknown>[], options?.boxId, result.schema, 'bigquery')
      rowCount = result.rows.length
      columns = result.schema?.map((c: { name: string }) => c.name) || []
      engineStats = result.stats
    } else if (engine === 'postgres') {
      if (!connectionId) throw new Error('No PostgreSQL connection')
      const result = await postgresStore.runQuery(connectionId, cleanedQuery)
      await duckdbStore.storeResults(tableName, result.rows as Record<string, unknown>[], options?.boxId)
      rowCount = result.rows.length
      columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : []
    } else if (engine === 'snowflake') {
      if (!connectionId) throw new Error('No Snowflake connection')
      const result = await snowflakeStore.runQuery(connectionId, cleanedQuery)
      await duckdbStore.storeResults(tableName, result.rows as Record<string, unknown>[], options?.boxId)
      rowCount = result.rows.length
      columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : []
    } else {
      throw new Error(`Unsupported engine: ${engine}`)
    }

    const executionTimeMs = Math.round(performance.now() - startTime)

    return { tableName, rowCount, columns, executionTimeMs, engine, stats: engineStats }
  }

  return { executeQuery }
}
