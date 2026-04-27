import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionsStore } from './connections'
import { loadItem, saveItem, deleteItem } from '../utils/storage'
import { isTauri } from '../utils/tauri'
import { createBigQueryClient } from '../services/bigquery'
import type { BigQueryClient, DryRunResult } from '../services/bigquery'
import type { BigQueryProject } from '../types/bigquery'

export type {
  BigQueryQueryResult,
  BigQueryPaginatedQueryResult,
  DryRunResult,
} from '../services/bigquery/types'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_DESKTOP_CLIENT_ID = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID || GOOGLE_CLIENT_ID
const GOOGLE_DESKTOP_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET || ''
const OAUTH_STATE_KEY = 'squill-oauth-state'
import { BACKEND_URL } from '@/services/backend'

const generateOAuthState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// email scope is needed by the Squill backend to identify the user
const BIGQUERY_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform.read-only'
]

interface DryRunCacheEntry {
  result: DryRunResult
  timestamp: number
}
const dryRunCache = new Map<string, DryRunCacheEntry>()
const DRY_RUN_CACHE_TTL = 60000 // 60 seconds

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

  const signInWithGoogle = async (): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    const tauriDetected = isTauri()
    console.log('[BigQuery] signInWithGoogle — isTauri():', tauriDetected,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      '| __TAURI_INTERNALS__:', !!(window as any).__TAURI_INTERNALS__,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      '| __TAURI__:', !!(window as any).__TAURI__,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      '| __TAURI_IPC__:', !!(window as any).__TAURI_IPC__)

    if (tauriDetected) {
      const { runDesktopGoogleAuth } = await import('../services/oauth/desktopGoogle')
      const tokens = await runDesktopGoogleAuth(GOOGLE_DESKTOP_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_SECRET, BIGQUERY_SCOPES)
      console.log('[BigQuery] Desktop OAuth complete, creating connection for', tokens.email)

      const connectionId = connectionsStore.addBigQueryConnection(
        tokens.email,
        tokens.accessToken,
        tokens.expiresIn,
      )
      console.log('[BigQuery] Connection created:', connectionId, '| active:', connectionsStore.activeConnectionId)
      await fetchDefaultProject()
      console.log('[BigQuery] Default project:', projectId.value)
      return
    }

    // Web: incremental auth via the Squill backend.
    // If user isn't logged in, chain full login first; otherwise request
    // only the BigQuery scopes on top of existing grants.
    const { useUserStore } = await import('./user')
    const userStore = useUserStore()

    if (!userStore.isLoggedIn) {
      await userStore.loginWithGoogle(true) // chainBigQuery = true
      return
    }

    const csrfToken = generateOAuthState()
    const state = `${csrfToken}:bigquery`
    sessionStorage.setItem(OAUTH_STATE_KEY, state)

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: BIGQUERY_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    })

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  const reconnectConnection = async (_connectionId: string): Promise<void> => {
    await signInWithGoogle()
  }

  const signOut = async () => {
    const email = connectionsStore.activeConnection?.email

    if (connectionsStore.activeConnectionId) {
      connectionsStore.removeConnection(connectionsStore.activeConnectionId)
    }

    projectId.value = null
    deleteItem('bigquery-project').catch(console.error)

    if (email) {
      if (isTauri()) {
        // Desktop: discard the locally-stored refresh token
        const { forgetDesktopGoogleAuth } = await import('../services/oauth/desktopGoogle')
        await forgetDesktopGoogleAuth(email).catch(console.warn)
      } else {
        // Web: tell the Squill backend to revoke the server-held refresh token
        try {
          await fetch(`${BACKEND_URL}/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          })
        } catch (err) {
          console.warn('Failed to revoke refresh token:', err)
        }
      }
    }
  }

  const restoreSession = async (): Promise<void> => {
    if (!connectionsStore.activeConnectionId) return
    if (connectionsStore.activeConnection?.type !== 'bigquery') return

    if (connectionsStore.hasValidToken(connectionsStore.activeConnectionId)) return

    try {
      await connectionsStore.refreshAccessToken(connectionsStore.activeConnectionId)
      console.log('Session restored successfully')
      if (!projectId.value) {
        await fetchDefaultProject()
      }
    } catch (err) {
      console.warn('Failed to restore session:', err)
    }
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

  const fetchDefaultProject = async () => {
    try {
      const result = await fetchProjects()
      if (result.length > 0) {
        projectId.value = result[0].projectId
      }
    } catch (err) {
      console.warn('Could not fetch default project:', err)
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

  /**
   * Run a dry run query to estimate cost without executing.
   * Results are cached for 60 seconds.
   */
  const dryRunQuery = async (
    query: string,
    targetConnectionId?: string,
  ): Promise<DryRunResult> => {
    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) {
      return { totalBytesProcessed: '0', estimatedCost: '', error: 'No connection' }
    }

    const targetProjectId = resolveProjectId(connectionId)
    if (!targetProjectId) {
      return { totalBytesProcessed: '0', estimatedCost: '', error: 'No project selected' }
    }

    const cacheKey = `${connectionId}:${query}`
    const cached = dryRunCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < DRY_RUN_CACHE_TTL) {
      return cached.result
    }
    if (cached) dryRunCache.delete(cacheKey)

    const result = await clientFor(connectionId).dryRunQuery(query, targetProjectId)
    if (!result.error) {
      dryRunCache.set(cacheKey, { result, timestamp: Date.now() })
    }
    return result
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

  /**
   * Fetch all schemas via INFORMATION_SCHEMA.COLUMNS queries.
   * Lists datasets, groups by location, runs one UNION ALL query per region.
   * Works for both OAuth and local CLI bq via the same client interface.
   */
  const fetchAllSchemas = async (
    targetProjectId: string | null = null,
    targetConnectionId?: string,
  ): Promise<void> => {
    const project = targetProjectId || projectId.value
    if (!project) throw new Error('No project specified')

    const connectionId = targetConnectionId || connectionsStore.activeConnectionId
    if (!connectionId) throw new Error('No connection available')

    const client = clientFor(connectionId)
    const { useDuckDBStore } = await import('./duckdb')
    const duckdbStore = useDuckDBStore()

    try {
      // Step 1: list datasets with their locations
      const allDatasets = await client.listDatasets(project)
      if (allDatasets.length === 0) {
        console.log('No datasets found in project')
        return
      }

      // Step 2: group datasets by location (so each query stays within one region)
      const datasetsByLocation = new Map<string, string[]>()
      for (const ds of allDatasets) {
        const location = ds.location || 'US'
        const group = datasetsByLocation.get(location) || []
        group.push(ds.datasetReference.datasetId)
        datasetsByLocation.set(location, group)
      }

      // Step 3: per region, run one UNION ALL INFORMATION_SCHEMA.COLUMNS query
      const allEntries: Array<{
        project: string
        dataset: string
        table: string
        columns: Array<{ name: string; type: string }>
      }> = []

      await Promise.all(
        Array.from(datasetsByLocation.entries()).map(async ([_location, datasetIds]) => {
          try {
            const unionParts = datasetIds.map(dsId =>
              `SELECT table_schema, table_name, column_name, data_type FROM \`${project}.${dsId}.INFORMATION_SCHEMA.COLUMNS\``,
            )
            const sqlQuery = unionParts.join('\nUNION ALL\n')
            const { rows } = await client.runQuery(sqlQuery, project)

            const tableColumns = new Map<string, { name: string; type: string }[]>()
            for (const row of rows) {
              const dsId = row.table_schema as string
              const tbl = row.table_name as string
              const key = `${dsId}\0${tbl}`
              if (!tableColumns.has(key)) tableColumns.set(key, [])
              tableColumns.get(key)!.push({
                name: row.column_name as string,
                type: row.data_type as string,
              })
            }

            for (const [key, columns] of tableColumns) {
              const [dsId, tbl] = key.split('\0')
              allEntries.push({ project, dataset: dsId, table: tbl, columns })
            }
          } catch (err) {
            console.warn(`Could not fetch schemas for datasets [${datasetIds.join(', ')}]:`, err)
          }
        }),
      )

      const schemaRows = allEntries.flatMap(entry =>
        entry.columns.map(col => ({
          connection_type: 'bigquery',
          connection_id: connectionId,
          catalog: entry.project,
          schema_name: entry.dataset,
          table_name: entry.table,
          column_name: col.name,
          column_type: col.type,
          is_nullable: true,
        })),
      )
      await duckdbStore.replaceConnectionCatalogSchemas('bigquery', connectionId, project, schemaRows)

      const { clearSchemaCache } = await import('../utils/schemaAdapter')
      clearSchemaCache('bigquery')

      console.log(`Loaded ${allEntries.length} table schemas via INFORMATION_SCHEMA (${datasetsByLocation.size} region(s))`)
    } catch (error) {
      console.error('Failed to fetch schemas:', error)
      throw error
    }
  }

  return {
    ready,
    projectId,
    projects,
    signInWithGoogle,
    reconnectConnection,
    signOut,
    fetchProjects,
    setProjectId,
    fetchDatasets,
    fetchTables,
    fetchTableSchema,
    runQuery,
    runQueryPaginated,
    dryRunQuery,
    fetchAllSchemas,
    restoreSession,
    fetchQueryPlan,
    anyBigQueryClient,
  }
})
