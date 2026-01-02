import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Connection, ConnectionType } from '../types/connection'
import type { GoogleUserInfo } from '../types/google-oauth'

const STORAGE_KEY = 'squill-connections'
const TOKEN_EXPIRY_DAYS = 7

interface ConnectionsState {
  connections: Connection[]
  activeConnectionId: string | null
}

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref<Connection[]>([])
  const activeConnectionId = ref<string | null>(null)

  // Computed: get active connection object
  const activeConnection = computed(() => {
    if (!activeConnectionId.value) return null
    return connections.value.find(c => c.id === activeConnectionId.value) || null
  })

  // Computed: check if active connection token is expired
  const isActiveTokenExpired = computed(() => {
    if (!activeConnection.value || !activeConnection.value.tokenExpiry) return false
    return Date.now() > activeConnection.value.tokenExpiry
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
          const connection: Connection = {
            id: `bigquery-${auth.user.email}-${Date.now()}`,
            type: 'bigquery',
            email: auth.user.email,
            name: auth.user.name,
            photo: auth.user.photo,
            token: auth.token,
            tokenExpiry: auth.tokenExpiry,
            createdAt: Date.now()
          }
          connections.value = [connection]
          activeConnectionId.value = connection.id
          saveState()
          // Remove old format
          localStorage.removeItem('squill-auth')
        }
      }
    } catch (error) {
      console.error('Failed to migrate legacy auth:', error)
    }
  }

  // Save state to localStorage
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

  // Add new connection (after OAuth)
  const addConnection = (type: ConnectionType, user: GoogleUserInfo, token: string): string => {
    const connectionId = `${type}-${user.email}-${Date.now()}`
    const connection: Connection = {
      id: connectionId,
      type: type,
      email: user.email,
      name: user.name,
      photo: user.photo,
      token: token,
      tokenExpiry: Date.now() + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      createdAt: Date.now()
    }
    connections.value.push(connection)
    activeConnectionId.value = connectionId
    saveState()
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

    connections.value.push(connection)
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
      connections.value.splice(index, 1)

      // If we deleted the active connection, switch to another or null
      if (activeConnectionId.value === connectionId) {
        activeConnectionId.value = connections.value.length > 0
          ? connections.value[0].id
          : null
      }
      saveState()
    }
  }

  // Reconnect (update token for existing connection)
  const reconnectConnection = (connectionId: string, token: string, user: GoogleUserInfo) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (connection) {
      connection.token = token
      connection.tokenExpiry = Date.now() + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      // Update user info in case it changed
      connection.name = user.name
      connection.photo = user.photo
      saveState()
    }
  }

  // Get connections by type
  const getConnectionsByType = (type: ConnectionType): Connection[] => {
    return connections.value.filter(c => c.type === type)
  }

  // Check if token is expired for a specific connection
  const isConnectionExpired = (connectionId: string): boolean => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (!connection || !connection.tokenExpiry) return true
    return Date.now() > connection.tokenExpiry
  }

  return {
    connections,
    activeConnectionId,
    activeConnection,
    isActiveTokenExpired,
    loadState,
    saveState,
    addConnection,
    addDuckDBConnection,
    setActiveConnection,
    removeConnection,
    reconnectConnection,
    getConnectionsByType,
    isConnectionExpired
  }
})
