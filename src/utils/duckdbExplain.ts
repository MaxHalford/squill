import { parsePlan } from './planParser'

type QueryRunner = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>

async function queryPlan(sql: string, runQuery: QueryRunner): Promise<unknown> {
  const { rows } = await runQuery(sql)
  const value = rows[0]?.explain_value
  if (typeof value !== 'string') throw new Error('DuckDB returned no JSON plan')

  const plan: unknown = JSON.parse(value)
  if (!parsePlan('duckdb', plan)) throw new Error('DuckDB returned an invalid plan')
  return plan
}

export async function explainDuckDBQuery(query: string, runQuery: QueryRunner): Promise<unknown> {
  try {
    return await queryPlan(`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`, runQuery)
  } catch {
    // Some valid queries return { "result": "error" } from DuckDB's analyzer.
    return queryPlan(`EXPLAIN (FORMAT JSON) ${query}`, runQuery)
  }
}
