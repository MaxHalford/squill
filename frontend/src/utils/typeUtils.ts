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

/**
 * Simplify complex type names for display.
 * E.g., "Struct<{id:Int32, name:Utf8}>" → "Struct"
 *       "List<Struct<{...}>>" → "List<Struct>"
 *       "List<Utf8>" → "List<Utf8>" (unchanged - simple enough)
 */
export const simplifyTypeName = (typeStr: string): string => {
  if (!typeStr) return typeStr

  // Check if it's a complex nested type that needs simplification
  // Match patterns like Struct<{...}>, List<...>, Map<...>
  const structMatch = typeStr.match(/^(Struct)<\{.+\}>$/i)
  if (structMatch) {
    return structMatch[1] // Just "Struct"
  }

  // For List<X> and Map<K,V>, check if the inner type is complex
  const listMatch = typeStr.match(/^(List)<(.+)>$/i)
  if (listMatch) {
    const innerType = listMatch[2]
    // If inner type contains nested braces, simplify it
    if (innerType.includes('<{')) {
      const simplifiedInner = simplifyTypeName(innerType)
      return `${listMatch[1]}<${simplifiedInner}>`
    }
    return typeStr // Keep simple List<Utf8> as-is
  }

  const mapMatch = typeStr.match(/^(Map)<(.+)>$/i)
  if (mapMatch) {
    // Map types have key,value - find the split point
    const inner = mapMatch[2]
    // If inner contains complex types, simplify
    if (inner.includes('<{')) {
      return 'Map'
    }
    return typeStr // Keep simple Map<K,V> as-is
  }

  return typeStr
}

/**
 * Format a date/datetime value for display.
 * Handles: Date objects, ISO strings, Unix timestamps (seconds or milliseconds).
 * Returns ISO format which is unambiguous and sortable.
 */
export const formatDateValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'

  let date: Date

  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'string') {
    // Already a string - check if it looks like a formatted date
    // If it's already ISO-ish or a readable date format, return as-is
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value // Already formatted (ISO or similar)
    }
    // Try to parse it
    const parsed = Date.parse(value)
    if (isNaN(parsed)) return String(value)
    date = new Date(parsed)
  } else if (typeof value === 'number') {
    // Timestamp - detect if seconds or milliseconds
    // Timestamps before year 3000 in ms are > 32503680000000
    // Timestamps in seconds for year 2000+ are ~946684800 to ~32503680000
    // If the number is less than 10^12, it's likely seconds
    const timestamp = value < 1e12 ? value * 1000 : value
    date = new Date(timestamp)
  } else if (typeof value === 'bigint') {
    // BigInt timestamp - assume milliseconds unless too small
    const num = Number(value)
    const timestamp = num < 1e12 ? num * 1000 : num
    date = new Date(timestamp)
  } else {
    return String(value)
  }

  // Validate the date
  if (isNaN(date.getTime())) return String(value)

  // Format as ISO string, but make it more readable
  // toISOString() returns: 2025-01-15T12:30:45.000Z
  const iso = date.toISOString()

  // Check if it's midnight UTC (likely a date-only value)
  if (iso.endsWith('T00:00:00.000Z')) {
    return iso.slice(0, 10) // Just the date part: 2025-01-15
  }

  // Return datetime without the Z suffix, space instead of T
  return iso.slice(0, -1).replace('T', ' ') // 2025-01-15 12:30:45.000
}
