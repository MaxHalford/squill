/**
 * API service for fetching connections from backend (Pro/VIP users only).
 * Only BigQuery connections are stored server-side (OAuth refresh tokens).
 * All other connection types (DuckDB, ClickHouse, Snowflake) are local-only.
 */

import { BACKEND_URL } from '@/services/backend'

export interface ConnectionData {
  id: string
  flavor: string  // always 'bigquery' (only backend-stored connection type)
  name: string
  email?: string | null
  project_id?: string | null
  database?: string | null
}

interface ConnectionListResponse {
  connections: ConnectionData[]
}

/**
 * Fetch all connections for the current user from the backend.
 * Returns BigQuery connections stored on the backend.
 */
export async function fetchConnections(sessionToken: string): Promise<ConnectionData[]> {
  const response = await fetch(`${BACKEND_URL}/connections`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
    },
  })

  if (!response.ok) {
    if (response.status === 403) {
      // User is not Pro/VIP - this is expected, not an error
      return []
    }
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to fetch connections')
  }

  const data: ConnectionListResponse = await response.json()
  return data.connections
}
