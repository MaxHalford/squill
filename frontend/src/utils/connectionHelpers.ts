import type { Connection, ConnectionType } from '../types/connection'
import { DATABASE_INFO } from '../types/database'

export const CONNECTION_METADATA: Record<ConnectionType, {
  displayName: string
  requiresAuth: boolean
  hasProjects: boolean
}> = {
  bigquery: {
    displayName: DATABASE_INFO.bigquery.name,
    requiresAuth: true,
    hasProjects: true,
  },
  duckdb: {
    displayName: DATABASE_INFO.duckdb.name,
    requiresAuth: false,
    hasProjects: false,
  },
}

export function isLocalConnectionType(type: ConnectionType | undefined): boolean {
  return type === 'duckdb'
}

export function isLocalConnection(connection: Connection | null | undefined): boolean {
  return isLocalConnectionType(connection?.type)
}

export function getDialectForConnection(type: ConnectionType | undefined): 'bigquery' | 'duckdb' {
  return type === 'bigquery' ? 'bigquery' : 'duckdb'
}

export function getConnectionTypeName(type: ConnectionType | undefined): string {
  if (!type) return 'Unknown'
  return CONNECTION_METADATA[type].displayName
}

export function connectionRequiresAuth(type: ConnectionType | undefined): boolean {
  return type ? CONNECTION_METADATA[type].requiresAuth : false
}

export function connectionHasProjects(type: ConnectionType | undefined): boolean {
  return type ? CONNECTION_METADATA[type].hasProjects : false
}

export function getConnectionDisplayName(connection: Connection | null | undefined): string {
  if (!connection) return 'No connection'
  if (connection.type === 'bigquery' && connection.email) {
    return `${DATABASE_INFO.bigquery.name} · ${connection.email}`
  }
  return DATABASE_INFO[connection.type].name
}
