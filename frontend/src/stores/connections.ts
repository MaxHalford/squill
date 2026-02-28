import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Connection, ConnectionType } from '../types/connection'
import { ConnectionsStateSchema } from '../utils/storageSchemas'
import {
  fetchConnections as apiFetchConnections,
  type ConnectionData,
} from '../services/connections'
import { clearSchemaCache } from '../utils/schemaAdapter'
import { loadItem, saveItem } from '../utils/storage'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

/**
 * Convert backend ConnectionData to frontend Connection format.
 */
function fromConnectionData(data: ConnectionData): Connection {
  return {
    id: data.id,
    type: data.flavor as ConnectionType,
    name: data.name,
    email: data.email ?? undefined,
    projectId: data.project_id ?? undefined,
    database: data.database ?? undefined,
    createdAt: Date.now(),
  }
}

interface ConnectionsState {
  connections: Connection[]
  activeConnectionId: string | null
}

// In-memory token storage (not persisted)
interface TokenEntry {
  token: string
  expiresAt: number
}

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref<Connection[]>([])
  const activeConnectionId = ref<string | null>(null)

  // In-memory only - access tokens are not persisted
  const accessTokens = ref<Map<string, TokenEntry>>(new Map())

  // Computed: get active connection object
  const activeConnection = computed(() => {
    if (!activeConnectionId.value) return null
    return connections.value.find(c => c.id === activeConnectionId.value) || null
  })

  // Computed: check if active connection token is expired or missing
  const isActiveTokenExpired = computed(() => {
    if (!activeConnection.value) return false

    // DuckDB and other local connections don't have tokens
    if (activeConnection.value.type === 'duckdb') return false

    // PostgreSQL uses backend proxy - no frontend tokens needed
    if (activeConnection.value.type === 'postgres') return false

    const tokenEntry = accessTokens.value.get(activeConnection.value.id)
    if (!tokenEntry) return true // No token = expired

    return Date.now() > tokenEntry.expiresAt
  })

  // Deduplicate connections by ID (keep first occurrence)
  const deduplicateConnections = (conns: Connection[]): Connection[] => {
    const seen = new Set<string>()
    return conns.filter(c => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }

  // ---- Persistence ----

  const loadState = async () => {
    try {
      const data = await loadItem<ConnectionsState>('connections')
      if (data) {
        const result = ConnectionsStateSchema.safeParse(data)
        if (result.success) {
          // Migrate: backfill schemaProjectIds from projectId for BigQuery connections
          const migrated = result.data.connections.map(c => {
            if (c.type === 'bigquery' && c.projectId && !c.schemaProjectIds?.length) {
              return { ...c, schemaProjectIds: [c.projectId] }
            }
            return c
          })
          connections.value = deduplicateConnections(migrated)
          activeConnectionId.value = result.data.activeConnectionId
        }
      }
    } catch (error) {
      console.error('Failed to load connections:', error)
    }
  }

  const saveState = () => {
    const state: ConnectionsState = {
      connections: connections.value,
      activeConnectionId: activeConnectionId.value
    }
    saveItem('connections', state).catch(error => {
      console.error('Failed to save connections:', error)
    })
  }

  const ready = loadState()

  // Set access token for a connection (in-memory only)
  const setAccessToken = (connectionId: string, token: string, expiresIn: number) => {
    accessTokens.value.set(connectionId, {
      token,
      expiresAt: Date.now() + (expiresIn * 1000)
    })
  }

  // Get access token for a connection
  const getAccessToken = (connectionId: string): string | null => {
    const entry = accessTokens.value.get(connectionId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) return null
    return entry.token
  }

  // Get email for a connection (for token refresh)
  const getConnectionEmail = (connectionId: string): string | null => {
    const connection = connections.value.find(c => c.id === connectionId)
    return connection?.email || null
  }

  // Refresh access token from backend
  const refreshAccessToken = async (connectionId: string): Promise<string> => {
    const email = getConnectionEmail(connectionId)
    if (!email) {
      throw new Error('No email found for connection')
    }

    const response = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      if (errorData.detail?.error === 'no_refresh_token') {
        // Remove the connection - user needs to re-authenticate
        removeConnection(connectionId)
        throw new Error('Session expired. Please sign in again.')
      }
      throw new Error(errorData.detail?.message || 'Failed to refresh token')
    }

    const data = await response.json()
    setAccessToken(connectionId, data.access_token, data.expires_in)
    return data.access_token
  }

  // Add or activate a connection. If a connection with the same ID already
  // exists it is activated without creating a duplicate.
  const upsertConnection = (connection: Connection): string => {
    const existing = connections.value.find(c => c.id === connection.id)
    if (!existing) {
      connections.value = [...connections.value, connection]
    }
    activeConnectionId.value = connection.id
    saveState()
    return connection.id
  }

  // Add or update BigQuery connection (called from AuthCallback after OAuth)
  const addBigQueryConnection = (
    email: string,
    accessToken: string,
    expiresIn: number
  ): string => {
    // BigQuery deduplicates by email rather than ID, since the ID
    // is generated client-side and may differ across sessions.
    const existing = connections.value.find(
      c => c.type === 'bigquery' && c.email === email
    )

    if (existing) {
      activeConnectionId.value = existing.id
      setAccessToken(existing.id, accessToken, expiresIn)
      saveState()
      return existing.id
    }

    const connectionId = upsertConnection({
      id: `bigquery-${email}-${Date.now()}`,
      type: 'bigquery',
      email,
      name: email,
      createdAt: Date.now()
    })

    setAccessToken(connectionId, accessToken, expiresIn)
    return connectionId
  }

  // Ensure DuckDB connection exists (no OAuth required).
  // Only sets it active if there is no current active connection.
  const addDuckDBConnection = (): string => {
    const id = 'duckdb-local'
    const existing = connections.value.find(c => c.id === id)
    if (!existing) {
      connections.value = [...connections.value, {
        id,
        type: 'duckdb',
        name: 'DuckDB Local',
        createdAt: Date.now()
      }]
    }
    if (!activeConnectionId.value) {
      activeConnectionId.value = id
    }
    saveState()
    return id
  }

  // Set active connection
  const setActiveConnection = (connectionId: string) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (connection) {
      activeConnectionId.value = connectionId
      saveState()
    }
  }

  // Remove connection
  const removeConnection = (connectionId: string) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (!connection) return

    // Remove token from memory
    accessTokens.value.delete(connectionId)

    // Clear stale schema cache for this connection
    const connType = connection.type
    if (connType === 'bigquery') {
      clearSchemaCache('bigquery')
    } else if (connType === 'postgres' || connType === 'snowflake') {
      clearSchemaCache(connType, connectionId)
    }

    // Use filter to ensure Vue reactivity triggers
    connections.value = connections.value.filter(c => c.id !== connectionId)

    // If we deleted the active connection, switch to another or null
    if (activeConnectionId.value === connectionId) {
      activeConnectionId.value = connections.value.length > 0
        ? connections.value[0].id
        : null
    }
    saveState()
  }

  // Update connection's project ID (for BigQuery and similar)
  const setConnectionProjectId = (connectionId: string, projectId: string | undefined) => {
    // Use map to create new array and ensure Vue reactivity triggers
    connections.value = connections.value.map(c => {
      if (c.id === connectionId) {
        return { ...c, projectId }
      }
      return c
    })
    saveState()
  }

  // Add a project to the schema project list (BigQuery multi-project)
  const addSchemaProject = (connectionId: string, projectId: string) => {
    connections.value = connections.value.map(c => {
      if (c.id === connectionId) {
        const existing = c.schemaProjectIds || []
        if (!existing.includes(projectId)) {
          return { ...c, schemaProjectIds: [...existing, projectId] }
        }
      }
      return c
    })
    saveState()
  }

  // Remove a project from the schema project list
  const removeSchemaProject = (connectionId: string, projectId: string) => {
    connections.value = connections.value.map(c => {
      if (c.id === connectionId) {
        return { ...c, schemaProjectIds: (c.schemaProjectIds || []).filter(p => p !== projectId) }
      }
      return c
    })
    saveState()
  }

  // Get deduped union of schemaProjectIds and projectId
  const getSchemaProjectIds = (connectionId: string): string[] => {
    const conn = connections.value.find(c => c.id === connectionId)
    if (!conn) return []
    const ids = new Set(conn.schemaProjectIds || [])
    if (conn.projectId) ids.add(conn.projectId)
    return Array.from(ids)
  }

  // Get the active connection's project ID
  const getActiveProjectId = (): string | undefined => {
    return activeConnection.value?.projectId
  }

  // Get connections by type
  const getConnectionsByType = (type: ConnectionType): Connection[] => {
    return connections.value.filter(c => c.type === type)
  }

  // Check if a connection has a valid token
  const hasValidToken = (connectionId: string): boolean => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (!connection) return false

    // DuckDB doesn't need tokens
    if (connection.type === 'duckdb') return true

    // PostgreSQL uses backend proxy - always "valid" from token perspective
    if (connection.type === 'postgres') return true

    // Snowflake uses backend proxy - always "valid" from token perspective
    if (connection.type === 'snowflake') return true

    const tokenEntry = accessTokens.value.get(connectionId)
    if (!tokenEntry) return false

    return Date.now() <= tokenEntry.expiresAt
  }

  // Check if a connection's token is expired (inverse of hasValidToken for remote connections)
  const isConnectionExpired = (connectionId: string): boolean => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (!connection) return false

    // DuckDB and other local connections don't have tokens
    if (connection.type === 'duckdb') return false

    // PostgreSQL uses backend proxy - never "expired" from token perspective
    if (connection.type === 'postgres') return false

    // Snowflake uses backend proxy - never "expired" from token perspective
    if (connection.type === 'snowflake') return false

    return !hasValidToken(connectionId)
  }

  // ============================================================
  // Pro/VIP Backend Sync Functions
  // ============================================================

  /**
   * Get user store (lazy import to avoid circular dependency).
   */
  const getUserStore = async () => {
    const { useUserStore } = await import('./user')
    return useUserStore()
  }

  /**
   * Fetch connections from backend and merge with local state.
   * Called on login for Pro/VIP users.
   * Backend connections (BigQuery, Postgres) are merged with local connections (DuckDB).
   */
  const syncFromBackend = async (): Promise<void> => {
    try {
      const userStore = await getUserStore()
      if (!userStore.isPro || !userStore.sessionToken) return

      const backendConnections = await apiFetchConnections(userStore.sessionToken)

      // Keep DuckDB connections from local state (they're local-only)
      const localDuckDBConnections = connections.value.filter(c => c.type === 'duckdb')

      // Convert backend connections to frontend format
      const remoteConnections = backendConnections.map(fromConnectionData)

      // Merge: backend connections + local DuckDB connections
      const mergedConnections = [...remoteConnections, ...localDuckDBConnections]
      connections.value = mergedConnections

      // Set active connection to first one if current is not in list or if none is selected
      if (!activeConnectionId.value || !mergedConnections.find(c => c.id === activeConnectionId.value)) {
        activeConnectionId.value = mergedConnections.length > 0 ? mergedConnections[0].id : null
      }

      saveState()
      console.log(`Synced ${remoteConnections.length} connections from backend (+ ${localDuckDBConnections.length} local)`)
    } catch (error) {
      console.warn('Failed to sync connections from backend:', error)
      // Don't throw - local state still works
    }
  }

  return {
    ready,
    connections,
    activeConnectionId,
    activeConnection,
    isActiveTokenExpired,
    saveState,
    setAccessToken,
    getAccessToken,
    getConnectionEmail,
    refreshAccessToken,
    upsertConnection,
    addBigQueryConnection,
    addDuckDBConnection,
    setActiveConnection,
    removeConnection,
    setConnectionProjectId,
    addSchemaProject,
    removeSchemaProject,
    getSchemaProjectIds,
    getActiveProjectId,
    getConnectionsByType,
    hasValidToken,
    isConnectionExpired,
    syncFromBackend,
  }
})
