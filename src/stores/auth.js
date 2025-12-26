import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settings'
import { applyAutoLimit } from '../utils/queryTransform'

const STORAGE_KEY = 'squill-auth'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// Token validity: 7 days
const TOKEN_EXPIRY_DAYS = 7
const TOKEN_EXPIRY_MS = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000

// Google OAuth configuration
const SCOPES = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform.read-only' // To list projects
].join(' ')

const loadAuthData = () => {
  try {
    // Try localStorage first (for 7-day persistence)
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch (err) {
    console.error('Failed to load auth data:', err)
    return {}
  }
}

const saveAuthData = (data) => {
  try {
    // Use localStorage for 7-day persistence
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save auth data:', err)
  }
}

export const useAuthStore = defineStore('auth', () => {
  const savedAuth = loadAuthData()

  // OAuth state
  const accessToken = ref(savedAuth.accessToken || null)
  const tokenExpiry = ref(savedAuth.tokenExpiry || null)
  const userEmail = ref(savedAuth.userEmail || null)
  const userName = ref(savedAuth.userName || null)
  const userPhoto = ref(savedAuth.userPhoto || null)
  const projectId = ref(savedAuth.projectId || null)

  const isAuthenticated = computed(() => {
    // Check if token exists and hasn't expired (7 days)
    return !!accessToken.value && tokenExpiry.value && Date.now() < tokenExpiry.value
  })

  // Initialize Google Sign-In
  let tokenClient = null

  const initGoogleAuth = () => {
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
      script.onload = resolve
      document.head.appendChild(script)
    })
  }

  // Sign in with Google
  const signInWithGoogle = async () => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    await initGoogleAuth()

    return new Promise((resolve, reject) => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error))
            return
          }

          try {
            // Store access token
            accessToken.value = response.access_token
            // Set expiry to 7 days from now
            tokenExpiry.value = Date.now() + TOKEN_EXPIRY_MS

            // Get user info
            await fetchUserInfo()

            // Try to get default project
            await fetchDefaultProject()

            // Save to localStorage (for 7-day persistence)
            saveAuthData({
              accessToken: accessToken.value,
              tokenExpiry: tokenExpiry.value,
              userEmail: userEmail.value,
              userName: userName.value,
              userPhoto: userPhoto.value,
              projectId: projectId.value
            })

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
  const fetchUserInfo = async () => {
    if (!accessToken.value) return

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken.value}`
      }
    })

    if (response.ok) {
      const data = await response.json()
      userEmail.value = data.email
      userName.value = data.name
      userPhoto.value = data.picture
    }
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
  const fetchProjects = async () => {
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
    return data.projects || []
  }

  // Set active project
  const setProjectId = (newProjectId) => {
    projectId.value = newProjectId
    saveAuthData({
      accessToken: accessToken.value,
      tokenExpiry: tokenExpiry.value,
      userEmail: userEmail.value,
      userName: userName.value,
      userPhoto: userPhoto.value,
      projectId: projectId.value
    })
  }

  // Sign out
  const signOut = () => {
    const currentToken = accessToken.value

    accessToken.value = null
    tokenExpiry.value = null
    userEmail.value = null
    userName.value = null
    userPhoto.value = null
    projectId.value = null
    localStorage.removeItem(STORAGE_KEY)

    // Revoke Google token
    if (currentToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(currentToken, () => {
        console.log('Token revoked')
      })
    }
  }

  // Fetch datasets for a project
  const fetchDatasets = async (targetProjectId = null) => {
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
  const fetchTables = async (datasetId, targetProjectId = null) => {
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
  const fetchTableSchema = async (datasetId, tableId, targetProjectId = null) => {
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
  const runQuery = async (query, signal = null) => {
    if (!isAuthenticated.value) {
      throw new Error('Please sign in with Google first')
    }

    if (!projectId.value) {
      throw new Error('No project selected. Please select a project in the sidebar.')
    }

    // Check if token is expired
    if (Date.now() >= tokenExpiry.value) {
      throw new Error('Session expired. Please sign in again.')
    }

    // Apply auto-limit transformation
    const settingsStore = useSettingsStore()
    const transformedQuery = applyAutoLimit(
      query,
      settingsStore.autoLimitEnabled,
      settingsStore.autoLimitValue
    )

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: transformedQuery,
        useLegacySql: false,
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
      totalBytesProcessed: data.totalBytesProcessed || '0'
    }

    // Transform BigQuery response to table format
    if (data.schema && data.rows) {
      const fieldNames = data.schema.fields.map(f => f.name)
      const rows = data.rows.map(row => {
        const obj = {}
        fieldNames.forEach((name, i) => {
          obj[name] = row.f[i].v
        })
        return obj
      })
      return { rows, stats }
    }

    return { rows: [], stats }
  }

  return {
    accessToken,
    userEmail,
    userName,
    userPhoto,
    projectId,
    isAuthenticated,
    signInWithGoogle,
    signOut,
    fetchProjects,
    setProjectId,
    fetchDatasets,
    fetchTables,
    fetchTableSchema,
    runQuery,
  }
})
