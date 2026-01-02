import type { ConnectionType } from '../types/connection'

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
  }
}

/**
 * Get display name for a connection type
 */
export function getConnectionTypeName(type: ConnectionType): string {
  return CONNECTION_METADATA[type]?.displayName || type
}

/**
 * Check if a connection type requires authentication
 */
export function connectionRequiresAuth(type: ConnectionType): boolean {
  return CONNECTION_METADATA[type]?.requiresAuth ?? false
}

/**
 * Check if a connection type supports projects
 */
export function connectionHasProjects(type: ConnectionType): boolean {
  return CONNECTION_METADATA[type]?.hasProjects ?? false
}
