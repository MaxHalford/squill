/**
 * Error classification for the AI query fixer.
 * Determines if an error is likely fixable by modifying SQL.
 */

const NON_FIXABLE_MESSAGES = [
  'Query execution failed:'
]

const NON_FIXABLE_PATTERNS = [
  // Connection errors
  /failed to connect/i,
  /connection refused/i,
  /connection timed out/i,
  /memory access out of bounds/i,
  /connection failure/i,
  /ECONNREFUSED/i,
  /network error/i,
  /no connection/i,
  /Please connect to/i,
  /failed to establish a connection/i,
  /failed to fetch/i,
  /insufficient authentication scopes/i,
  // Authentication errors
  /authentication failed/i,
  /access denied/i,
  /permission denied/i,
  /unauthorized/i,
  /invalid.*credentials/i,
  /password authentication failed/i,
  // Token errors
  /token expired/i,
  /invalid token/i,
  /refresh token/i,
  /no.*token/i,
  // Rate limits and quotas
  /quota exceeded/i,
  /rate limit/i,
  /too many requests/i,
  // Server errors
  /internal server error/i,
  /service unavailable/i,
  /502 bad gateway/i,
  /503 service/i,
  /504 gateway/i,
  // Unfixable user errors
  /no tables specified/i,
]

/**
 * Determines if a query error is potentially fixable by AI.
 * Non-fixable errors (connection, auth, rate limits) should not be sent to the AI fixer.
 */
export function isFixableError(errorMessage: string, connectionType: string): boolean {
  // DuckDB is in-browser - all errors are query-related
  if (connectionType === 'duckdb') {
    return true
  }

  // Check against non-fixable patterns
  for (const pattern of NON_FIXABLE_PATTERNS) {
    if (NON_FIXABLE_MESSAGES.includes(errorMessage) || pattern.test(errorMessage)) {
      return false
    }
  }

  return true
}
