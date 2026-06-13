<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConnectionsStore } from '../stores/connections'
import { useBigQueryStore } from '../stores/bigquery'
import { completeBigQueryAuth } from '../services/oauth/bigqueryAuth'
import { getGoogleOAuthConfig } from '../services/oauth/googleClientConfig'

const router = useRouter()
const connectionsStore = useConnectionsStore()
const bigqueryStore = useBigQueryStore()

const status = ref<'loading' | 'error'>('loading')
const errorMessage = ref('')

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')

  if (error) {
    status.value = 'error'
    errorMessage.value = `OAuth error: ${error}`
    return
  }
  if (!code || !state) {
    status.value = 'error'
    errorMessage.value = 'Missing code or state parameter.'
    return
  }

  try {
    const { clientId, clientSecret } = await getGoogleOAuthConfig()
    if (!clientId) {
      throw new Error('Google OAuth client is not configured.')
    }
    const tokens = await completeBigQueryAuth(clientId, clientSecret, code, state)

    const connectionId = connectionsStore.addBigQueryConnection(
      tokens.email,
      tokens.accessToken,
      tokens.expiresIn,
      tokens.refreshToken,
    )

    // Fetch projects, pick a default, and load schemas — same UX as before
    try {
      await bigqueryStore.ready
      const projects = await bigqueryStore.fetchProjects()
      if (projects.length > 0) {
        const savedProjectId = bigqueryStore.projectId
        const targetProjectId = savedProjectId && projects.some(p => p.projectId === savedProjectId)
          ? savedProjectId
          : projects[0].projectId
        bigqueryStore.setProjectId(targetProjectId)
        connectionsStore.setConnectionProjectId(connectionId, targetProjectId)
        connectionsStore.addSchemaProject(connectionId, targetProjectId)
        try {
          await bigqueryStore.fetchAllSchemas(targetProjectId)
        } catch (schemaErr) {
          console.warn('Could not fetch schemas:', schemaErr)
        }
      }
    } catch (err) {
      console.warn('Could not auto-select project:', err)
    }

    router.push('/app')
  } catch (err: unknown) {
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'Authentication failed'
  }
})

const goHome = () => {
  router.push('/app')
}
</script>

<template>
  <div class="auth-callback">
    <div v-if="status === 'loading'" class="loading">
      <div class="spinner" />
      <p>Completing BigQuery sign in...</p>
    </div>
    <div v-else-if="status === 'error'" class="error">
      <h2>Authentication Failed</h2>
      <p>{{ errorMessage }}</p>
      <button @click="goHome">Go Home</button>
    </div>
  </div>
</template>

<style scoped>
.auth-callback {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--surface-primary);
  color: var(--text-primary);
}
.loading, .error { text-align: center; }
.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--border-secondary);
  border-top-color: var(--color-bigquery);
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.error h2 { color: var(--color-error); margin-bottom: 8px; }
.error p { color: var(--text-secondary); margin-bottom: 24px; }
.error button {
  background: var(--color-bigquery);
  color: white;
  border: none;
  padding: 12px 24px;
  cursor: pointer;
  font-size: 14px;
}
.error button:hover { filter: brightness(0.85); }
</style>
