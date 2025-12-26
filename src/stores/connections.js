import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'squill-connections'
const TOKEN_EXPIRY_DAYS = 7

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref([])
  const activeConnectionId = ref(null)

  // Computed: get active connection object
  const activeConnection = computed(() => {
    if (!activeConnectionId.value) return null
    return connections.value.find(c => c.id === activeConnectionId.value) || null
  })

  // Computed: check if active connection token is expired
  const isActiveTokenExpired = computed(() => {
    if (!activeConnection.value) return false
    return Date.now() > activeConnection.value.tokenExpiry
  })

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
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
          const connection = {
            id: `bigquery-${auth.user.email}-${Date.now()}`,
            type: 'bigquery',
            email: auth.user.email,
            name: auth.user.name,
            photo: auth.user.photo,
            token: auth.token,
            tokenExpiry: auth.tokenExpiry,
            createdAt: Date.now(),
            lastUsedAt: Date.now()
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
      const state = {
        connections: connections.value,
        activeConnectionId: activeConnectionId.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save connections:', error)
    }
  }

  // Add new connection (after OAuth)
  const addConnection = (type, user, token) => {
    const connectionId = `${type}-${user.email}-${Date.now()}`
    const connection = {
      id: connectionId,
      type: type,
      email: user.email,
      name: user.name,
      photo: user.photo,
      token: token,
      tokenExpiry: Date.now() + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    }
    connections.value.push(connection)
    activeConnectionId.value = connectionId
    saveState()
    return connectionId
  }

  // Set active connection
  const setActiveConnection = (connectionId) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (connection) {
      activeConnectionId.value = connectionId
      connection.lastUsedAt = Date.now()
      saveState()
    }
  }

  // Remove connection
  const removeConnection = (connectionId) => {
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
  const reconnectConnection = (connectionId, token, user) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (connection) {
      connection.token = token
      connection.tokenExpiry = Date.now() + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      connection.lastUsedAt = Date.now()
      // Update user info in case it changed
      connection.name = user.name
      connection.photo = user.photo
      saveState()
    }
  }

  // Get connections by type
  const getConnectionsByType = (type) => {
    return connections.value.filter(c => c.type === type)
  }

  // Check if token is expired for a specific connection
  const isConnectionExpired = (connectionId) => {
    const connection = connections.value.find(c => c.id === connectionId)
    if (!connection) return true
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
    setActiveConnection,
    removeConnection,
    reconnectConnection,
    getConnectionsByType,
    isConnectionExpired
  }
})
