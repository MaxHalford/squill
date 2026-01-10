import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Connection, ConnectionType } from '../types/connection'

const STORAGE_KEY = 'squill-connections'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

interface ConnectionsState {
  connections: Connection[]
  activeConnectionId: string | null
}

// In-memory token storage (not persisted to localStorage)
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

    const tokenEntry = accessTokens.value.get(activeConnection.value.id)
    if (!tokenEntry) return true // No token = expired

    return Date.now() > tokenEntry.expiresAt
  })

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state: ConnectionsState = JSON.parse(saved)
        connections.value = state.connections || []
        activeConnectionId.value = state.activeConnectionId || null
      } else {
        // Migrate from old auth format
        migrateFromLegacyAuth()
      }
    } catch (error) {
      console.error('Failed to load connections:', error)
    }
  }

  // Migrate from legacy single-connection format
  const migrateFromLegacyAuth = () => {
    try {
      const oldAuth = localStorage.getItem('squill-auth')
      if (oldAuth) {
        const auth = JSON.parse(oldAuth)
        if (auth.token && auth.user) {
          // Create connection without token (user will need to re-authenticate)
          const connection: Connection = {
            id: `bigquery-${auth.user.email}-${Date.now()}`,
            type: 'bigquery',
            email: auth.user.email,
            name: auth.user.email,
            createdAt: Date.now()
          }
          connections.value = [connection]
          activeConnectionId.value = connection.id
          saveState()
          // Remove old format
          localStorage.removeItem('squill-auth')
          console.log('Migrated from legacy auth. Please re-authenticate to continue.')
        }
      }
    } catch (error) {
      console.error('Failed to migrate legacy auth:', error)
    }
  }

  // Save state to localStorage (session info only, no tokens)
  const saveState = () => {
    try {
      const state: ConnectionsState = {
        connections: connections.value,
        activeConnectionId: activeConnectionId.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save connections:', error)
    }
  }

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

  // Add BigQuery connection (called from AuthCallback after OAuth)
  const addBigQueryConnection = (
    email: string,
    accessToken: string,
    expiresIn: number
  ): string => {
    const connectionId = `bigquery-${email}-${Date.now()}`
    const connection: Connection = {
      id: connectionId,
      type: 'bigquery',
      email: email,
      name: email,
      createdAt: Date.now()
    }

    // Store session info (persisted)
    connections.value = [...connections.value, connection]
    activeConnectionId.value = connectionId
    saveState()

    // Store access token (in-memory only)
    setAccessToken(connectionId, accessToken, expiresIn)

    return connectionId
  }

  // Add DuckDB connection (no OAuth required)
  const addDuckDBConnection = (): string => {
    const connectionId = 'duckdb-local'

    // Check if already exists
    const existing = connections.value.find(c => c.id === connectionId)
    if (existing) {
      activeConnectionId.value = connectionId
      saveState()
      return connectionId
    }

    const connection: Connection = {
      id: connectionId,
      type: 'duckdb',
      name: 'DuckDB Local',
      createdAt: Date.now()
    }

    // Use spread to ensure Vue reactivity triggers
    connections.value = [...connections.value, connection]
    activeConnectionId.value = connectionId
    saveState()
    return connectionId
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
    const index = connections.value.findIndex(c => c.id === connectionId)
    if (index !== -1) {
      // Remove token from memory
      accessTokens.value.delete(connectionId)

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

    return !hasValidToken(connectionId)
  }

  return {
    connections,
    activeConnectionId,
    activeConnection,
    isActiveTokenExpired,
    loadState,
    saveState,
    setAccessToken,
    getAccessToken,
    getConnectionEmail,
    refreshAccessToken,
    addBigQueryConnection,
    addDuckDBConnection,
    setActiveConnection,
    removeConnection,
    setConnectionProjectId,
    getActiveProjectId,
    getConnectionsByType,
    hasValidToken,
    isConnectionExpired
  }
})
