/**
 * Type Utilities
 *
 * Shared type detection and categorization functions for database column types.
 */

export type TypeCategory = 'number' | 'text' | 'date' | 'boolean' | 'binary' | 'json'

/**
 * Map Arrow/DuckDB/PostgreSQL/BigQuery/Snowflake type strings to categories
 */
export const getTypeCategory = (typeStr: string): TypeCategory => {
  const t = typeStr.toLowerCase()
  // Numeric types
  if (t.includes('int') || t.includes('float') || t.includes('double') ||
      t.includes('decimal') || t.includes('numeric') || t === 'bigint' ||
      t.includes('hugeint') || t.includes('tinyint') || t.includes('smallint') ||
      t.includes('number') || t.includes('real')) {
    return 'number'
  }
  // Date/time types
  if (t.includes('date') || t.includes('time') || t.includes('timestamp') ||
      t.includes('interval')) {
    return 'date'
  }
  // Boolean
  if (t.includes('bool')) {
    return 'boolean'
  }
  // Binary/blob
  if (t.includes('blob') || t.includes('binary') || t.includes('bytea') ||
      t.includes('varbinary')) {
    return 'binary'
  }
  // JSON/struct/list/map types
  if (t.includes('json') || t.includes('struct') || t.includes('list') ||
      t.includes('map') || t.includes('array') || t.startsWith('{') ||
      t.includes('variant') || t.includes('object')) {
    return 'json'
  }
  // Default to text (varchar, char, text, uuid, etc.)
  return 'text'
}
