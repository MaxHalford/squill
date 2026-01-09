import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settings'
import { useConnectionsStore } from './connections'
import { applyAutoLimit } from '../utils/queryTransform'
import type { BigQueryProject } from '../types/bigquery'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const OAUTH_STATE_KEY = 'squill-oauth-state'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Generate cryptographically secure random state for CSRF protection
const generateOAuthState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// Google OAuth scopes
const SCOPES = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform.read-only'
]

interface QueryResult {
  rows: Record<string, any>[]
  stats: {
    totalBytesProcessed?: string
    cacheHit?: boolean
  }
}

export const useBigQueryStore = defineStore('bigquery', () => {
  // Delegate to connections store
  const connectionsStore = useConnectionsStore()

  // Load connections on initialization
  connectionsStore.loadState()

  // Project ID is still managed locally
  const projectId = ref<string | null>(null)

  // Load projectId from localStorage
  try {
    const saved = localStorage.getItem('squill-project')
    if (saved) {
      projectId.value = saved
    }
  } catch (err) {
    console.error('Failed to load project:', err)
  }

  // Computed: get current access token (from in-memory storage)
  const accessToken = computed(() => {
    if (!connectionsStore.activeConnectionId) return null
    return connectionsStore.getAccessToken(connectionsStore.activeConnectionId)
  })

  // Computed properties for user info
  const userEmail = computed(() => connectionsStore.activeConnection?.email || null)
  const userName = computed(() => connectionsStore.activeConnection?.name || null)
  const userPhoto = computed(() => connectionsStore.activeConnection?.photo || null)

  const isAuthenticated = computed(() => {
    return connectionsStore.activeConnection !== null &&
           connectionsStore.activeConnection.type === 'bigquery' &&
           !connectionsStore.isActiveTokenExpired
  })

  // For backward compatibility - projects list
  const projects = ref<BigQueryProject[]>([])

  // Helper: Make API call with automatic token refresh
  const apiCallWithRefresh = async <T>(
    apiCall: (token: string) => Promise<Response>
  ): Promise<T> => {
    const connectionId = connectionsStore.activeConnectionId
    if (!connectionId) {
      throw new Error('No active connection')
    }

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      token = await connectionsStore.refreshAccessToken(connectionId)
    }

    // Make the API call
    let response = await apiCall(token)

    // If 401, refresh token and retry once
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await apiCall(token)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || 'API call failed')
    }

    return response.json()
  }

  // Sign in with Google (redirect to OAuth flow)
  const signInWithGoogle = async (): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    // Generate and store state for CSRF protection
    const state = generateOAuthState()
    sessionStorage.setItem(OAUTH_STATE_KEY, state)

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',  // Request refresh token
      prompt: 'consent',       // Force consent to ensure refresh token
      state
    })

    // Redirect to Google OAuth
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  // Fetch default project (first accessible project)
  const fetchDefaultProject = async () => {
    if (!accessToken.value) return

    try {
      const data = await apiCallWithRefresh<{ projects?: { projectId: string }[] }>(
        (token) => fetch(
          'https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=1',
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
      )

      if (data.projects && data.projects.length > 0) {
        projectId.value = data.projects[0].projectId
      }
    } catch (err) {
      console.warn('Could not fetch default project:', err)
    }
  }

  // Fetch list of available projects
  const fetchProjects = async (): Promise<BigQueryProject[]> => {
    try {
      const data = await apiCallWithRefresh<{ projects?: BigQueryProject[] }>(
        (token) => fetch(
          'https://cloudresourcemanager.googleapis.com/v1/projects',
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
      )

      projects.value = data.projects || []
      return projects.value
    } catch (err) {
      // Cloud Resource Manager API may not be enabled - fail gracefully
      console.warn('Could not fetch projects (API may need to be enabled):', err)
      projects.value = []
      return []
    }
  }

  // Set active project
  const setProjectId = (newProjectId: string) => {
    projectId.value = newProjectId
    try {
      localStorage.setItem('squill-project', newProjectId)
    } catch (err) {
      console.error('Failed to save project:', err)
    }
  }

  // Reconnect an existing connection (re-authenticate)
  const reconnectConnection = async (_connectionId: string): Promise<void> => {
    // For the new flow, reconnecting means going through OAuth again
    await signInWithGoogle()
  }

  // Sign out
  const signOut = async () => {
    const email = connectionsStore.activeConnection?.email

    // Remove connection via connections store
    if (connectionsStore.activeConnectionId) {
      connectionsStore.removeConnection(connectionsStore.activeConnectionId)
    }

    projectId.value = null
    localStorage.removeItem('squill-project')

    // Tell backend to revoke refresh token
    if (email) {
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

  // Fetch datasets for a project
  const fetchDatasets = async (targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const data = await apiCallWithRefresh<{ datasets?: any[] }>(
      (token) => fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
    )

    return data.datasets || []
  }

  // Fetch tables for a dataset
  const fetchTables = async (datasetId: string, targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const data = await apiCallWithRefresh<{ tables?: any[] }>(
      (token) => fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
    )

    return data.tables || []
  }

  // Fetch table schema
  const fetchTableSchema = async (datasetId: string, tableId: string, targetProjectId: string | null = null) => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const data = await apiCallWithRefresh<{ schema?: { fields?: any[] } }>(
      (token) => fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables/${tableId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
    )

    return data.schema?.fields || []
  }

  // Run BigQuery query
  const runQuery = async (query: string, signal: AbortSignal | null = null): Promise<QueryResult> => {
    if (!connectionsStore.activeConnectionId) {
      throw new Error('Please sign in with Google first')
    }

    if (!projectId.value) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    const connectionId = connectionsStore.activeConnectionId

    // Get current token or refresh if needed
    let token = connectionsStore.getAccessToken(connectionId)
    if (!token) {
      token = await connectionsStore.refreshAccessToken(connectionId)
    }

    // Apply auto-limit transformation
    const settingsStore = useSettingsStore()
    const transformedQuery = applyAutoLimit(
      query,
      settingsStore.autoLimitEnabled,
      settingsStore.autoLimitValue
    )

    const makeRequest = async (accessToken: string): Promise<Response> => {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: transformedQuery,
          useLegacySql: false,
          useQueryCache: true,
        }),
      }

      if (signal) {
        fetchOptions.signal = signal
      }

      return fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId.value}/queries`,
        fetchOptions
      )
    }

    let response = await makeRequest(token)

    // If 401, refresh and retry
    if (response.status === 401) {
      token = await connectionsStore.refreshAccessToken(connectionId)
      response = await makeRequest(token)
    }

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Query execution failed')
    }

    const data = await response.json()

    // Extract statistics from BigQuery response
    const stats = {
      totalBytesProcessed: data.totalBytesProcessed || '0',
      cacheHit: data.cacheHit || false
    }

    // Transform BigQuery response to table format
    if (data.schema && data.rows) {
      const fieldNames = data.schema.fields.map((f: any) => f.name)
      const rows = data.rows.map((row: any) => {
        const obj: Record<string, any> = {}
        fieldNames.forEach((name: string, i: number) => {
          obj[name] = row.f[i].v
        })
        return obj
      })
      return { rows, stats }
    }

    return { rows: [], stats }
  }

  // Fetch all schemas using INFORMATION_SCHEMA
  const fetchAllSchemas = async (targetProjectId: string | null = null): Promise<void> => {
    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    // Import schema store
    const { useSchemaStore } = await import('./bigquerySchema')
    const schemaStore = useSchemaStore()

    try {
      // Step 1: Get all datasets using SCHEMATA
      const datasetsQuery = `
        SELECT schema_name
        FROM \`${project}.INFORMATION_SCHEMA.SCHEMATA\`
        WHERE schema_name NOT IN ('INFORMATION_SCHEMA', 'information_schema')
      `

      const datasetsResult = await runQuery(datasetsQuery)
      const datasets = datasetsResult.rows.map(row => row.schema_name)

      if (datasets.length === 0) {
        console.log('No datasets found in project')
        return
      }

      console.log(`Found ${datasets.length} datasets, fetching schemas...`)

      // Step 2: Build a UNION query to get columns from all datasets
      const columnsQueries = datasets.map(dataset => `
        SELECT
          '${project}' as project_id,
          table_schema as dataset_id,
          table_name,
          column_name,
          data_type
        FROM \`${project}.${dataset}.INFORMATION_SCHEMA.COLUMNS\`
      `).join('\nUNION ALL\n')

      const columnsQuery = `
        ${columnsQueries}
        ORDER BY dataset_id, table_name, ordinal_position
      `

      const result = await runQuery(columnsQuery)

      // Group columns by table
      const tableSchemas: Record<string, Array<{ name: string; type: string }>> = {}

      for (const row of result.rows) {
        const tableKey = `${row.project_id}.${row.dataset_id}.${row.table_name}`

        if (!tableSchemas[tableKey]) {
          tableSchemas[tableKey] = []
        }

        tableSchemas[tableKey].push({
          name: row.column_name,
          type: row.data_type
        })
      }

      // Populate schema store
      for (const [tableKey, columns] of Object.entries(tableSchemas)) {
        const [proj, dataset, table] = tableKey.split('.')
        schemaStore.setTableSchema(proj, dataset, table, columns)
      }

      console.log(`Loaded ${Object.keys(tableSchemas).length} table schemas from INFORMATION_SCHEMA`)
    } catch (error) {
      console.error('Failed to fetch schemas from INFORMATION_SCHEMA:', error)
      throw error
    }
  }

  // Restore session on app load (refresh tokens for existing connections)
  const restoreSession = async (): Promise<void> => {
    if (!connectionsStore.activeConnectionId) return
    if (connectionsStore.activeConnection?.type !== 'bigquery') return

    // Check if we already have a valid token
    if (connectionsStore.hasValidToken(connectionsStore.activeConnectionId)) return

    try {
      // Try to refresh the token
      await connectionsStore.refreshAccessToken(connectionsStore.activeConnectionId)
      console.log('Session restored successfully')

      // Try to fetch default project if not set
      if (!projectId.value) {
        await fetchDefaultProject()
      }
    } catch (err) {
      console.warn('Failed to restore session:', err)
      // User will need to re-authenticate
    }
  }

  return {
    accessToken,
    userEmail,
    userName,
    userPhoto,
    projectId,
    projects,
    isAuthenticated,
    signInWithGoogle,
    reconnectConnection,
    signOut,
    fetchProjects,
    setProjectId,
    fetchDatasets,
    fetchTables,
    fetchTableSchema,
    runQuery,
    fetchAllSchemas,
    restoreSession,
  }
})
