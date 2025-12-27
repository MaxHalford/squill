/**
 * Applies automatic LIMIT to SQL queries if enabled and no LIMIT exists
 */
export function applyAutoLimit(query: string, enabled: boolean, limitValue: number): string {
  if (!enabled || !query) return query

  // Trim whitespace and normalize
  const normalized = query.trim()

  // Case-insensitive regex to detect existing LIMIT clause
  // Pattern: LIMIT followed by whitespace and number(s)
  // Handles: "LIMIT 100", "limit 100", "LiMiT 100"
  const limitRegex = /\bLIMIT\s+\d+/i

  if (limitRegex.test(normalized)) {
    // Query already has LIMIT, return as-is (respect user's explicit limit)
    return query
  }

  // Append LIMIT clause
  // Remove trailing semicolon if present, add LIMIT, restore semicolon
  const hasSemicolon = normalized.endsWith(';')
  const baseQuery = hasSemicolon ? normalized.slice(0, -1).trim() : normalized

  return hasSemicolon
    ? `${baseQuery} LIMIT ${limitValue};`
    : `${baseQuery} LIMIT ${limitValue}`
}
