/**
 * BigQuery JSON Response Conversion
 *
 * This module handles the conversion of BigQuery's REST API JSON responses
 * into clean JavaScript objects suitable for DuckDB storage.
 *
 * WHY THIS EXISTS:
 * BigQuery's REST API returns data in a peculiar format:
 * - All values are strings (even numbers, booleans, timestamps)
 * - STRUCT/RECORD types use nested {f: [{v: ...}]} format
 * - REPEATED (array) types wrap each element in {v: ...}
 *
 * EXAMPLE BigQuery response for a STRUCT column:
 * {
 *   "f": [
 *     {"v": "value1"},
 *     {"v": {"f": [{"v": "nested"}]}}  // nested struct
 *   ]
 * }
 *
 * FUTURE: This module should be replaced with Arrow deserialization
 * when migrating to BigQuery Storage Read API, which returns proper
 * typed binary data. The public interface (convertBigQueryRows) should
 * remain stable to minimize migration effort.
 *
 * @see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/getQueryResults
 * @see https://cloud.google.com/bigquery/docs/reference/storage (Arrow alternative)
 */

import type { BigQueryField, BigQueryRow } from '../types/bigquery'

/**
 * Converts a single BigQuery value to a proper JavaScript type.
 * Handles the {f: [{v: ...}]} format for STRUCTs and REPEATED fields.
 *
 * @param value - The raw value from BigQuery's JSON response
 * @param field - The field schema with type information
 * @returns The converted JavaScript value
 */
export const convertBigQueryValue = (value: unknown, field: BigQueryField): unknown => {
  if (value === null || value === undefined) return null

  const type = field.type.toUpperCase()

  // ARRAY/REPEATED - convert each element first (before checking type)
  // BigQuery wraps each array element in {v: ...}
  if (field.mode === 'REPEATED' && Array.isArray(value)) {
    const elementField: BigQueryField = { ...field, mode: undefined }
    return (value as Array<{ v: unknown }>).map(item =>
      convertBigQueryValue(item.v, elementField)
    )
  }

  // RECORD/STRUCT - recursively convert nested fields
  // BigQuery returns: {f: [{v: field1Value}, {v: field2Value}, ...]}
  if (type === 'RECORD' || type === 'STRUCT') {
    const recordValue = value as { f?: Array<{ v: unknown }> }
    if (!recordValue.f || !field.fields) return value

    const obj: Record<string, unknown> = {}
    field.fields.forEach((subField, i) => {
      if (recordValue.f && recordValue.f[i]) {
        obj[subField.name] = convertBigQueryValue(recordValue.f[i].v, subField)
      }
    })
    return obj
  }

  // Numeric types - BigQuery returns as strings
  if (type === 'INTEGER' || type === 'INT64') {
    return parseInt(value as string, 10)
  }
  if (type === 'FLOAT' || type === 'FLOAT64' || type === 'NUMERIC' || type === 'BIGNUMERIC') {
    return parseFloat(value as string)
  }

  // Boolean - BigQuery returns as "true"/"false" strings
  if (type === 'BOOLEAN' || type === 'BOOL') {
    return value === 'true' || value === true
  }

  // Timestamps - BigQuery returns epoch seconds as string
  // Convert to ISO string for DuckDB compatibility
  if (type === 'TIMESTAMP' || type === 'DATETIME') {
    const epoch = parseFloat(value as string)
    if (!isNaN(epoch)) {
      return new Date(epoch * 1000).toISOString()
    }
  }

  // DATE, TIME, STRING, BYTES, GEOGRAPHY, JSON - pass through as-is
  return value
}

/**
 * Converts BigQuery API response rows to clean JavaScript objects.
 * This is the main entry point for conversion.
 *
 * @param rows - Array of BigQuery rows in {f: [{v: ...}]} format
 * @param fields - Schema fields describing the column types
 * @returns Array of plain JavaScript objects with proper types
 *
 * @example
 * const result = convertBigQueryRows(response.rows, response.schema.fields)
 * // result: [{name: "Alice", age: 30, active: true}, ...]
 */
export const convertBigQueryRows = (
  rows: BigQueryRow[],
  fields: BigQueryField[]
): Record<string, unknown>[] => {
  return rows.map(row => {
    const obj: Record<string, unknown> = {}
    fields.forEach((field, i) => {
      obj[field.name] = convertBigQueryValue(row.f[i].v, field)
    })
    return obj
  })
}

/**
 * Extracts a simplified schema from BigQuery fields.
 * Used for column metadata display.
 *
 * @param fields - BigQuery schema fields
 * @returns Simplified schema with name and type only
 */
export const extractSimpleSchema = (
  fields: BigQueryField[]
): { name: string; type: string }[] => {
  return fields.map(f => ({
    name: f.name,
    type: f.type
  }))
}

/**
 * Maps BigQuery type names to DuckDB type names.
 *
 * WHY THIS IS NEEDED:
 * BigQuery's REST API returns values as strings (including timestamps).
 * When we store these in DuckDB via JSON import, DuckDB needs explicit
 * type hints to properly parse timestamps, dates, etc.
 *
 * NOTE: This mapping is specific to BigQuery. Other databases (Postgres,
 * Snowflake) return properly typed data that DuckDB can infer correctly.
 *
 * @param bigQueryType - The type name from BigQuery schema
 * @returns The equivalent DuckDB type name
 *
 * @see https://cloud.google.com/bigquery/docs/reference/standard-sql/data-types
 * @see https://duckdb.org/docs/sql/data_types/overview
 */
export const mapBigQueryTypeToDuckDB = (bigQueryType: string): string => {
  const type = bigQueryType.toUpperCase()

  // Numeric types
  if (type === 'INTEGER' || type === 'INT64') return 'BIGINT'
  if (type === 'FLOAT' || type === 'FLOAT64') return 'DOUBLE'
  if (type === 'NUMERIC' || type === 'BIGNUMERIC') return 'DOUBLE'

  // Boolean
  if (type === 'BOOLEAN' || type === 'BOOL') return 'BOOLEAN'

  // Date/Time types - BigQuery timestamps are converted to ISO strings
  // which DuckDB can parse when explicitly cast
  if (type === 'TIMESTAMP' || type === 'DATETIME') return 'TIMESTAMP'
  if (type === 'DATE') return 'DATE'
  if (type === 'TIME') return 'TIME'

  // Complex types - store as JSON for flexibility
  if (type === 'RECORD' || type === 'STRUCT') return 'JSON'
  if (type === 'ARRAY' || type.startsWith('ARRAY<')) return 'JSON'
  if (type === 'JSON') return 'JSON'

  // Binary
  if (type === 'BYTES') return 'BLOB'

  // Geography (store as text)
  if (type === 'GEOGRAPHY') return 'VARCHAR'

  // Default to VARCHAR for STRING and unknown types
  return 'VARCHAR'
}
