/**
 * SQL sanitization utilities
 * Shared functions for sanitizing identifiers and file names
 */

/**
 * Sanitize a string for use as a SQL table name
 * - Converts to lowercase
 * - Replaces non-alphanumeric characters (except underscore) with underscore
 */
export function sanitizeTableName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

/**
 * Sanitize a filename to prevent path traversal and special character issues
 * - Removes path components (forward and back slashes)
 * - Keeps only safe characters: alphanumeric, underscore, hyphen, period
 */
export function sanitizeFileName(filename: string): string {
  // Remove path components (both forward and back slashes)
  const basename = filename.split(/[/\\]/).pop() || 'file.csv'
  // Keep only safe characters
  return basename.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

/**
 * Escape a SQL identifier (column/table name) to prevent injection
 * - Doubles any double quotes
 * - Wraps in double quotes
 */
export function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/**
 * Clean a SQL query for execution
 * - Trims whitespace
 * - Removes trailing semicolons (they break subquery wrapping for pagination)
 */
export function cleanQueryForExecution(query: string): string {
  return query.trim().replace(/;\s*$/, '')
}

/**
 * Generate a unique table name by appending a counter if needed
 */
export function generateUniqueTableName(
  filename: string,
  existingTables: Record<string, unknown>
): string {
  // Sanitize filename (remove .csv, lowercase, replace non-alphanumeric)
  const base = filename
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')

  // Find unique name
  let tableName = base
  let counter = 1
  while (tableName in existingTables) {
    tableName = `${base}_${counter}`
    counter++
  }

  return tableName
}
