import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import { loadItem, saveItem, deleteItem } from '../utils/storage'
import { createBigQueryClient } from '../services/bigquery'
import type { BigQueryClient } from '../services/bigquery'
import type { BigQueryProject } from '../types/bigquery'
import { prepareBigQueryAuth, revokeBigQueryAccessToken } from '../services/oauth/bigqueryAuth'

export type {
  BigQueryQueryResult,
  BigQueryPaginatedQueryResult,
} from '../services/bigquery/types'

export const useBigQueryStore = defineStore('bigquery', () => {
  const connectionsStore = useConnectionsStore()

  const projectId = ref<string | null>(null)

  const loadState = async () => {
    await connectionsStore.ready
    const saved = await loadItem<string>('bigquery-project')
    if (saved) {
      projectId.value = saved
    }
  }

  const ready = loadState()

  // Cached projects list — read reactively by MenuBar after fetchProjects()
  const projects = ref<BigQueryProject[]>([])

  // Client cache keyed by connection id — avoids re-allocating the client
  // (and re-running find() / useConnectionsStore()) on every API call.
  const clientCache = new Map<string, BigQueryClient>()

  const clientFor = (connectionId?: string): BigQueryClient => {
    const id = connectionId ?? connectionsStore.activeConnectionId
    if (!id) throw new Error('No active BigQuery connection')
    const cached = clientCache.get(id)
    if (cached) return cached
    const conn = connectionsStore.connections.find(c => c.id === id)
    if (!conn) throw new Error(`Connection ${id} not found`)
    const client = createBigQueryClient(conn)
    clientCache.set(id, client)
    return client
  }

  /** Pick any available BigQuery connection (used by SchemaBox for cross-connection browsing). */
  const anyBigQueryClient = (): BigQueryClient => {
    const conns = connectionsStore.getConnectionsByType('bigquery')
    if (conns.length === 0) throw new Error('No BigQuery connections available')
    const conn = conns.find(c => c.id === connectionsStore.activeConnectionId) ?? conns[0]
    return clientFor(conn.id)
  }

  const resolveProjectId = (connectionId: string): string | null => {
    const conn = connectionsStore.connections.find(c => c.id === connectionId)
    return conn?.projectId || projectId.value
  }

  const signInWithGoogle = async (): Promise<string> => {
    const connectionId = await connectionsStore.connectBigQuery()
    const connection = connectionsStore.connections.find(item => item.id === connectionId)
    const availableProjects = await fetchProjects()
    const selectedProject = connection?.projectId || availableProjects[0]?.projectId
    if (selectedProject) {
      connectionsStore.setConnectionProjectId(connectionId, selectedProject)
      setProjectId(selectedProject)
    }
    return connectionId
  }

  const reconnectConnection = async (connectionId: string): Promise<void> => {
    await connectionsStore.refreshAccessToken(connectionId)
  }

  const ensureAccessToken = (connectionId: string): Promise<string> =>
    connectionsStore.ensureAccessToken(connectionId)

  const signOut = async () => {
    const activeId = connectionsStore.activeConnectionId
    const accessToken = activeId ? connectionsStore.getAccessToken(activeId) : null

    if (activeId) {
      connectionsStore.removeConnection(activeId)
    }

    projectId.value = null
    deleteItem('bigquery-project').catch(console.error)

    if (accessToken) {
      try {
        await revokeBigQueryAccessToken(accessToken)
      } catch (err) {
        console.warn('Failed to revoke Google access:', err)
      }
    }
  }

  const restoreSession = async (): Promise<void> => {
    await prepareBigQueryAuth()
  }

  const setProjectId = (newProjectId: string | null) => {
    projectId.value = newProjectId
    if (newProjectId) {
      saveItem('bigquery-project', newProjectId).catch(err => {
        console.error('Failed to save project:', err)
      })
    } else {
      deleteItem('bigquery-project').catch(err => {
        console.error('Failed to delete project:', err)
      })
    }
  }

  const fetchProjects = async (): Promise<BigQueryProject[]> => {
    try {
      projects.value = await clientFor().listProjects()
      return projects.value
    } catch (err) {
      console.warn('Could not fetch projects:', err)
      projects.value = []
      return []
    }
  }

  const fetchDatasets = async (targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) throw new Error('No project specified')
    return clientFor().listDatasets(project)
  }

  const fetchTables = async (datasetId: string, targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) throw new Error('No project specified')
    return clientFor().listTables(project, datasetId)
  }

  const fetchTableSchema = async (
    datasetId: string,
    tableId: string,
    targetProjectId: string | null = null,
  ) => {
    const project = targetProjectId || projectId.value
    if (!project) throw new Error('No project specified')
    return clientFor().getTableSchema(project, datasetId, tableId)
  }

  const runQuery = async (
    query: string,
    signal: AbortSignal | null = null,
    targetConnectionId?: string,
  ) => {
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) throw new Error('Please sign in with Google first')

    const targetProjectId = resolveProjectId(connectionId)
    if (!targetProjectId) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    return clientFor(connectionId).runQuery(query, targetProjectId, signal)
  }

  const runQueryPaginated = async (
    query: string,
    maxResults: number = 5000,
    pageToken?: string,
    signal: AbortSignal | null = null,
    targetConnectionId?: string,
  ) => {
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) throw new Error('Please sign in with Google first')

    const targetProjectId = resolveProjectId(connectionId)
    if (!targetProjectId) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    return clientFor(connectionId).runQueryPaginated(query, targetProjectId, {
      maxResults,
      pageToken,
      signal,
    })
  }

  const fetchQueryPlan = async (
    targetProjectId: string,
    jobId: string,
    targetConnectionId?: string,
  ): Promise<unknown> => {
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) throw new Error('No BigQuery connection available')
    return clientFor(connectionId).fetchQueryPlan(targetProjectId, jobId)
  }

  return {
    ready,
    projectId,
    projects,
    signInWithGoogle,
    reconnectConnection,
    ensureAccessToken,
    signOut,
    fetchProjects,
    setProjectId,
    fetchDatasets,
    fetchTables,
    fetchTableSchema,
    runQuery,
    runQueryPaginated,
    restoreSession,
    fetchQueryPlan,
    anyBigQueryClient,
  }
})
