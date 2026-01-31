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
 * Get first line of text, truncated if needed
 */
export function getFirstLine(text: string, maxLength: number = 50): string {
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > maxLength ? firstLine.substring(0, maxLength) + '...' : firstLine
}
