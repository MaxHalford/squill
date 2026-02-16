import { SQLDialect, PostgreSQL } from '@codemirror/lang-sql'
import type { Completion } from '@codemirror/autocomplete'

export type SqlDialect = 'bigquery' | 'postgres' | 'duckdb' | 'snowflake'

// =============================================================================
// Common Completions (shared by all dialects)
// =============================================================================

const commonCompletions: Completion[] = [
  // Core query structure (highest priority)
  { label: 'SELECT', type: 'keyword', boost: 99 },
  { label: 'FROM', type: 'keyword', boost: 99 },
  { label: 'WHERE', type: 'keyword', boost: 98 },
  { label: 'AS', type: 'keyword', boost: 97 },

  // Logical operators
  { label: 'AND', type: 'keyword', boost: 95 },
  { label: 'OR', type: 'keyword', boost: 94 },
  { label: 'NOT', type: 'keyword', boost: 93 },
  { label: 'IN', type: 'keyword', boost: 92 },
  { label: 'IS', type: 'keyword', boost: 91 },
  { label: 'NULL', type: 'keyword', boost: 90 },
  { label: 'LIKE', type: 'keyword', boost: 89 },
  { label: 'BETWEEN', type: 'keyword', boost: 88 },

  // Aggregate functions
  { label: 'COUNT', type: 'function', boost: 86 },
  { label: 'SUM', type: 'function', boost: 85 },
  { label: 'AVG', type: 'function', boost: 84 },
  { label: 'MIN', type: 'function', boost: 83 },
  { label: 'MAX', type: 'function', boost: 82 },

  // Joins
  { label: 'JOIN', type: 'keyword', boost: 80 },
  { label: 'LEFT', type: 'keyword', boost: 79 },
  { label: 'RIGHT', type: 'keyword', boost: 78 },
  { label: 'INNER', type: 'keyword', boost: 77 },
  { label: 'OUTER', type: 'keyword', boost: 76 },
  { label: 'FULL', type: 'keyword', boost: 75 },
  { label: 'CROSS', type: 'keyword', boost: 74 },
  { label: 'ON', type: 'keyword', boost: 73 },
  { label: 'USING', type: 'keyword', boost: 72 },

  // Grouping and ordering
  { label: 'GROUP', type: 'keyword', boost: 70 },
  { label: 'ORDER', type: 'keyword', boost: 69 },
  { label: 'BY', type: 'keyword', boost: 68 },
  { label: 'HAVING', type: 'keyword', boost: 67 },
  { label: 'ASC', type: 'keyword', boost: 66 },
  { label: 'DESC', type: 'keyword', boost: 65 },

  // Pagination
  { label: 'LIMIT', type: 'keyword', boost: 63 },
  { label: 'OFFSET', type: 'keyword', boost: 62 },

  // Set operations
  { label: 'UNION', type: 'keyword', boost: 60 },
  { label: 'ALL', type: 'keyword', boost: 59 },
  { label: 'DISTINCT', type: 'keyword', boost: 58 },
  { label: 'EXCEPT', type: 'keyword', boost: 57 },
  { label: 'INTERSECT', type: 'keyword', boost: 56 },

  // CTEs and subqueries
  { label: 'WITH', type: 'keyword', boost: 55 },
  { label: 'RECURSIVE', type: 'keyword', boost: 54 },
  { label: 'EXISTS', type: 'keyword', boost: 53 },

  // Case expressions
  { label: 'CASE', type: 'keyword', boost: 52 },
  { label: 'WHEN', type: 'keyword', boost: 51 },
  { label: 'THEN', type: 'keyword', boost: 50 },
  { label: 'ELSE', type: 'keyword', boost: 49 },
  { label: 'END', type: 'keyword', boost: 48 },

  // Window functions
  { label: 'OVER', type: 'keyword', boost: 47 },
  { label: 'PARTITION', type: 'keyword', boost: 46 },
  { label: 'WINDOW', type: 'keyword', boost: 45 },
  { label: 'ROWS', type: 'keyword', boost: 44 },
  { label: 'RANGE', type: 'keyword', boost: 43 },
  { label: 'UNBOUNDED', type: 'keyword', boost: 42 },
  { label: 'PRECEDING', type: 'keyword', boost: 41 },
  { label: 'FOLLOWING', type: 'keyword', boost: 40 },
  { label: 'CURRENT', type: 'keyword', boost: 39 },

  // Window functions
  { label: 'ROW_NUMBER', type: 'function', boost: 38 },
  { label: 'RANK', type: 'function', boost: 37 },
  { label: 'DENSE_RANK', type: 'function', boost: 36 },
  { label: 'NTILE', type: 'function', boost: 35 },
  { label: 'LAG', type: 'function', boost: 34 },
  { label: 'LEAD', type: 'function', boost: 33 },
  { label: 'FIRST_VALUE', type: 'function', boost: 32 },
  { label: 'LAST_VALUE', type: 'function', boost: 31 },

  // Common functions
  { label: 'COALESCE', type: 'function', boost: 30 },
  { label: 'NULLIF', type: 'function', boost: 29 },
  { label: 'CAST', type: 'function', boost: 28 },
  { label: 'CONCAT', type: 'function', boost: 27 },
  { label: 'LENGTH', type: 'function', boost: 26 },
  { label: 'UPPER', type: 'function', boost: 25 },
  { label: 'LOWER', type: 'function', boost: 24 },
  { label: 'TRIM', type: 'function', boost: 23 },
  { label: 'SUBSTR', type: 'function', boost: 22 },
  { label: 'SUBSTRING', type: 'function', boost: 21 },
  { label: 'REPLACE', type: 'function', boost: 20 },

  // Date/time
  { label: 'EXTRACT', type: 'function', boost: 19 },
  { label: 'DATE', type: 'keyword', boost: 18 },
  { label: 'TIMESTAMP', type: 'keyword', boost: 17 },
  { label: 'INTERVAL', type: 'keyword', boost: 16 },

  // DML operations
  { label: 'INSERT', type: 'keyword', boost: 15 },
  { label: 'INTO', type: 'keyword', boost: 14 },
  { label: 'VALUES', type: 'keyword', boost: 13 },
  { label: 'UPDATE', type: 'keyword', boost: 12 },
  { label: 'SET', type: 'keyword', boost: 11 },
  { label: 'DELETE', type: 'keyword', boost: 10 },

  // DDL operations
  { label: 'CREATE', type: 'keyword', boost: 9 },
  { label: 'TABLE', type: 'keyword', boost: 8 },
  { label: 'VIEW', type: 'keyword', boost: 7 },
  { label: 'DROP', type: 'keyword', boost: 6 },
  { label: 'ALTER', type: 'keyword', boost: 5 },
  { label: 'TRUNCATE', type: 'keyword', boost: 4 },

  // Modifiers
  { label: 'IF', type: 'keyword', boost: 3 },
  { label: 'TEMP', type: 'keyword', boost: 2 },
  { label: 'TEMPORARY', type: 'keyword', boost: 1 },

  // Boolean literals
  { label: 'TRUE', type: 'keyword', boost: 0 },
  { label: 'FALSE', type: 'keyword', boost: 0 },
]

// =============================================================================
// Dialect-Specific Configurations
// =============================================================================

interface DialectConfig {
  codemirror: SQLDialect
  completions: Completion[]
}

// BigQuery CodeMirror dialect definition
const BigQueryCodeMirror = SQLDialect.define({
  keywords: 'select from where join inner left right full cross on using ' +
    'group by having order asc desc limit offset union all distinct ' +
    'with recursive as case when then else end ' +
    'create table view if not exists or replace temp temporary ' +
    'insert into values update set delete truncate drop ' +
    'and or not in is null like between exists ' +
    'qualify window partition over rows range unbounded preceding following ' +
    'struct array unnest safe_cast',
  types: 'int64 float64 numeric bignumeric bool boolean string bytes ' +
    'date datetime time timestamp interval geography json struct array',
  builtin: 'count sum avg min max stddev variance ' +
    'current_date current_datetime current_time current_timestamp ' +
    'extract date_diff datetime_diff timestamp_diff ' +
    'cast safe_cast format parse_date parse_datetime parse_timestamp ' +
    'generate_uuid generate_array array_length array_concat ' +
    'string_agg concat length lower upper trim substr replace split ' +
    'regexp_contains regexp_extract regexp_replace ' +
    'row_number rank dense_rank ntile lag lead first_value last_value',
  operatorChars: '*/+-%<>!=&|^~',
  specialVar: '@@',
  identifierQuotes: '`',
  charSetCasts: true,
  doubleQuotedStrings: false,
  unquotedBitLiterals: true,
  treatBitsAsBytes: true
})

// BigQuery-specific completions
const bigqueryCompletions: Completion[] = [
  // BigQuery-specific keywords
  { label: 'QUALIFY', type: 'keyword', boost: 67 },
  { label: 'UNNEST', type: 'keyword', boost: 55 },
  { label: 'STRUCT', type: 'keyword', boost: 17 },
  { label: 'ARRAY', type: 'keyword', boost: 17 },

  // BigQuery-specific functions
  { label: 'SAFE_CAST', type: 'function', boost: 28 },
  { label: 'GENERATE_UUID', type: 'function', boost: 15 },
  { label: 'GENERATE_ARRAY', type: 'function', boost: 15 },
  { label: 'ARRAY_LENGTH', type: 'function', boost: 15 },
  { label: 'ARRAY_AGG', type: 'function', boost: 30 },
  { label: 'STRING_AGG', type: 'function', boost: 30 },
  { label: 'ANY_VALUE', type: 'function', boost: 29 },
  { label: 'COUNTIF', type: 'function', boost: 85 },
  { label: 'SUMIF', type: 'function', boost: 84 },
  { label: 'APPROX_COUNT_DISTINCT', type: 'function', boost: 81 },

  // BigQuery date functions
  { label: 'DATE_DIFF', type: 'function', boost: 18 },
  { label: 'DATE_ADD', type: 'function', boost: 18 },
  { label: 'DATE_SUB', type: 'function', boost: 18 },
  { label: 'DATE_TRUNC', type: 'function', boost: 18 },
  { label: 'TIMESTAMP_DIFF', type: 'function', boost: 17 },
  { label: 'TIMESTAMP_ADD', type: 'function', boost: 17 },
  { label: 'TIMESTAMP_TRUNC', type: 'function', boost: 17 },
  { label: 'FORMAT_DATE', type: 'function', boost: 17 },
  { label: 'FORMAT_TIMESTAMP', type: 'function', boost: 17 },
  { label: 'PARSE_DATE', type: 'function', boost: 17 },
  { label: 'PARSE_TIMESTAMP', type: 'function', boost: 17 },

  // BigQuery string functions
  { label: 'STARTS_WITH', type: 'function', boost: 20 },
  { label: 'ENDS_WITH', type: 'function', boost: 20 },
  { label: 'CONTAINS_SUBSTR', type: 'function', boost: 20 },

  // BigQuery regex functions
  { label: 'REGEXP_CONTAINS', type: 'function', boost: 20 },
  { label: 'REGEXP_EXTRACT', type: 'function', boost: 20 },
  { label: 'REGEXP_EXTRACT_ALL', type: 'function', boost: 20 },
  { label: 'REGEXP_REPLACE', type: 'function', boost: 20 },

  // BigQuery JSON functions
  { label: 'JSON_EXTRACT', type: 'function', boost: 15 },
  { label: 'JSON_EXTRACT_SCALAR', type: 'function', boost: 15 },
  { label: 'JSON_QUERY', type: 'function', boost: 15 },
  { label: 'JSON_VALUE', type: 'function', boost: 15 },

  // BigQuery data types
  { label: 'INT64', type: 'type', boost: 5 },
  { label: 'FLOAT64', type: 'type', boost: 5 },
  { label: 'NUMERIC', type: 'type', boost: 5 },
  { label: 'BIGNUMERIC', type: 'type', boost: 5 },
  { label: 'BOOL', type: 'type', boost: 5 },
  { label: 'STRING', type: 'type', boost: 5 },
  { label: 'BYTES', type: 'type', boost: 5 },
  { label: 'DATETIME', type: 'type', boost: 5 },
  { label: 'GEOGRAPHY', type: 'type', boost: 5 },
  { label: 'JSON', type: 'type', boost: 5 },
]

// PostgreSQL-specific completions
const postgresCompletions: Completion[] = [
  // PostgreSQL-specific keywords
  { label: 'RETURNING', type: 'keyword', boost: 14 },
  { label: 'ILIKE', type: 'keyword', boost: 89 },
  { label: 'SIMILAR', type: 'keyword', boost: 88 },
  { label: 'LATERAL', type: 'keyword', boost: 55 },
  { label: 'FETCH', type: 'keyword', boost: 62 },
  { label: 'ONLY', type: 'keyword', boost: 8 },

  // PostgreSQL-specific functions
  { label: 'STRING_AGG', type: 'function', boost: 30 },
  { label: 'ARRAY_AGG', type: 'function', boost: 30 },
  { label: 'NOW', type: 'function', boost: 19 },
  { label: 'AGE', type: 'function', boost: 18 },
  { label: 'DATE_PART', type: 'function', boost: 18 },
  { label: 'DATE_TRUNC', type: 'function', boost: 18 },
  { label: 'TO_CHAR', type: 'function', boost: 17 },
  { label: 'TO_DATE', type: 'function', boost: 17 },
  { label: 'TO_TIMESTAMP', type: 'function', boost: 17 },
  { label: 'GREATEST', type: 'function', boost: 29 },
  { label: 'LEAST', type: 'function', boost: 29 },

  // PostgreSQL JSON functions
  { label: 'JSONB', type: 'type', boost: 15 },
  { label: 'JSON_AGG', type: 'function', boost: 15 },
  { label: 'JSONB_AGG', type: 'function', boost: 15 },
  { label: 'JSON_BUILD_OBJECT', type: 'function', boost: 15 },
  { label: 'JSONB_BUILD_OBJECT', type: 'function', boost: 15 },

  // PostgreSQL array functions
  { label: 'ARRAY_APPEND', type: 'function', boost: 15 },
  { label: 'ARRAY_CAT', type: 'function', boost: 15 },
  { label: 'ARRAY_LENGTH', type: 'function', boost: 15 },
  { label: 'UNNEST', type: 'function', boost: 15 },

  // PostgreSQL regex
  { label: 'REGEXP_MATCH', type: 'function', boost: 20 },
  { label: 'REGEXP_MATCHES', type: 'function', boost: 20 },
  { label: 'REGEXP_REPLACE', type: 'function', boost: 20 },

  // PostgreSQL data types
  { label: 'SERIAL', type: 'type', boost: 5 },
  { label: 'BIGSERIAL', type: 'type', boost: 5 },
  { label: 'TEXT', type: 'type', boost: 5 },
  { label: 'VARCHAR', type: 'type', boost: 5 },
  { label: 'INTEGER', type: 'type', boost: 5 },
  { label: 'BIGINT', type: 'type', boost: 5 },
  { label: 'BOOLEAN', type: 'type', boost: 5 },
  { label: 'TIMESTAMPTZ', type: 'type', boost: 5 },
  { label: 'UUID', type: 'type', boost: 5 },
]

// DuckDB-specific completions
const duckdbCompletions: Completion[] = [
  // DuckDB-specific keywords
  { label: 'PIVOT', type: 'keyword', boost: 55 },
  { label: 'UNPIVOT', type: 'keyword', boost: 54 },
  { label: 'EXCLUDE', type: 'keyword', boost: 53 },
  { label: 'COLUMNS', type: 'keyword', boost: 52 },
  { label: 'POSITIONAL', type: 'keyword', boost: 51 },
  { label: 'ANTI', type: 'keyword', boost: 74 },
  { label: 'SEMI', type: 'keyword', boost: 74 },
  { label: 'ASOF', type: 'keyword', boost: 74 },
  { label: 'SAMPLE', type: 'keyword', boost: 62 },
  { label: 'TABLESAMPLE', type: 'keyword', boost: 62 },

  // DuckDB-specific functions
  { label: 'STRING_AGG', type: 'function', boost: 30 },
  { label: 'ARRAY_AGG', type: 'function', boost: 30 },
  { label: 'LIST', type: 'function', boost: 30 },
  { label: 'LIST_AGG', type: 'function', boost: 30 },
  { label: 'STRUCT_PACK', type: 'function', boost: 15 },
  { label: 'STRUCT_EXTRACT', type: 'function', boost: 15 },
  { label: 'MAP', type: 'function', boost: 15 },
  { label: 'MAP_KEYS', type: 'function', boost: 15 },
  { label: 'MAP_VALUES', type: 'function', boost: 15 },
  { label: 'GREATEST', type: 'function', boost: 29 },
  { label: 'LEAST', type: 'function', boost: 29 },
  { label: 'IF', type: 'function', boost: 30 },
  { label: 'IFN', type: 'function', boost: 29 },

  // DuckDB file functions
  { label: 'READ_CSV', type: 'function', boost: 25 },
  { label: 'READ_CSV_AUTO', type: 'function', boost: 25 },
  { label: 'READ_PARQUET', type: 'function', boost: 25 },
  { label: 'READ_JSON', type: 'function', boost: 25 },
  { label: 'READ_JSON_AUTO', type: 'function', boost: 25 },

  // DuckDB date functions
  { label: 'DATE_DIFF', type: 'function', boost: 18 },
  { label: 'DATE_ADD', type: 'function', boost: 18 },
  { label: 'DATE_SUB', type: 'function', boost: 18 },
  { label: 'DATE_TRUNC', type: 'function', boost: 18 },
  { label: 'DATE_PART', type: 'function', boost: 18 },
  { label: 'STRFTIME', type: 'function', boost: 17 },
  { label: 'STRPTIME', type: 'function', boost: 17 },
  { label: 'NOW', type: 'function', boost: 19 },
  { label: 'TODAY', type: 'function', boost: 19 },

  // DuckDB regex
  { label: 'REGEXP_MATCHES', type: 'function', boost: 20 },
  { label: 'REGEXP_REPLACE', type: 'function', boost: 20 },
  { label: 'REGEXP_EXTRACT', type: 'function', boost: 20 },

  // DuckDB JSON
  { label: 'JSON', type: 'function', boost: 15 },
  { label: 'JSON_EXTRACT', type: 'function', boost: 15 },
  { label: 'JSON_EXTRACT_STRING', type: 'function', boost: 15 },

  // DuckDB data types
  { label: 'HUGEINT', type: 'type', boost: 5 },
  { label: 'UINTEGER', type: 'type', boost: 5 },
  { label: 'UBIGINT', type: 'type', boost: 5 },
  { label: 'DOUBLE', type: 'type', boost: 5 },
  { label: 'VARCHAR', type: 'type', boost: 5 },
  { label: 'BLOB', type: 'type', boost: 5 },
]

// Snowflake-specific completions
const snowflakeCompletions: Completion[] = [
  // Snowflake-specific keywords
  { label: 'QUALIFY', type: 'keyword', boost: 67 },
  { label: 'SAMPLE', type: 'keyword', boost: 62 },
  { label: 'TABLESAMPLE', type: 'keyword', boost: 62 },
  { label: 'LATERAL', type: 'keyword', boost: 55 },
  { label: 'FLATTEN', type: 'function', boost: 55 },
  { label: 'MATCH_RECOGNIZE', type: 'keyword', boost: 50 },
  { label: 'CONNECT', type: 'keyword', boost: 14 },
  { label: 'START', type: 'keyword', boost: 14 },

  // Snowflake-specific functions
  { label: 'LISTAGG', type: 'function', boost: 30 },
  { label: 'ARRAY_AGG', type: 'function', boost: 30 },
  { label: 'OBJECT_AGG', type: 'function', boost: 30 },
  { label: 'IFF', type: 'function', boost: 30 },
  { label: 'IFNULL', type: 'function', boost: 29 },
  { label: 'NVL', type: 'function', boost: 29 },
  { label: 'NVL2', type: 'function', boost: 29 },
  { label: 'ZEROIFNULL', type: 'function', boost: 29 },
  { label: 'GREATEST', type: 'function', boost: 29 },
  { label: 'LEAST', type: 'function', boost: 29 },

  // Snowflake date functions
  { label: 'DATEDIFF', type: 'function', boost: 18 },
  { label: 'DATEADD', type: 'function', boost: 18 },
  { label: 'DATE_TRUNC', type: 'function', boost: 18 },
  { label: 'DATE_PART', type: 'function', boost: 18 },
  { label: 'TO_DATE', type: 'function', boost: 17 },
  { label: 'TO_TIMESTAMP', type: 'function', boost: 17 },
  { label: 'TO_CHAR', type: 'function', boost: 17 },
  { label: 'CURRENT_TIMESTAMP', type: 'function', boost: 19 },
  { label: 'CURRENT_DATE', type: 'function', boost: 19 },

  // Snowflake semi-structured functions
  { label: 'PARSE_JSON', type: 'function', boost: 15 },
  { label: 'TRY_PARSE_JSON', type: 'function', boost: 15 },
  { label: 'TO_JSON', type: 'function', boost: 15 },
  { label: 'TO_VARIANT', type: 'function', boost: 15 },
  { label: 'OBJECT_CONSTRUCT', type: 'function', boost: 15 },
  { label: 'ARRAY_CONSTRUCT', type: 'function', boost: 15 },
  { label: 'GET', type: 'function', boost: 15 },
  { label: 'GET_PATH', type: 'function', boost: 15 },

  // Snowflake regex
  { label: 'REGEXP_LIKE', type: 'function', boost: 20 },
  { label: 'REGEXP_REPLACE', type: 'function', boost: 20 },
  { label: 'REGEXP_SUBSTR', type: 'function', boost: 20 },
  { label: 'REGEXP_INSTR', type: 'function', boost: 20 },
  { label: 'REGEXP_COUNT', type: 'function', boost: 20 },
  { label: 'RLIKE', type: 'keyword', boost: 88 },

  // Snowflake data types
  { label: 'VARIANT', type: 'type', boost: 5 },
  { label: 'OBJECT', type: 'type', boost: 5 },
  { label: 'NUMBER', type: 'type', boost: 5 },
  { label: 'FLOAT', type: 'type', boost: 5 },
  { label: 'VARCHAR', type: 'type', boost: 5 },
  { label: 'BINARY', type: 'type', boost: 5 },
  { label: 'TIMESTAMP_LTZ', type: 'type', boost: 5 },
  { label: 'TIMESTAMP_NTZ', type: 'type', boost: 5 },
  { label: 'TIMESTAMP_TZ', type: 'type', boost: 5 },
]

// =============================================================================
// Dialect Registry
// =============================================================================

export const dialects: Record<SqlDialect, DialectConfig> = {
  bigquery: {
    codemirror: BigQueryCodeMirror,
    completions: bigqueryCompletions,
  },
  postgres: {
    codemirror: PostgreSQL,
    completions: postgresCompletions,
  },
  duckdb: {
    codemirror: PostgreSQL,
    completions: duckdbCompletions,
  },
  snowflake: {
    codemirror: PostgreSQL,
    completions: snowflakeCompletions,
  },
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get all completions for a dialect (common + dialect-specific)
 */
export function getDialectCompletions(dialect: SqlDialect): Completion[] {
  const dialectConfig = dialects[dialect]
  if (!dialectConfig) {
    return commonCompletions
  }
  return [...commonCompletions, ...dialectConfig.completions]
}

/**
 * Get the CodeMirror SQLDialect for a given dialect
 */
export function getCodeMirrorDialect(dialect: SqlDialect): SQLDialect {
  return dialects[dialect]?.codemirror || PostgreSQL
}

// Legacy export for backward compatibility
export const BigQueryDialect = BigQueryCodeMirror
