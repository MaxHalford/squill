/**
 * API service for fetching connections from backend (Pro/VIP users only).
 * Connections are derived from BigQueryConnection and PostgresConnection tables.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface ConnectionData {
  id: string
  flavor: string  // bigquery, duckdb, postgres
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
 * Returns connections derived from BigQueryConnection and PostgresConnection tables.
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
