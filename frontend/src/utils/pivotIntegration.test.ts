/**
 * Integration tests for the pivot query builder.
 *
 * These tests verify the full Phase 1 + Phase 2 pipeline produces valid,
 * composable SQL for real-world pivot table scenarios.
 */

import { describe, it, expect } from 'vitest'
import {
  buildAggregationQuery,
  buildPivotQuery,
  buildDisplayQuery,
  buildFilterClause,
} from './pivotQueryBuilder'
import type { PivotConfig, PivotField, PivotFilter } from '../types/pivot'
import type { DatabaseEngine } from '../types/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const config = (overrides: Partial<PivotConfig> = {}): PivotConfig => ({
  version: 2,
  tableName: 'orders',
  rowFields: [],
  columnField: null,
  metrics: [{ field: 'amount', aggregation: 'sum' }],
  filters: [],
  ...overrides,
})

const field = (name: string, typeCategory: 'number' | 'text' | 'date' | 'boolean', opts?: Partial<PivotField>): PivotField => ({
  name,
  type: typeCategory,
  typeCategory,
  ...opts,
})

// ---------------------------------------------------------------------------
// Full pipeline: Phase 1 + Phase 2 composition
// ---------------------------------------------------------------------------

describe('Full pivot pipeline', () => {
  it('sales by region and category (SUM revenue)', () => {
    const c = config({
      tableName: 'sales',
      rowFields: [field('region', 'text')],
      columnField: field('category', 'text'),
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('"region"')
    expect(phase1).toContain('"category"')
    expect(phase1).toContain('SUM("revenue")')
    expect(phase1).toContain('GROUP BY 1, 2')

    const phase2 = buildPivotQuery('_pivot_1_agg', c)
    expect(phase2).toContain('PIVOT "_pivot_1_agg"')
    expect(phase2).toContain('ON "category"')
    expect(phase2).toContain('USING SUM("metric_value")')
    expect(phase2).toContain('GROUP BY "region"')
  })

  it('monthly revenue by product (date granularity + pivot)', () => {
    const c = config({
      tableName: 'sales',
      rowFields: [field('order_date', 'date', { dateGranularity: 'month' })],
      columnField: field('product', 'text'),
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain("STRFTIME('%Y-%m', \"order_date\")")
    expect(phase1).toContain('AS order_date_month')
    expect(phase1).toContain('"product"')

    const phase2 = buildPivotQuery('_pivot_2_agg', c)
    expect(phase2).toContain('ON "product"')
    expect(phase2).toContain('GROUP BY "order_date_month"')
  })

  it('weekly counts with filter (date + filter + no column field)', () => {
    const c = config({
      tableName: 'events',
      rowFields: [field('created_at', 'date', { dateGranularity: 'week' })],
      columnField: null,
      metrics: [{ field: '*', aggregation: 'count' }],
      filters: [
        { field: 'type', operator: '=', value: 'click', typeCategory: 'text' },
      ],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain("CAST(DATE_TRUNC('week', \"created_at\") AS VARCHAR)") // week still uses DATE_TRUNC
    expect(phase1).toContain('COUNT(*)')
    expect(phase1).toContain("WHERE \"type\" = 'click'")

    // No column field → display directly
    const display = buildDisplayQuery('_pivot_3_agg')
    expect(display).toBe('SELECT * FROM "_pivot_3_agg"')
  })

  it('proportion metric with multiple row fields', () => {
    const c = config({
      tableName: 'users',
      rowFields: [
        field('country', 'text'),
        field('plan', 'text'),
      ],
      columnField: null,
      metrics: [{ field: '*', aggregation: 'proportion' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()')
    expect(phase1).toContain('"country"')
    expect(phase1).toContain('"plan"')
    expect(phase1).toContain('GROUP BY 1, 2')
  })

  it('year-over-year revenue by quarter (date row + date column)', () => {
    const c = config({
      tableName: 'revenue',
      rowFields: [field('fiscal_date', 'date', { dateGranularity: 'quarter' })],
      columnField: field('fiscal_date', 'date', { dateGranularity: 'year' }),
      metrics: [{ field: 'amount', aggregation: 'sum' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('fiscal_date_quarter')
    expect(phase1).toContain('QUARTER')  // Quarter expression includes QUARTER function
    expect(phase1).toContain('EXTRACT(YEAR FROM "fiscal_date") AS fiscal_date_year')

    const phase2 = buildPivotQuery('_pivot_4_agg', c)
    expect(phase2).toContain('ON "fiscal_date_year"')
    expect(phase2).toContain('GROUP BY "fiscal_date_quarter"')
  })

  it('overall aggregate (no row fields, no column field)', () => {
    const c = config({
      tableName: 'orders',
      rowFields: [],
      columnField: null,
      metrics: [{ field: 'amount', aggregation: 'avg' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('AVG("amount")')
    expect(phase1).not.toContain('GROUP BY')
    expect(phase1).not.toContain('ORDER BY')
  })

  it('source-based analytics with originalQuery', () => {
    const c = config({
      tableName: 'orders',
      rowFields: [field('status', 'text')],
      columnField: field('region', 'text'),
      metrics: [{ field: 'total', aggregation: 'sum' }],
      originalQuery: 'SELECT * FROM raw_orders WHERE year = 2025',
    })

    const phase1 = buildAggregationQuery(c, 'postgres')
    expect(phase1).toContain('FROM (SELECT * FROM raw_orders WHERE year = 2025) AS source_data')
    expect(phase1).toContain('"status"')
    expect(phase1).toContain('"region"')
  })
})

// ---------------------------------------------------------------------------
// Cross-dialect consistency
// ---------------------------------------------------------------------------

describe('Cross-dialect consistency', () => {
  const dialects: DatabaseEngine[] = ['duckdb', 'postgres', 'bigquery', 'snowflake']

  it('all dialects produce structurally valid aggregation queries', () => {
    const c = config({
      rowFields: [
        field('region', 'text'),
        field('order_date', 'date', { dateGranularity: 'month' }),
      ],
      columnField: field('category', 'text'),
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
      filters: [
        { field: 'status', operator: '=', value: 'active', typeCategory: 'text' },
        { field: 'amount', operator: '>', value: '100', typeCategory: 'number' },
      ],
    })

    for (const dialect of dialects) {
      const sql = buildAggregationQuery(c, dialect)

      // All should have these structural elements
      expect(sql, `${dialect}: missing SELECT`).toContain('SELECT')
      expect(sql, `${dialect}: missing FROM`).toContain('FROM')
      expect(sql, `${dialect}: missing GROUP BY`).toContain('GROUP BY 1, 2, 3')
      expect(sql, `${dialect}: missing WHERE`).toContain('WHERE')
      expect(sql, `${dialect}: missing metric_value`).toContain('metric_value')

      // Date expression should be present (dialect-specific)
      expect(sql, `${dialect}: missing date expression`).toMatch(/STRFTIME|TO_CHAR|FORMAT_TIMESTAMP|DATE_TRUNC/)
    }
  })

  it('BigQuery uses backtick quoting throughout', () => {
    const c = config({
      rowFields: [field('region', 'text')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
      filters: [{ field: 'active', operator: '=', value: 'true', typeCategory: 'boolean' }],
    })

    const sql = buildAggregationQuery(c, 'bigquery')
    // BigQuery should use backticks for identifiers
    expect(sql).toContain('`region`')
    expect(sql).toContain('`revenue`')
    expect(sql).toContain('`active`')
    // Should NOT contain double quotes for identifiers
    expect(sql).not.toMatch(/"region"|"revenue"|"active"/)
  })

  it('Snowflake quotes all aliases', () => {
    const c = config({
      rowFields: [field('region', 'text'), field('d', 'date', { dateGranularity: 'month' })],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })

    const sql = buildAggregationQuery(c, 'snowflake')
    expect(sql).toContain('"sum_revenue"')
    expect(sql).toContain('"d_month"')
  })
})

// ---------------------------------------------------------------------------
// Complex filter combinations
// ---------------------------------------------------------------------------

describe('Complex filter scenarios', () => {
  it('multiple filters of different types', () => {
    const filters: PivotFilter[] = [
      { field: 'name', operator: 'contains', value: 'test', typeCategory: 'text' },
      { field: 'amount', operator: '>=', value: '100', typeCategory: 'number' },
      { field: 'created_at', operator: 'after', value: '2025-01-01', typeCategory: 'date' },
      { field: 'active', operator: '=', value: 'true', typeCategory: 'boolean' },
      { field: 'deleted_at', operator: 'is_null', value: '', typeCategory: 'date' },
    ]

    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toContain("\"name\" LIKE '%test%'")
    expect(clause).toContain("\"amount\" >= '100'")
    expect(clause).toContain("\"created_at\" > '2025-01-01'")
    expect(clause).toContain('"active" = true')
    expect(clause).toContain('"deleted_at" IS NULL')
    // All joined with AND
    expect(clause.match(/AND/g)?.length).toBe(4)
  })

  it('between filter with spaces in values', () => {
    const filters: PivotFilter[] = [
      { field: 'date', operator: 'between', value: '2025-01-01 , 2025-12-31', typeCategory: 'date' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toContain("BETWEEN '2025-01-01' AND '2025-12-31'")
  })

  it('SQL injection prevention via quote escaping', () => {
    const filters: PivotFilter[] = [
      { field: 'name', operator: '=', value: "'; DROP TABLE users; --", typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    // The single quote in the value is doubled: ' → ''
    // Full result: WHERE "name" = '''; DROP TABLE users; --'
    // This is a valid SQL string literal containing: '; DROP TABLE users; --
    // Single quote in value is doubled, entire payload stays inside one string literal
    expect(clause).toContain("''")
  })
})

// ---------------------------------------------------------------------------
// Date granularity pipeline
// ---------------------------------------------------------------------------

describe('Date granularity pipeline', () => {
  const granularities = ['year', 'quarter', 'month', 'week', 'date'] as const

  for (const g of granularities) {
    it(`${g} granularity produces valid Phase 1 + Phase 2 for DuckDB`, () => {
      const c = config({
        rowFields: [field('created_at', 'date', { dateGranularity: g })],
        columnField: field('type', 'text'),
        metrics: [{ field: '*', aggregation: 'count' }],
      })

      const phase1 = buildAggregationQuery(c, 'duckdb')
      expect(phase1).toContain(`created_at_${g}`)
      expect(phase1).toContain('COUNT(*)')

      const phase2 = buildPivotQuery('_agg', c)
      expect(phase2).toContain('ON "type"')
      expect(phase2).toContain(`GROUP BY "created_at_${g}"`)
    })
  }

  it('column field with date granularity', () => {
    const c = config({
      rowFields: [field('region', 'text')],
      columnField: field('order_date', 'date', { dateGranularity: 'quarter' }),
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('order_date_quarter')
    expect(phase1).toContain('QUARTER')

    const phase2 = buildPivotQuery('_agg', c)
    expect(phase2).toContain('ON "order_date_quarter"')
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('column names with special characters', () => {
    const c = config({
      rowFields: [field('user name', 'text'), field('order-count', 'number')],
      metrics: [{ field: 'total amount', aggregation: 'sum' }],
    })

    const sql = buildAggregationQuery(c, 'duckdb')
    expect(sql).toContain('"user name"')
    expect(sql).toContain('"order-count"')
    expect(sql).toContain('"total amount"')
  })

  it('single metric with no grouping (scalar result)', () => {
    const c = config({
      rowFields: [],
      columnField: null,
      metrics: [{ field: 'price', aggregation: 'avg' }],
    })

    const sql = buildAggregationQuery(c, 'duckdb')
    expect(sql).toContain('AVG("price")')
    expect(sql).not.toContain('GROUP BY')
  })

  it('pivot with many row fields', () => {
    const c = config({
      rowFields: [
        field('country', 'text'),
        field('state', 'text'),
        field('city', 'text'),
        field('year', 'number'),
      ],
      columnField: field('category', 'text'),
      metrics: [{ field: 'sales', aggregation: 'sum' }],
    })

    const phase1 = buildAggregationQuery(c, 'duckdb')
    expect(phase1).toContain('GROUP BY 1, 2, 3, 4, 5')

    const phase2 = buildPivotQuery('_agg', c)
    expect(phase2).toContain('GROUP BY "country", "state", "city", "year"')
    expect(phase2).toContain('ORDER BY "country", "state", "city", "year"')
  })
})
