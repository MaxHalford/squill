/**
 * Connection utility functions
 * Single source of truth for connection-related helpers
 */

import type { Connection, ConnectionType } from '../types/connection'

/**
 * Connection metadata - single source of truth for connection display information
 */
export const CONNECTION_METADATA: Record<ConnectionType, {
  displayName: string
  requiresAuth: boolean
  hasProjects: boolean
}> = {
  bigquery: {
    displayName: 'BigQuery',
    requiresAuth: true,
    hasProjects: true
  },
  duckdb: {
    displayName: 'DuckDB',
    requiresAuth: false,
    hasProjects: false
  },
  postgres: {
    displayName: 'PostgreSQL',
    requiresAuth: true,
    hasProjects: false
  }
  // Future: snowflake, mysql, etc.
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
 */
export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb' | 'postgres' {
  switch (type) {
    case 'bigquery':
      return 'bigquery'
    case 'postgres':
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

  if (connection.email) {
    return `${typeName} · ${connection.email}`
  }

  return typeName
}
