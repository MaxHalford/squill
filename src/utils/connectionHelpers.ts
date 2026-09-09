import type { Connection, ConnectionType } from '../types/connection'
import { DATABASE_INFO } from '../types/database'

export function isLocalConnectionType(type: ConnectionType | undefined): boolean {
  return type === 'duckdb'
}

export function isLocalConnection(connection: Connection | null | undefined): boolean {
  return isLocalConnectionType(connection?.type)
}

export function getConnectionDisplayName(connection: Connection | null | undefined): string {
  if (!connection) return 'No connection'
  if (connection.type === 'bigquery' && connection.email) {
    return `${DATABASE_INFO.bigquery.name} · ${connection.email}`
  }
  return DATABASE_INFO[connection.type].name
}
