import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Connection, ConnectionType } from '../types/connection'
import { ConnectionsStateSchema } from '../utils/storageSchemas'
import { loadItem, saveItem } from '../utils/storage'
import { authorizeBigQuery } from '../services/oauth/bigqueryAuth'

interface ConnectionsState {
  connections: Connection[]
  activeConnectionId: string | null
}

interface TokenEntry {
  token: string
  expiresAt: number
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const EXPIRY_SKEW_MS = 60_000
export const LOCAL_DUCKDB_CONNECTION_ID = 'duckdb-local'

const createLocalDuckDBConnection = (): Connection => ({
  id: LOCAL_DUCKDB_CONNECTION_ID,
  type: 'duckdb',
  name: 'DuckDB (local)',
  createdAt: 0,
})

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref<Connection[]>([])
  const activeConnectionId = ref<string | null>(null)
  const accessTokens = new Map<string, TokenEntry>()

  const activeConnection = computed(() =>
    connections.value.find(connection => connection.id === activeConnectionId.value) || null,
  )

  const getAccessToken = (connectionId: string): string | null => {
    const entry = accessTokens.get(connectionId)
    if (!entry || Date.now() >= entry.expiresAt) {
      accessTokens.delete(connectionId)
      return null
    }
    return entry.token
  }

  const hasValidToken = (connectionId: string) => getAccessToken(connectionId) !== null
  const isConnectionExpired = (connectionId: string) => {
    const connection = connections.value.find(item => item.id === connectionId)
    return connection?.type === 'bigquery' ? !hasValidToken(connectionId) : false
  }
  const isActiveTokenExpired = computed(() =>
    activeConnectionId.value ? isConnectionExpired(activeConnectionId.value) : false,
  )

  const saveState = () => {
    const state: ConnectionsState = {
      connections: connections.value,
      activeConnectionId: activeConnectionId.value,
    }
    saveItem('connections', state).catch(error => console.error('Failed to save connections:', error))
  }

  const loadState = async () => {
    const stored = await loadItem<unknown>('connections')
    const result = ConnectionsStateSchema.safeParse(stored)
    const storedConnections = result.success ? result.data.connections : []

    // Keep DuckDB as an explicit local engine and retain only non-secret
    // metadata for supported external connections.
    connections.value = [
      createLocalDuckDBConnection(),
      ...storedConnections
      .filter(connection => connection.type === 'bigquery')
      .map(connection => ({
        id: connection.id,
        type: 'bigquery' as const,
        name: connection.name,
        createdAt: connection.createdAt,
        email: connection.email,
        projectId: connection.projectId,
        schemaProjectIds: connection.schemaProjectIds,
      })),
    ]

    const storedActiveId = result.success ? result.data.activeConnectionId : null
    activeConnectionId.value = connections.value.some(connection => connection.id === storedActiveId)
      ? storedActiveId
      : LOCAL_DUCKDB_CONNECTION_ID
    saveState()
  }

  const ready = loadState().catch(error => console.error('Failed to load connections:', error))

  const setAccessToken = (connectionId: string, token: string, expiresIn: number) => {
    accessTokens.set(connectionId, {
      token,
      expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS,
    })
  }

  const clearAccessToken = (connectionId: string) => accessTokens.delete(connectionId)

  const upsertConnection = (connection: Connection): string => {
    const existingIndex = connections.value.findIndex(item => item.id === connection.id)
    if (existingIndex === -1) connections.value.push(connection)
    else connections.value[existingIndex] = { ...connections.value[existingIndex], ...connection }
    activeConnectionId.value = connection.id
    saveState()
    return connection.id
  }

  const addBigQueryConnection = (email: string, accessToken: string, expiresIn: number): string => {
    const existing = connections.value.find(connection =>
      connection.type === 'bigquery' && connection.email?.toLowerCase() === email.toLowerCase(),
    )
    const connectionId = existing?.id || `bigquery-${crypto.randomUUID()}`
    upsertConnection({
      ...(existing || {}),
      id: connectionId,
      type: 'bigquery',
      name: email,
      email,
      createdAt: existing?.createdAt || Date.now(),
    })
    setAccessToken(connectionId, accessToken, expiresIn)
    return connectionId
  }

  const connectBigQuery = async (): Promise<string> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google OAuth is not configured. Set the GOOGLE_CLIENT_ID GitHub Actions variable.')
    }
    const authorization = await authorizeBigQuery(GOOGLE_CLIENT_ID, { selectAccount: true })
    return addBigQueryConnection(authorization.email, authorization.accessToken, authorization.expiresIn)
  }

  const refreshAccessToken = async (connectionId: string): Promise<string> => {
    const connection = connections.value.find(item => item.id === connectionId)
    if (connection?.type !== 'bigquery' || !connection.email) throw new Error('BigQuery connection not found.')
    const authorization = await authorizeBigQuery(GOOGLE_CLIENT_ID, { expectedEmail: connection.email })
    setAccessToken(connectionId, authorization.accessToken, authorization.expiresIn)
    return authorization.accessToken
  }

  const ensureAccessToken = async (connectionId: string): Promise<string> =>
    getAccessToken(connectionId) || refreshAccessToken(connectionId)

  const setActiveConnection = (connectionId: string) => {
    if (!connections.value.some(connection => connection.id === connectionId)) return
    activeConnectionId.value = connectionId
    saveState()
  }

  const removeConnection = (connectionId: string) => {
    if (connectionId === LOCAL_DUCKDB_CONNECTION_ID) return
    clearAccessToken(connectionId)
    connections.value = connections.value.filter(connection => connection.id !== connectionId)
    if (activeConnectionId.value === connectionId) {
      activeConnectionId.value = connections.value[0]?.id || null
    }
    saveState()
  }

  const setConnectionProjectId = (connectionId: string, projectId: string | undefined) => {
    connections.value = connections.value.map(connection =>
      connection.id === connectionId ? { ...connection, projectId } : connection,
    )
    saveState()
  }

  const addSchemaProject = (connectionId: string, projectId: string) => {
    connections.value = connections.value.map(connection => {
      if (connection.id !== connectionId) return connection
      const projectIds = new Set(connection.schemaProjectIds || [])
      projectIds.add(projectId)
      return { ...connection, schemaProjectIds: [...projectIds] }
    })
    saveState()
  }

  const removeSchemaProject = (connectionId: string, projectId: string) => {
    connections.value = connections.value.map(connection =>
      connection.id === connectionId
        ? { ...connection, schemaProjectIds: (connection.schemaProjectIds || []).filter(id => id !== projectId) }
        : connection,
    )
    saveState()
  }

  const getSchemaProjectIds = (connectionId: string): string[] => {
    const connection = connections.value.find(item => item.id === connectionId)
    if (!connection) return []
    const projectIds = new Set(connection.schemaProjectIds || [])
    if (connection.projectId) projectIds.add(connection.projectId)
    return [...projectIds]
  }

  const getActiveProjectId = () => activeConnection.value?.projectId
  const getConnectionsByType = (type: ConnectionType) => connections.value.filter(connection => connection.type === type)

  return {
    ready,
    connections,
    activeConnectionId,
    activeConnection,
    isActiveTokenExpired,
    saveState,
    setAccessToken,
    clearAccessToken,
    getAccessToken,
    refreshAccessToken,
    ensureAccessToken,
    connectBigQuery,
    upsertConnection,
    addBigQueryConnection,
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
  }
})
