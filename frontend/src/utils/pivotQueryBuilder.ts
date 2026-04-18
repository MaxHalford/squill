/**
 * Pivot Query Builder
 *
 * Pure functions for building dialect-specific SQL queries for the pivot table.
 * Two-phase approach:
 *   Phase 1: Aggregation query (runs on source database)
 *   Phase 2: DuckDB PIVOT query (always runs locally)
 */

import type { DatabaseEngine } from '../types/database'
import type {
  PivotConfig,
  PivotField,
  PivotFilter,
  PivotMetric,
  DateGranularity,
} from '../types/pivot'

// ---------------------------------------------------------------------------
// Column / table quoting
// ---------------------------------------------------------------------------

export const quoteIdentifier = (name: string, dialect: DatabaseEngine): string => {
  if (dialect === 'bigquery') return `\`${name}\``
  return `"${name}"`
}

/**
 * Quote an alias. Snowflake returns unquoted aliases in UPPERCASE,
 * so we must quote them to preserve casing.
 */
export const quoteAlias = (alias: string, dialect: DatabaseEngine): string => {
  if (dialect === 'snowflake') return `"${alias}"`
  return alias
}

// ---------------------------------------------------------------------------
// Date expressions
// ---------------------------------------------------------------------------

/**
 * Build a dialect-specific date expression for the given granularity.
 * Returns [expression, alias] tuple.
 */
export const buildDateExpression = (
  field: PivotField,
  dialect: DatabaseEngine
): [expression: string, alias: string] => {
  const col = quoteIdentifier(field.name, dialect)
  const granularity = field.dateGranularity || 'date'
  const alias = `${field.name}_${granularity}`

  const expr = buildDateExpressionForGranularity(col, granularity, dialect)
  return [expr, alias]
}

const buildDateExpressionForGranularity = (
  col: string,
  granularity: DateGranularity,
  dialect: DatabaseEngine
): string => {
  switch (granularity) {
    case 'year':
      // EXTRACT returns an integer, no casting needed
      return `EXTRACT(YEAR FROM ${col})`

    case 'quarter':
      if (dialect === 'bigquery') return `CONCAT('Q', CAST(EXTRACT(QUARTER FROM ${col}) AS STRING), ' ', CAST(EXTRACT(YEAR FROM ${col}) AS STRING))`
      if (dialect === 'snowflake') return `'Q' || EXTRACT(QUARTER FROM ${col})::VARCHAR || ' ' || EXTRACT(YEAR FROM ${col})::VARCHAR`
      if (dialect === 'clickhouse') return `concat('Q', toString(toQuarter(${col})), ' ', toString(toYear(${col})))`
      // DuckDB
      return `'Q' || CAST(QUARTER(${col}) AS VARCHAR) || ' ' || CAST(YEAR(${col}) AS VARCHAR)`

    case 'month':
      if (dialect === 'bigquery') return `FORMAT_TIMESTAMP('%Y-%m', ${col})`
      if (dialect === 'snowflake') return `TO_CHAR(${col}, 'YYYY-MM')`
      if (dialect === 'clickhouse') return `formatDateTime(${col}, '%Y-%m')`
      // DuckDB
      return `STRFTIME('%Y-%m', ${col})`

    case 'week':
      if (dialect === 'bigquery') return `DATE_TRUNC(${col}, WEEK)`
      if (dialect === 'snowflake') return `DATE_TRUNC('WEEK', ${col})`
      if (dialect === 'clickhouse') return `toStartOfWeek(${col})`
      // DuckDB: cast to VARCHAR so timestamps don't serialize as epoch ms
      return `CAST(DATE_TRUNC('week', ${col}) AS VARCHAR)`

    case 'date':
      if (dialect === 'bigquery') return `FORMAT_TIMESTAMP('%Y-%m-%d', ${col})`
      if (dialect === 'snowflake') return `TO_CHAR(${col}, 'YYYY-MM-DD')`
      if (dialect === 'clickhouse') return `formatDateTime(${col}, '%Y-%m-%d')`
      // DuckDB
      return `STRFTIME('%Y-%m-%d', ${col})`
  }
}

// ---------------------------------------------------------------------------
// Field expressions (handles date granularity)
// ---------------------------------------------------------------------------

/**
 * Build the SELECT expression for a field, returning [expression, alias].
 * For date fields with granularity, uses date expression.
 * For other fields, just quotes the column name.
 */
export const buildFieldExpression = (
  field: PivotField,
  dialect: DatabaseEngine
): [expression: string, alias: string] => {
  if (field.typeCategory === 'date' && field.dateGranularity) {
    return buildDateExpression(field, dialect)
  }
  const col = quoteIdentifier(field.name, dialect)
  return [col, field.name]
}

// ---------------------------------------------------------------------------
// Filter clause
// ---------------------------------------------------------------------------

/** Build a WHERE clause from filters. Returns empty string if no filters. */
export const buildFilterClause = (
  filters: PivotFilter[],
  dialect: DatabaseEngine
): string => {
  if (filters.length === 0) return ''

  const conditions = filters.map(f => buildFilterCondition(f, dialect))
  return `WHERE ${conditions.join('\n  AND ')}`
}

const buildFilterCondition = (filter: PivotFilter, dialect: DatabaseEngine): string => {
  const col = quoteIdentifier(filter.field, dialect)

  switch (filter.operator) {
    case 'is_null':
      return `${col} IS NULL`
    case 'is_not_null':
      return `${col} IS NOT NULL`
    case 'contains':
      return `${col} LIKE ${quoteValue(`%${filter.value}%`, dialect)}`
    case 'starts_with':
      return `${col} LIKE ${quoteValue(`${filter.value}%`, dialect)}`
    case 'before':
      return `${col} < ${quoteValue(filter.value, dialect)}`
    case 'after':
      return `${col} > ${quoteValue(filter.value, dialect)}`
    case 'between': {
      const [a, b] = filter.value.split(',').map(v => v.trim())
      return `${col} BETWEEN ${quoteValue(a, dialect)} AND ${quoteValue(b, dialect)}`
    }
    default:
      // Boolean values should be unquoted SQL literals
      if (filter.typeCategory === 'boolean' && (filter.value === 'true' || filter.value === 'false')) {
        return `${col} ${filter.operator} ${filter.value}`
      }
      return `${col} ${filter.operator} ${quoteValue(filter.value, dialect)}`
  }
}

const quoteValue = (value: string, _dialect: DatabaseEngine): string => {
  // Escape single quotes
  const escaped = value.replace(/'/g, "''")
  return `'${escaped}'`
}

// ---------------------------------------------------------------------------
// FROM clause
// ---------------------------------------------------------------------------

export const buildFromClause = (
  config: PivotConfig,
  dialect: DatabaseEngine
): string => {
  if (config.originalQuery) {
    return `(${config.originalQuery}) AS source_data`
  }
  return quoteIdentifier(config.tableName, dialect)
}

// ---------------------------------------------------------------------------
// Phase 1: Aggregation query (dialect-aware, runs on source DB)
// ---------------------------------------------------------------------------

/**
 * Build the aggregation GROUP BY query for Phase 1.
 * This runs on the source database (Postgres/Snowflake/BigQuery/DuckDB).
 */
export const buildAggregationQuery = (
  config: PivotConfig,
  dialect: DatabaseEngine
): string => {
  const metric = config.metrics[0]
  if (!metric) throw new Error('At least one metric is required')

  const fromClause = buildFromClause(config, dialect)
  const filterClause = buildFilterClause(config.filters, dialect)

  // Build SELECT fields
  const selectParts: string[] = []
  const groupByParts: string[] = []

  // Row fields
  for (const field of config.rowFields) {
    const [expr, alias] = buildFieldExpression(field, dialect)
    if (expr === quoteIdentifier(alias, dialect)) {
      selectParts.push(expr)
    } else {
      selectParts.push(`${expr} AS ${quoteAlias(alias, dialect)}`)
    }
    groupByParts.push(expr)
  }

  // Column field (optional)
  if (config.columnField) {
    const [expr, alias] = buildFieldExpression(config.columnField, dialect)
    if (expr === quoteIdentifier(alias, dialect)) {
      selectParts.push(expr)
    } else {
      selectParts.push(`${expr} AS ${quoteAlias(alias, dialect)}`)
    }
    groupByParts.push(expr)
  }

  // Metric expression — use descriptive alias when no column field (flat mode)
  const metricExpr = buildMetricExpression(metric, dialect)
  const metricAlias = config.columnField
    ? 'metric_value'
    : metric.field === '*'
      ? metric.aggregation
      : `${metric.aggregation}_${metric.field}`
  selectParts.push(`${metricExpr} AS ${quoteAlias(metricAlias, dialect)}`)

  // Build full query
  const select = selectParts.join(',\n  ')
  const groupBy = groupByParts.length > 0
    ? `GROUP BY ${groupByParts.map((_, i) => i + 1).join(', ')}`
    : ''
  const orderBy = groupByParts.length > 0
    ? config.columnField
      ? `ORDER BY ${groupByParts.map((_, i) => i + 1).join(', ')}`
      : `ORDER BY ${groupByParts.length + 1} DESC`
    : ''

  const parts = [
    `SELECT\n  ${select}`,
    `FROM ${fromClause}`,
  ]
  if (filterClause) parts.push(filterClause)
  if (groupBy) parts.push(groupBy)
  if (orderBy) parts.push(orderBy)

  return parts.join('\n')
}

/** Build the metric aggregation expression */
const buildMetricExpression = (
  metric: PivotMetric,
  dialect: DatabaseEngine
): string => {
  const col = metric.field === '*' ? '*' : quoteIdentifier(metric.field, dialect)

  switch (metric.aggregation) {
    case 'count':
      return 'COUNT(*)'
    case 'sum':
      return `SUM(${col})`
    case 'avg':
      return `AVG(${col})`
    case 'proportion':
      // Proportion = COUNT(*) as fraction of total, expressed as percentage
      return 'COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()'
  }
}

// ---------------------------------------------------------------------------
// Phase 2: DuckDB PIVOT query (always runs locally)
// ---------------------------------------------------------------------------

/**
 * Build the DuckDB PIVOT query for Phase 2.
 * This reshapes the flat aggregation results into a cross-tabulation.
 *
 * Only called when config.columnField is set.
 */
export const buildPivotQuery = (
  aggTableName: string,
  config: PivotConfig
): string => {
  if (!config.columnField) {
    throw new Error('Column field is required for PIVOT query')
  }

  // The column field alias in the aggregation table
  const columnAlias = config.columnField.typeCategory === 'date' && config.columnField.dateGranularity
    ? `${config.columnField.name}_${config.columnField.dateGranularity}`
    : config.columnField.name

  // Row field aliases
  const rowAliases = config.rowFields.map(f =>
    f.typeCategory === 'date' && f.dateGranularity
      ? `${f.name}_${f.dateGranularity}`
      : f.name
  )

  const groupByClause = rowAliases.length > 0
    ? `GROUP BY ${rowAliases.map(a => `"${a}"`).join(', ')}`
    : ''

  const orderByClause = rowAliases.length > 0
    ? `ORDER BY ${rowAliases.map(a => `"${a}"`).join(', ')}`
    : ''

  return [
    `PIVOT "${aggTableName}"`,
    `ON "${columnAlias}"`,
    `USING SUM("metric_value")`,
    groupByClause,
    orderByClause,
  ].filter(Boolean).join('\n')
}

/**
 * Build a simple SELECT for displaying Phase 1 results without pivot.
 * Used when no column field is set.
 */
export const buildDisplayQuery = (aggTableName: string): string => {
  return `SELECT * FROM "${aggTableName}"`
}
