import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settings'
import { useConnectionsStore } from './connections'
import { applyAutoLimit } from '../utils/queryTransform'
import type { GoogleUserInfo, GoogleTokenResponse } from '../types/google-oauth'
import type { BigQueryProject } from '../types/bigquery'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// Google OAuth configuration
const SCOPES = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform.read-only' // To list projects
].join(' ')

interface QueryResult {
  rows: Record<string, any>[]
  stats: {
    totalBytesProcessed?: string
    cacheHit?: boolean
  }
}

export const useAuthStore = defineStore('auth', () => {
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

  // Computed properties for backward compatibility
  const accessToken = computed(() => connectionsStore.activeConnection?.token || null)
  const userEmail = computed(() => connectionsStore.activeConnection?.email || null)
  const userName = computed(() => connectionsStore.activeConnection?.name || null)
  const userPhoto = computed(() => connectionsStore.activeConnection?.photo || null)

  const isAuthenticated = computed(() => {
    return connectionsStore.activeConnection !== null &&
           !connectionsStore.isActiveTokenExpired
  })

  // For backward compatibility - projects list
  const projects = ref<BigQueryProject[]>([])

  // Initialize Google Sign-In
  let tokenClient: any = null

  const initGoogleAuth = (): Promise<void> => {
    return new Promise((resolve) => {
      // Load Google Identity Services library
      if (window.google?.accounts?.oauth2) {
        resolve()
        return
      }

      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      document.head.appendChild(script)
    })
  }

  // Sign in with Google
  const signInWithGoogle = async (): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    await initGoogleAuth()

    return new Promise((resolve, reject) => {
      tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (response: GoogleTokenResponse) => {
          if (response.error) {
            reject(new Error(response.error))
            return
          }

          try {
            const token = response.access_token

            // Get user info
            const userInfo = await fetchUserInfo(token)

            // Add connection via connections store
            connectionsStore.addConnection('bigquery', userInfo, token)

            // Try to get default project
            await fetchDefaultProject()

            resolve()
          } catch (err) {
            reject(err)
          }
        },
      })

      tokenClient.requestAccessToken()
    })
  }

  // Fetch user info from Google
  const fetchUserInfo = async (token: string): Promise<GoogleUserInfo> => {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (response.ok) {
      const data = await response.json()
      return {
        email: data.email,
        name: data.name,
        photo: data.picture
      }
    }

    throw new Error('Failed to fetch user info')
  }

  // Fetch default project (first accessible project)
  const fetchDefaultProject = async () => {
    if (!accessToken.value) return

    try {
      const response = await fetch(
        'https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=1',
        {
          headers: {
            'Authorization': `Bearer ${accessToken.value}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.projects && data.projects.length > 0) {
          projectId.value = data.projects[0].projectId
        }
      }
    } catch (err) {
      console.warn('Could not fetch default project:', err)
      // Not critical - user can set project manually
    }
  }

  // Fetch list of available projects
  const fetchProjects = async (): Promise<BigQueryProject[]> => {
    if (!accessToken.value) {
      throw new Error('Not authenticated')
    }

    const response = await fetch(
      'https://cloudresourcemanager.googleapis.com/v1/projects',
      {
        headers: {
          'Authorization': `Bearer ${accessToken.value}`
        }
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch projects')
    }

    const data = await response.json()
    projects.value = data.projects || []
    return projects.value
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

  // Reconnect an existing connection
  const reconnectConnection = async (connectionId: string): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    await initGoogleAuth()

    return new Promise((resolve, reject) => {
      tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (response: GoogleTokenResponse) => {
          if (response.error) {
            reject(new Error(response.error))
            return
          }

          try {
            const token = response.access_token

            // Get user info
            const userInfo = await fetchUserInfo(token)

            // Update connection via connections store
            connectionsStore.reconnectConnection(connectionId, token, userInfo)

            resolve()
          } catch (err) {
            reject(err)
          }
        },
      })

      tokenClient.requestAccessToken()
    })
  }

  // Sign out
  const signOut = () => {
    const currentToken = accessToken.value

    // Remove connection via connections store
    if (connectionsStore.activeConnectionId) {
      connectionsStore.removeConnection(connectionsStore.activeConnectionId)
    }

    projectId.value = null
    localStorage.removeItem('squill-project')

    // Revoke Google token
    if (currentToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(currentToken, () => {
        console.log('Token revoked')
      })
    }
  }

  // Fetch datasets for a project
  const fetchDatasets = async (targetProjectId: string | null = null) => {
    if (!isAuthenticated.value) {
      throw new Error('Not authenticated')
    }

    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken.value}`
        }
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch datasets')
    }

    const data = await response.json()
    return data.datasets || []
  }

  // Fetch tables for a dataset
  const fetchTables = async (datasetId: string, targetProjectId: string | null = null) => {
    if (!isAuthenticated.value) {
      throw new Error('Not authenticated')
    }

    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken.value}`
        }
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch tables')
    }

    const data = await response.json()
    return data.tables || []
  }

  // Fetch table schema
  const fetchTableSchema = async (datasetId: string, tableId: string, targetProjectId: string | null = null) => {
    if (!isAuthenticated.value) {
      throw new Error('Not authenticated')
    }

    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${datasetId}/tables/${tableId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken.value}`
        }
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch table schema')
    }

    const data = await response.json()
    return data.schema?.fields || []
  }

  // Run BigQuery query
  const runQuery = async (query: string, signal: AbortSignal | null = null): Promise<QueryResult> => {
    if (!isAuthenticated.value) {
      throw new Error('Please sign in with Google first')
    }

    if (!projectId.value) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    // Check if token is expired
    if (connectionsStore.isActiveTokenExpired) {
      throw new Error('Session expired. Please reconnect your account.')
    }

    // Apply auto-limit transformation
    const settingsStore = useSettingsStore()
    const transformedQuery = applyAutoLimit(
      query,
      settingsStore.autoLimitEnabled,
      settingsStore.autoLimitValue
    )

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: transformedQuery,
        useLegacySql: false,
        useQueryCache: true,
      }),
    }

    // Add signal if provided
    if (signal) {
      fetchOptions.signal = signal
    }

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId.value}/queries`,
      fetchOptions
    )

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
    if (!isAuthenticated.value) {
      throw new Error('Not authenticated')
    }

    const project = targetProjectId || projectId.value
    if (!project) {
      throw new Error('No project specified')
    }

    // Import schema store
    const { useSchemaStore } = await import('./schema')
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
  }
})
