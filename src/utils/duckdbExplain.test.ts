import { describe, expect, it, vi } from 'vitest'
import { explainDuckDBQuery } from './duckdbExplain'

describe('explainDuckDBQuery', () => {
  it('falls back to a physical plan when DuckDB returns an analyzer error payload', async () => {
    const physicalPlan = [{ name: 'COLUMN_DATA_SCAN', children: [], extra_info: {} }]
    const runQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ explain_key: 'analyzed_plan', explain_value: '{"result":"error"}' }] })
      .mockResolvedValueOnce({ rows: [{ explain_key: 'physical_plan', explain_value: JSON.stringify(physicalPlan) }] })

    await expect(explainDuckDBQuery('SELECT * FROM (VALUES (1),(2)) t(x)', runQuery))
      .resolves.toEqual(physicalPlan)
    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery.mock.calls[1][0]).toMatch(/^EXPLAIN \(FORMAT JSON\)/)
  })

  it('keeps a valid analyzed plan', async () => {
    const analyzedPlan = { children: [{ operator_type: 'EXPLAIN_ANALYZE', children: [{ operator_type: 'TABLE_SCAN', children: [] }] }] }
    const runQuery = vi.fn().mockResolvedValue({ rows: [{ explain_value: JSON.stringify(analyzedPlan) }] })

    await expect(explainDuckDBQuery('SELECT * FROM range(10)', runQuery)).resolves.toEqual(analyzedPlan)
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
})
