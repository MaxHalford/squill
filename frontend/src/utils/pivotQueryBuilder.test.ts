import { describe, it, expect } from 'vitest'
import {
  buildAggregationQuery,
  buildPivotQuery,
  buildDisplayQuery,
  buildFilterClause,
  buildDateExpression,
  buildFieldExpression,
  quoteIdentifier,
  quoteAlias,
  buildFromClause,
} from './pivotQueryBuilder'
import type { DatabaseEngine } from '../types/database'
import type {
  PivotConfig,
  PivotField,
  PivotFilter,
  DateGranularity,
} from '../types/pivot'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig = (overrides: Partial<PivotConfig> = {}): PivotConfig => ({
  version: 2,
  tableName: 'sales',
  rowFields: [],
  columnField: null,
  metrics: [{ field: 'revenue', aggregation: 'sum' }],
  filters: [],
  ...overrides,
})

const numericField = (name = 'revenue'): PivotField => ({
  name,
  type: 'double',
  typeCategory: 'number',
})

const textField = (name = 'region'): PivotField => ({
  name,
  type: 'varchar',
  typeCategory: 'text',
})

const dateField = (name = 'order_date', granularity?: DateGranularity): PivotField => ({
  name,
  type: 'timestamp',
  typeCategory: 'date',
  dateGranularity: granularity,
})

const dialects: DatabaseEngine[] = ['duckdb', 'clickhouse', 'bigquery', 'snowflake']

// ---------------------------------------------------------------------------
// quoteIdentifier
// ---------------------------------------------------------------------------

describe('quoteIdentifier', () => {
  it('uses backticks for BigQuery', () => {
    expect(quoteIdentifier('col', 'bigquery')).toBe('`col`')
  })

  it('uses double quotes for other dialects', () => {
    expect(quoteIdentifier('col', 'duckdb')).toBe('"col"')
    expect(quoteIdentifier('col', 'clickhouse')).toBe('"col"')
    expect(quoteIdentifier('col', 'snowflake')).toBe('"col"')
  })
})

// ---------------------------------------------------------------------------
// quoteAlias
// ---------------------------------------------------------------------------

describe('quoteAlias', () => {
  it('quotes aliases for Snowflake', () => {
    expect(quoteAlias('metric_value', 'snowflake')).toBe('"metric_value"')
  })

  it('returns unquoted for others', () => {
    expect(quoteAlias('metric_value', 'duckdb')).toBe('metric_value')
    expect(quoteAlias('metric_value', 'clickhouse')).toBe('metric_value')
  })
})

// ---------------------------------------------------------------------------
// buildDateExpression
// ---------------------------------------------------------------------------

describe('buildDateExpression', () => {
  const granularities: DateGranularity[] = ['year', 'quarter', 'month', 'week', 'date']

  describe('DuckDB', () => {
    it.each(granularities)('handles %s granularity', (g) => {
      const field = dateField('created_at', g)
      const [expr, alias] = buildDateExpression(field, 'duckdb')
      expect(alias).toBe(`created_at_${g}`)
      expect(expr).toBeTruthy()
    })

    it('year uses EXTRACT', () => {
      const [expr] = buildDateExpression(dateField('d', 'year'), 'duckdb')
      expect(expr).toBe('EXTRACT(YEAR FROM "d")')
    })

    it('month uses STRFTIME', () => {
      const [expr] = buildDateExpression(dateField('d', 'month'), 'duckdb')
      expect(expr).toBe("STRFTIME('%Y-%m', \"d\")")
    })

    it('quarter formats as QX YYYY', () => {
      const [expr] = buildDateExpression(dateField('d', 'quarter'), 'duckdb')
      expect(expr).toContain('QUARTER')
      expect(expr).toContain('YEAR')
    })

    it('week uses DATE_TRUNC cast to VARCHAR', () => {
      const [expr] = buildDateExpression(dateField('d', 'week'), 'duckdb')
      expect(expr).toBe("CAST(DATE_TRUNC('week', \"d\") AS VARCHAR)")
    })

    it('date uses STRFTIME', () => {
      const [expr] = buildDateExpression(dateField('d', 'date'), 'duckdb')
      expect(expr).toBe("STRFTIME('%Y-%m-%d', \"d\")")
    })
  })

  describe('ClickHouse', () => {
    it('quarter formats as QX YYYY', () => {
      const [expr] = buildDateExpression(dateField('d', 'quarter'), 'clickhouse')
      expect(expr).toContain('toQuarter')
      expect(expr).toContain('toYear')
    })

    it('month uses formatDateTime', () => {
      const [expr] = buildDateExpression(dateField('d', 'month'), 'clickhouse')
      expect(expr).toBe("formatDateTime(\"d\", '%Y-%m')")
    })

    it('date uses formatDateTime', () => {
      const [expr] = buildDateExpression(dateField('d', 'date'), 'clickhouse')
      expect(expr).toBe("formatDateTime(\"d\", '%Y-%m-%d')")
    })
  })

  describe('BigQuery', () => {
    it('month uses FORMAT_TIMESTAMP', () => {
      const [expr] = buildDateExpression(dateField('d', 'month'), 'bigquery')
      expect(expr).toBe("FORMAT_TIMESTAMP('%Y-%m', `d`)")
    })

    it('week uses DATE_TRUNC with BQ syntax', () => {
      const [expr] = buildDateExpression(dateField('d', 'week'), 'bigquery')
      expect(expr).toBe('DATE_TRUNC(`d`, WEEK)')
    })

    it('quarter formats as QX YYYY', () => {
      const [expr] = buildDateExpression(dateField('d', 'quarter'), 'bigquery')
      expect(expr).toContain('EXTRACT(QUARTER')
      expect(expr).toContain('EXTRACT(YEAR')
    })

    it('date uses FORMAT_TIMESTAMP', () => {
      const [expr] = buildDateExpression(dateField('d', 'date'), 'bigquery')
      expect(expr).toBe("FORMAT_TIMESTAMP('%Y-%m-%d', `d`)")
    })
  })

  describe('Snowflake', () => {
    it('month uses TO_CHAR', () => {
      const [expr] = buildDateExpression(dateField('d', 'month'), 'snowflake')
      expect(expr).toBe("TO_CHAR(\"d\", 'YYYY-MM')")
    })

    it('date uses TO_CHAR', () => {
      const [expr] = buildDateExpression(dateField('d', 'date'), 'snowflake')
      expect(expr).toBe("TO_CHAR(\"d\", 'YYYY-MM-DD')")
    })
  })
})

// ---------------------------------------------------------------------------
// buildFieldExpression
// ---------------------------------------------------------------------------

describe('buildFieldExpression', () => {
  it('returns quoted column for non-date fields', () => {
    const [expr, alias] = buildFieldExpression(textField('region'), 'duckdb')
    expect(expr).toBe('"region"')
    expect(alias).toBe('region')
  })

  it('returns date expression for date fields with granularity', () => {
    const [expr, alias] = buildFieldExpression(dateField('d', 'month'), 'duckdb')
    expect(expr).toContain('STRFTIME')
    expect(alias).toBe('d_month')
  })

  it('returns quoted column for date fields without granularity', () => {
    const field: PivotField = { name: 'd', type: 'date', typeCategory: 'date' }
    const [expr, alias] = buildFieldExpression(field, 'duckdb')
    expect(expr).toBe('"d"')
    expect(alias).toBe('d')
  })
})

// ---------------------------------------------------------------------------
// buildFilterClause
// ---------------------------------------------------------------------------

describe('buildFilterClause', () => {
  it('returns empty string for no filters', () => {
    expect(buildFilterClause([], 'duckdb')).toBe('')
  })

  it('handles equality filter', () => {
    const filters: PivotFilter[] = [
      { field: 'status', operator: '=', value: 'active', typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "status" = 'active'`)
  })

  it('handles contains filter', () => {
    const filters: PivotFilter[] = [
      { field: 'name', operator: 'contains', value: 'test', typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "name" LIKE '%test%'`)
  })

  it('handles starts_with filter', () => {
    const filters: PivotFilter[] = [
      { field: 'name', operator: 'starts_with', value: 'abc', typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "name" LIKE 'abc%'`)
  })

  it('handles before/after filters', () => {
    const filters: PivotFilter[] = [
      { field: 'date', operator: 'after', value: '2025-01-01', typeCategory: 'date' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "date" > '2025-01-01'`)
  })

  it('handles between filter', () => {
    const filters: PivotFilter[] = [
      { field: 'amount', operator: 'between', value: '10,100', typeCategory: 'number' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "amount" BETWEEN '10' AND '100'`)
  })

  it('handles is_null / is_not_null', () => {
    const filters: PivotFilter[] = [
      { field: 'col', operator: 'is_null', value: '', typeCategory: 'text' },
    ]
    expect(buildFilterClause(filters, 'duckdb')).toBe('WHERE "col" IS NULL')

    const filters2: PivotFilter[] = [
      { field: 'col', operator: 'is_not_null', value: '', typeCategory: 'text' },
    ]
    expect(buildFilterClause(filters2, 'duckdb')).toBe('WHERE "col" IS NOT NULL')
  })

  it('combines multiple filters with AND', () => {
    const filters: PivotFilter[] = [
      { field: 'a', operator: '=', value: '1', typeCategory: 'number' },
      { field: 'b', operator: '!=', value: 'x', typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toContain('AND')
    expect(clause).toContain('"a" = \'1\'')
    expect(clause).toContain('"b" != \'x\'')
  })

  it('escapes single quotes in values', () => {
    const filters: PivotFilter[] = [
      { field: 'name', operator: '=', value: "O'Brien", typeCategory: 'text' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe(`WHERE "name" = 'O''Brien'`)
  })

  it('uses backticks for BigQuery', () => {
    const filters: PivotFilter[] = [
      { field: 'col', operator: '>', value: '5', typeCategory: 'number' },
    ]
    const clause = buildFilterClause(filters, 'bigquery')
    expect(clause).toContain('`col`')
  })

  it('uses unquoted boolean literals for boolean filters', () => {
    const filters: PivotFilter[] = [
      { field: 'active', operator: '=', value: 'true', typeCategory: 'boolean' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe('WHERE "active" = true')
  })

  it('uses unquoted false for boolean filters', () => {
    const filters: PivotFilter[] = [
      { field: 'deleted', operator: '=', value: 'false', typeCategory: 'boolean' },
    ]
    const clause = buildFilterClause(filters, 'duckdb')
    expect(clause).toBe('WHERE "deleted" = false')
  })
})

// ---------------------------------------------------------------------------
// buildFromClause
// ---------------------------------------------------------------------------

describe('buildFromClause', () => {
  it('returns quoted table name without originalQuery', () => {
    const config = baseConfig()
    expect(buildFromClause(config, 'duckdb')).toBe('"sales"')
  })

  it('wraps originalQuery as subquery', () => {
    const config = baseConfig({ originalQuery: 'SELECT * FROM orders' })
    expect(buildFromClause(config, 'duckdb')).toBe('(SELECT * FROM orders) AS source_data')
  })
})

// ---------------------------------------------------------------------------
// buildAggregationQuery
// ---------------------------------------------------------------------------

describe('buildAggregationQuery', () => {
  it('builds basic SUM query with one row field', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('SUM("revenue")')
    expect(sql).toContain('"region"')
    expect(sql).toContain('GROUP BY 1')
    expect(sql).toContain('FROM "sales"')
  })

  it('builds COUNT(*) for count metric', () => {
    const config = baseConfig({
      rowFields: [textField('category')],
      metrics: [{ field: '*', aggregation: 'count' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('COUNT(*)')
  })

  it('builds AVG for average metric', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      metrics: [{ field: 'price', aggregation: 'avg' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('AVG("price")')
  })

  it('builds proportion with window function', () => {
    const config = baseConfig({
      rowFields: [textField('category')],
      metrics: [{ field: '*', aggregation: 'proportion' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()')
  })

  it('includes column field in GROUP BY', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      columnField: textField('category'),
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('"category"')
    expect(sql).toContain('GROUP BY 1, 2')
  })

  it('handles date fields with granularity', () => {
    const config = baseConfig({
      rowFields: [dateField('order_date', 'month')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain("STRFTIME('%Y-%m', \"order_date\")")
    expect(sql).toContain('order_date_month')
  })

  it('applies filters', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
      filters: [
        { field: 'status', operator: '=', value: 'completed', typeCategory: 'text' },
      ],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain("WHERE \"status\" = 'completed'")
  })

  it('uses subquery with originalQuery', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
      originalQuery: 'SELECT * FROM raw_orders WHERE year = 2025',
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('FROM (SELECT * FROM raw_orders WHERE year = 2025) AS source_data')
  })

  it('throws without metrics', () => {
    const config = baseConfig({ metrics: [] })
    expect(() => buildAggregationQuery(config, 'duckdb')).toThrow('At least one metric is required')
  })

  describe('dialect variations', () => {
    for (const dialect of dialects) {
      it(`generates valid SQL for ${dialect}`, () => {
        const config = baseConfig({
          rowFields: [textField('region'), dateField('d', 'month')],
          columnField: textField('category'),
          metrics: [{ field: 'revenue', aggregation: 'sum' }],
          filters: [{ field: 'active', operator: '=', value: 'true', typeCategory: 'boolean' }],
        })
        const sql = buildAggregationQuery(config, dialect)
        expect(sql).toContain('SELECT')
        expect(sql).toContain('FROM')
        expect(sql).toContain('GROUP BY')
        expect(sql).toContain('metric_value')
      })
    }

    it('BigQuery uses backticks', () => {
      const config = baseConfig({
        rowFields: [textField('region')],
        metrics: [{ field: 'revenue', aggregation: 'sum' }],
      })
      const sql = buildAggregationQuery(config, 'bigquery')
      expect(sql).toContain('`region`')
      expect(sql).toContain('`revenue`')
    })

    it('Snowflake quotes aliases', () => {
      const config = baseConfig({
        rowFields: [textField('region')],
        metrics: [{ field: 'revenue', aggregation: 'sum' }],
      })
      const sql = buildAggregationQuery(config, 'snowflake')
      expect(sql).toContain('"sum_revenue"')
    })
  })

  it('handles multiple row fields', () => {
    const config = baseConfig({
      rowFields: [textField('region'), textField('category'), numericField('tier')],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('"region"')
    expect(sql).toContain('"category"')
    expect(sql).toContain('"tier"')
    expect(sql).toContain('GROUP BY 1, 2, 3')
  })

  it('handles no row fields (overall aggregate)', () => {
    const config = baseConfig({
      rowFields: [],
      metrics: [{ field: 'revenue', aggregation: 'sum' }],
    })
    const sql = buildAggregationQuery(config, 'duckdb')
    expect(sql).toContain('SUM("revenue")')
    expect(sql).not.toContain('GROUP BY')
  })
})

// ---------------------------------------------------------------------------
// buildPivotQuery
// ---------------------------------------------------------------------------

describe('buildPivotQuery', () => {
  it('builds basic PIVOT query', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      columnField: textField('category'),
    })
    const sql = buildPivotQuery('_pivot_1_agg', config)
    expect(sql).toContain('PIVOT "_pivot_1_agg"')
    expect(sql).toContain('ON "category"')
    expect(sql).toContain('USING SUM("metric_value")')
    expect(sql).toContain('GROUP BY "region"')
  })

  it('handles date column field with granularity', () => {
    const config = baseConfig({
      rowFields: [textField('region')],
      columnField: dateField('order_date', 'month'),
    })
    const sql = buildPivotQuery('_pivot_1_agg', config)
    expect(sql).toContain('ON "order_date_month"')
  })

  it('handles multiple row fields', () => {
    const config = baseConfig({
      rowFields: [textField('region'), textField('category')],
      columnField: dateField('d', 'year'),
    })
    const sql = buildPivotQuery('_pivot_1_agg', config)
    expect(sql).toContain('GROUP BY "region", "category"')
    expect(sql).toContain('ORDER BY "region", "category"')
  })

  it('handles no row fields', () => {
    const config = baseConfig({
      rowFields: [],
      columnField: textField('category'),
    })
    const sql = buildPivotQuery('_pivot_1_agg', config)
    expect(sql).not.toContain('GROUP BY')
    expect(sql).not.toContain('ORDER BY')
  })

  it('throws without column field', () => {
    const config = baseConfig({ columnField: null })
    expect(() => buildPivotQuery('t', config)).toThrow('Column field is required')
  })
})

// ---------------------------------------------------------------------------
// buildDisplayQuery
// ---------------------------------------------------------------------------

describe('buildDisplayQuery', () => {
  it('builds simple SELECT *', () => {
    expect(buildDisplayQuery('_pivot_1_agg')).toBe('SELECT * FROM "_pivot_1_agg"')
  })
})
