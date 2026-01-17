/**
 * Connection utility functions
 * Single source of truth for connection-related helpers
 */

import type { Connection, ConnectionType } from '../types/connection'
import { DATABASE_INFO } from '../types/database'

/**
 * Connection metadata derived from DATABASE_INFO
 * Adds connection-specific properties like hasProjects
 */
export const CONNECTION_METADATA: Record<ConnectionType, {
  displayName: string
  requiresAuth: boolean
  hasProjects: boolean
}> = {
  bigquery: {
    displayName: DATABASE_INFO.bigquery.name,
    requiresAuth: true,
    hasProjects: true
  },
  duckdb: {
    displayName: DATABASE_INFO.duckdb.name,
    requiresAuth: false,
    hasProjects: false
  },
  postgres: {
    displayName: DATABASE_INFO.postgres.name,
    requiresAuth: true,
    hasProjects: false
  },
  snowflake: {
    displayName: DATABASE_INFO.snowflake.name,
    requiresAuth: true,
    hasProjects: false
  }
}

/**
 * Check if a connection type represents a local/in-memory database
 * Currently only DuckDB is local, but this could include SQLite in the future
 */
export function isLocalConnectionType(type: ConnectionType | undefined): boolean {
  return type === 'duckdb'
}

/**
 * Check if a connection is local
 */
export function isLocalConnection(connection: Connection | null | undefined): boolean {
  return isLocalConnectionType(connection?.type)
}

/**
 * Get the SQL dialect for CodeMirror based on connection type
 * Maps connection types to CodeMirror SQL dialects
 * Note: Snowflake uses PostgreSQL dialect as they are largely compatible
 */
export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb' | 'postgres' {
  switch (type) {
    case 'bigquery':
      return 'bigquery'
    case 'postgres':
    case 'snowflake':
      return 'postgres'
    case 'duckdb':
    default:
      return 'duckdb'
  }
}

/**
 * Get display name for a connection type
 */
export function getConnectionTypeName(type: ConnectionType | undefined): string {
  if (!type) return 'Unknown'
  return CONNECTION_METADATA[type]?.displayName || type
}

/**
 * Check if a connection type requires authentication
 */
export function connectionRequiresAuth(type: ConnectionType | undefined): boolean {
  if (!type) return false
  return CONNECTION_METADATA[type]?.requiresAuth ?? false
}

/**
 * Check if a connection type supports projects/databases
 */
export function connectionHasProjects(type: ConnectionType | undefined): boolean {
  if (!type) return false
  return CONNECTION_METADATA[type]?.hasProjects ?? false
}

/**
 * Get display name for a connection (type + identifier)
 */
export function getConnectionDisplayName(connection: Connection | null | undefined): string {
  if (!connection) return 'No connection'

  const typeName = getConnectionTypeName(connection.type)

  if (connection.type === 'duckdb') {
    return `${typeName} (local)`
  }

  if (connection.type === 'postgres') {
    return `${typeName} · ${connection.name || connection.database || 'unknown'}`
  }

  if (connection.type === 'snowflake') {
    return `${typeName} · ${connection.name || connection.database || 'unknown'}`
  }

  if (connection.email) {
    return `${typeName} · ${connection.email}`
  }

  return typeName
}
