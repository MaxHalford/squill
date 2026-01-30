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
