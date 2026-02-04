import { describe, it, expect } from 'vitest'
import { isFixableError } from './errorClassifier'

describe('isFixableError', () => {
  describe('DuckDB (always fixable)', () => {
    it('returns true for any error with duckdb connection', () => {
      expect(isFixableError('connection refused', 'duckdb')).toBe(true)
      expect(isFixableError('authentication failed', 'duckdb')).toBe(true)
      expect(isFixableError('random error', 'duckdb')).toBe(true)
    })
  })

  describe('Connection errors (not fixable)', () => {
    const connectionErrors = [
      'failed to connect to database',
      'connection refused',
      'Connection timed out',
      'ECONNREFUSED 127.0.0.1:5432',
      'network error occurred',
      'no connection available',
      'Please connect to a database first',
      'Failed to establish a connection',
      'failed to fetch results',
    ]

    it.each(connectionErrors)('returns false for: %s', (error) => {
      expect(isFixableError(error, 'postgres')).toBe(false)
      expect(isFixableError(error, 'bigquery')).toBe(false)
      expect(isFixableError(error, 'snowflake')).toBe(false)
    })
  })

  describe('Authentication errors (not fixable)', () => {
    const authErrors = [
      'authentication failed for user "admin"',
      'Access denied for user',
      'permission denied for table users',
      'Unauthorized access',
      'invalid credentials provided',
      'password authentication failed',
    ]

    it.each(authErrors)('returns false for: %s', (error) => {
      expect(isFixableError(error, 'postgres')).toBe(false)
    })
  })

  describe('Token errors (not fixable)', () => {
    const tokenErrors = [
      'token expired',
      'Invalid token provided',
      'refresh token required',
      'no token found',
    ]

    it.each(tokenErrors)('returns false for: %s', (error) => {
      expect(isFixableError(error, 'bigquery')).toBe(false)
    })
  })

  describe('Rate limit errors (not fixable)', () => {
    const rateLimitErrors = [
      'quota exceeded for project',
      'rate limit reached',
      'Too many requests',
    ]

    it.each(rateLimitErrors)('returns false for: %s', (error) => {
      expect(isFixableError(error, 'bigquery')).toBe(false)
    })
  })

  describe('Server errors (not fixable)', () => {
    const serverErrors = [
      'internal server error',
      'service unavailable',
      '502 Bad Gateway',
      '503 Service Temporarily Unavailable',
      '504 Gateway Timeout',
    ]

    it.each(serverErrors)('returns false for: %s', (error) => {
      expect(isFixableError(error, 'postgres')).toBe(false)
    })
  })

  describe('Query syntax errors (fixable)', () => {
    const syntaxErrors = [
      'syntax error at or near "SELEC"',
      'Unknown column "user_id" in field list',
      'Table "users" does not exist',
      'type mismatch: expected INT, got STRING',
      'missing FROM clause',
      'unexpected token ")"',
      'column "email" is ambiguous',
    ]

    it.each(syntaxErrors)('returns true for: %s', (error) => {
      expect(isFixableError(error, 'postgres')).toBe(true)
      expect(isFixableError(error, 'bigquery')).toBe(true)
      expect(isFixableError(error, 'snowflake')).toBe(true)
    })
  })

  describe('Case insensitivity', () => {
    it('matches patterns case-insensitively', () => {
      expect(isFixableError('CONNECTION REFUSED', 'postgres')).toBe(false)
      expect(isFixableError('Authentication Failed', 'postgres')).toBe(false)
      expect(isFixableError('QUOTA EXCEEDED', 'bigquery')).toBe(false)
    })
  })

  describe('Exact message matches', () => {
    it('returns false for "Query execution failed:"', () => {
      expect(isFixableError('Query execution failed:', 'postgres')).toBe(false)
    })
  })
})
