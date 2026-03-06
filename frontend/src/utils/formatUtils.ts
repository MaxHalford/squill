/**
 * Shared formatting utilities for consistent display across the app
 */

/**
 * Format a count with proper singular/plural form
 */
export function formatCount(count: number, singular: string, plural?: string): string {
  const pluralForm = plural || `${singular}s`
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`
}

/**
 * Format row count with proper pluralization
 */
export function formatRowCount(count: number): string {
  return formatCount(count, 'row')
}

/**
 * Format row count compactly (e.g. "1 row", "624 rows", "1.2K rows", "3.5M rows")
 */
export function formatRowCountCompact(count: number): string {
  const label = count === 1 ? 'row' : 'rows'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M ${label}`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K ${label}`
  return `${count} ${label}`
}

/**
 * Format a timestamp as relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * Format execution time in human-readable form
 */
export function formatExecutionTime(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Format a numeric value with locale-aware grouping (e.g. 1,234,567)
 * Integers get no decimals; floats keep 2-4 decimal places.
 */
export function formatNumber(val: number | null | unknown): string {
  if (val === null || val === undefined) return 'NULL'
  const num = Number(val)
  if (isNaN(num)) return String(val)
  if (Number.isInteger(num)) {
    if (Math.abs(num) < 10000) return String(num)
    return num.toLocaleString()
  }
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/**
 * Format byte size compactly (e.g., "1.2 GB", "340 MB", "0 B")
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Get first line of text, truncated if needed
 */
export function getFirstLine(text: string, maxLength: number = 50): string {
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > maxLength ? firstLine.substring(0, maxLength) + '...' : firstLine
}
