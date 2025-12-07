import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { SignJWT, importPKCS8 } from 'jose'

const STORAGE_KEY = 'sqlshell-auth'

// Load auth data from localStorage
const loadAuthData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch (err) {
    console.error('Failed to load auth data from localStorage:', err)
    return {}
  }
}

// Save auth data to localStorage
const saveAuthData = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save auth data to localStorage:', err)
  }
}

export const useAuthStore = defineStore('auth', () => {
  const savedAuth = loadAuthData()

  const serviceAccountData = ref(savedAuth.serviceAccountData || null)
  const accessToken = ref(null) // Don't persist tokens
  const tokenExpiry = ref(null) // Don't persist expiry
  const projectId = ref(savedAuth.projectId || null)

  const isAuthenticated = computed(() => !!serviceAccountData.value)

  // Get access token using service account
  const getAccessToken = async () => {
    if (!serviceAccountData.value) {
      throw new Error('No service account credentials loaded')
    }

    // Check if we have a valid token
    if (accessToken.value && tokenExpiry.value && Date.now() < tokenExpiry.value) {
      return accessToken.value
    }

    const sa = serviceAccountData.value
    const now = Math.floor(Date.now() / 1000)

    // Create JWT
    const privateKey = await importPKCS8(sa.private_key, 'RS256')

    const jwt = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/bigquery',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey)

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error_description || 'Failed to get access token')
    }

    const data = await response.json()
    accessToken.value = data.access_token
    tokenExpiry.value = Date.now() + (data.expires_in * 1000) - 60000 // Refresh 1 min early

    return accessToken.value
  }

  // Load service account from JSON
  const loadServiceAccount = async (credentialsJson) => {
    // Validate it's a service account
    if (!credentialsJson.private_key || !credentialsJson.client_email || !credentialsJson.project_id) {
      throw new Error('Invalid service account JSON file')
    }

    serviceAccountData.value = credentialsJson
    projectId.value = credentialsJson.project_id

    // Get initial access token
    await getAccessToken()
  }

  // Watch for changes and persist to localStorage
  watch([serviceAccountData, projectId], () => {
    if (serviceAccountData.value) {
      saveAuthData({
        serviceAccountData: serviceAccountData.value,
        projectId: projectId.value,
      })
    } else {
      // Clear localStorage when credentials are cleared
      localStorage.removeItem(STORAGE_KEY)
    }
  })

  // Clear credentials
  const clearCredentials = () => {
    serviceAccountData.value = null
    accessToken.value = null
    tokenExpiry.value = null
    projectId.value = null
  }

  // Run BigQuery query
  const runQuery = async (query) => {
    if (!isAuthenticated.value) {
      throw new Error('Please upload service account credentials first')
    }

    const token = await getAccessToken()

    // Call BigQuery REST API
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId.value}/queries`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
        }),
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Query execution failed')
    }

    const data = await response.json()

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
      return rows
    }

    return []
  }

  return {
    serviceAccountData,
    projectId,
    isAuthenticated,
    loadServiceAccount,
    clearCredentials,
    runQuery,
  }
})
