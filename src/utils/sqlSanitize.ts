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
 * Escape a SQL string literal value (double single quotes)
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Clean a SQL query for execution
 * - Trims whitespace
 * - Removes trailing semicolons (they break subquery wrapping for pagination)
 */
export function cleanQueryForExecution(query: string): string {
  return query.trim().replace(/;\s*$/, '')
}

export type LocalDataFormat = 'parquet' | 'csv' | 'tsv' | 'json'

/** Infer a DuckDB-supported local data format from a filename. */
export function getLocalDataFormat(filename: string): LocalDataFormat | null {
  const extension = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  if (extension === 'parquet' || extension === 'parq' || extension === 'pq') return 'parquet'
  if (extension === 'csv') return 'csv'
  if (extension === 'tsv') return 'tsv'
  if (extension === 'json' || extension === 'jsonl' || extension === 'ndjson') return 'json'
  return null
}

/** Return whether a filename uses a supported local data extension. */
export function isLocalDataFileName(filename: string): boolean {
  return getLocalDataFormat(filename) !== null
}

/** Build the DuckDB table-function expression for a registered browser file. */
export function buildLocalDataReaderSql(
  format: LocalDataFormat,
  registeredFileName: string,
): string {
  const fileName = escapeSqlString(registeredFileName)
  switch (format) {
    case 'parquet':
      return `read_parquet('${fileName}')`
    case 'csv':
      return `read_csv_auto('${fileName}')`
    case 'tsv':
      return `read_csv_auto('${fileName}', delim = '\\t')`
    case 'json':
      return `read_json_auto('${fileName}')`
  }
}

/**
 * Generate a unique table name by appending a counter if needed
 */
export function generateUniqueTableName(
  filename: string,
  existingTables: Record<string, unknown>
): string {
  // Sanitize filename (remove a supported local-data extension, lowercase,
  // replace non-alphanumeric characters, and retain a useful fallback).
  const base = filename
    .replace(/\.(csv|tsv|json|jsonl|ndjson|parquet|parq|pq)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') || 'imported_data'

  // Find unique name
  let tableName = base
  let counter = 1
  while (tableName in existingTables) {
    tableName = `${base}_${counter}`
    counter++
  }

  return tableName
}
