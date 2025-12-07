/**
 * Analytics Query Builder
 *
 * Generates dialect-specific SQL queries for column analytics.
 * Supports BigQuery, PostgreSQL, and DuckDB.
 */

export type DatabaseDialect = 'bigquery' | 'postgres' | 'duckdb'
export type TypeCategory = 'number' | 'text' | 'date' | 'boolean'

interface AnalyticsQueryOptions {
  tableName: string
  columnName: string
  typeCategory: TypeCategory
  dialect: DatabaseDialect
  originalQuery?: string  // Original query for subquery-based analytics
  groupByColumns?: string[]
}

/**
 * Quote a column name for the given dialect
 */
const quoteColumn = (name: string, dialect: DatabaseDialect): string => {
  switch (dialect) {
    case 'bigquery':
      return `\`${name}\``
    case 'postgres':
    case 'duckdb':
      return `"${name}"`
  }
}

/**
 * Quote a table name for the given dialect
 */
const quoteTable = (name: string, dialect: DatabaseDialect): string => {
  switch (dialect) {
    case 'bigquery':
      return `\`${name}\``
    case 'postgres':
    case 'duckdb':
      return `"${name}"`
  }
}

/**
 * Build numeric stats query
 */
const buildNumericStatsQuery = (
  col: string,
  fromClause: string,
  _dialect: DatabaseDialect
): string => {
  // All three dialects support these standard aggregate functions
  return `SELECT
  MIN(${col}) as min_val,
  MAX(${col}) as max_val,
  AVG(${col}) as avg_val,
  STDDEV(${col}) as stddev_val,
  COUNT(*) as total_count,
  COUNT(${col}) as non_null_count
FROM ${fromClause}`
}

/**
 * Build date stats query
 */
const buildDateStatsQuery = (
  col: string,
  fromClause: string,
  _dialect: DatabaseDialect
): string => {
  return `SELECT
  MIN(${col}) as min_val,
  MAX(${col}) as max_val,
  COUNT(DISTINCT ${col}) as distinct_count,
  COUNT(*) as total_count,
  COUNT(${col}) as non_null_count
FROM ${fromClause}`
}

/**
 * Build text value distribution query
 * Note: No LIMIT here - pagination handles limiting for source-based queries,
 * and DuckDB local queries add their own limit for performance
 */
const buildTextStatsQuery = (
  col: string,
  fromClause: string,
  _dialect: DatabaseDialect
): string => {
  return `SELECT
  ${col},
  COUNT(*) as count
FROM ${fromClause}
GROUP BY ${col}
ORDER BY count DESC`
}

/**
 * Build boolean stats query
 */
const buildBooleanStatsQuery = (
  col: string,
  fromClause: string,
  dialect: DatabaseDialect
): string => {
  const nullsLast = dialect === 'postgres' ? 'NULLS LAST' : ''
  return `SELECT
  ${col},
  COUNT(*) as count
FROM ${fromClause}
GROUP BY ${col}
ORDER BY ${col} DESC ${nullsLast}`
}

/**
 * Build grouped numeric stats query
 */
const buildGroupedNumericQuery = (
  col: string,
  fromClause: string,
  groupByColumns: string[],
  dialect: DatabaseDialect
): string => {
  const groupCols = groupByColumns.map(c => quoteColumn(c, dialect)).join(', ')

  return `SELECT
  ${groupCols},
  MIN(${col}) as min_val,
  MAX(${col}) as max_val,
  AVG(${col}) as avg_val,
  COUNT(*) as count
FROM ${fromClause}
GROUP BY ${groupCols}
ORDER BY ${groupCols}`
}

/**
 * Build grouped text/boolean stats query
 */
const buildGroupedTextQuery = (
  col: string,
  fromClause: string,
  groupByColumns: string[],
  dialect: DatabaseDialect
): string => {
  const groupCols = groupByColumns.map(c => quoteColumn(c, dialect)).join(', ')

  return `SELECT
  ${groupCols},
  ${col},
  COUNT(*) as count
FROM ${fromClause}
GROUP BY ${groupCols}, ${col}
ORDER BY ${groupCols}, count DESC`
}

/**
 * Build the FROM clause based on whether we have an original query
 */
const buildFromClause = (
  tableName: string,
  originalQuery: string | undefined,
  dialect: DatabaseDialect
): string => {
  if (originalQuery) {
    // Wrap original query as subquery
    return `(${originalQuery}) AS source_data`
  }
  return quoteTable(tableName, dialect)
}

/**
 * Build an analytics query for the given options
 */
export const buildAnalyticsQuery = (options: AnalyticsQueryOptions): string => {
  const { columnName, typeCategory, dialect, tableName, originalQuery, groupByColumns } = options
  const col = quoteColumn(columnName, dialect)
  const fromClause = buildFromClause(tableName, originalQuery, dialect)

  // Handle grouped queries
  if (groupByColumns && groupByColumns.length > 0) {
    if (typeCategory === 'number' || typeCategory === 'date') {
      return buildGroupedNumericQuery(col, fromClause, groupByColumns, dialect)
    }
    return buildGroupedTextQuery(col, fromClause, groupByColumns, dialect)
  }

  // Non-grouped queries
  switch (typeCategory) {
    case 'number':
      return buildNumericStatsQuery(col, fromClause, dialect)
    case 'date':
      return buildDateStatsQuery(col, fromClause, dialect)
    case 'text':
      return buildTextStatsQuery(col, fromClause, dialect)
    case 'boolean':
      return buildBooleanStatsQuery(col, fromClause, dialect)
    default:
      throw new Error(`Unsupported type category: ${typeCategory}`)
  }
}

/**
 * Build a query to get available columns from the source
 * This is used when running analytics against the original query
 */
export const buildColumnsQuery = (
  originalQuery: string,
  _dialect: DatabaseDialect
): string => {
  // Get a single row to extract column names
  return `SELECT * FROM (${originalQuery}) AS source_data LIMIT 1`
}
