<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConnectionsStore } from '../stores/connections'
import { useBigQueryStore } from '../stores/bigquery'
import { useUserStore } from '../stores/user'

const router = useRouter()
const connectionsStore = useConnectionsStore()
const bigqueryStore = useBigQueryStore()
const userStore = useUserStore()

const status = ref<'loading' | 'error'>('loading')
const errorMessage = ref('')

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

/**
 * Parse the OAuth state to extract CSRF token and flow type.
 * State format: {csrf_token}:{flow_type} or {csrf_token}:{flow_type}:{chain_action}
 * Examples:
 * - "abc123:login" -> login flow
 * - "abc123:login:then-bigquery" -> login flow, then chain BigQuery auth
 * - "abc123:bigquery" -> BigQuery connection flow
 */
const parseOAuthState = (state: string): { csrfToken: string; flowType: string; chainAction?: string } => {
  const parts = state.split(':')
  if (parts.length < 2) {
    return { csrfToken: state, flowType: 'bigquery' } // Legacy format - assume BigQuery flow
  }
  return {
    csrfToken: parts[0],
    flowType: parts[1],
    chainAction: parts[2]
  }
}

/**
 * Handle login-only OAuth flow.
 * Creates/updates user account without BigQuery connection.
 */
const handleLoginFlow = async (code: string): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/auth/google/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: `${window.location.origin}/auth/callback`,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.detail || 'Failed to authenticate')
  }

  const data = await response.json()

  // Store user account info and session token (also syncs connections for Pro/VIP)
  await userStore.setUser({
    id: data.user.id,
    email: data.user.email,
    plan: data.user.plan,
    isVip: data.user.is_vip ?? false,
    planExpiresAt: data.user.plan_expires_at ?? null,
    subscriptionCancelAtPeriodEnd: data.user.subscription_cancel_at_period_end ?? false,
    authProvider: 'google',
  }, data.session_token)
}

/**
 * Handle GitHub OAuth login flow.
 * Creates/updates user account using verified GitHub email.
 */
const handleGitHubLoginFlow = async (code: string): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/auth/github/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: `${window.location.origin}/auth/callback`,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.detail || 'Failed to authenticate with GitHub')
  }

  const data = await response.json()

  await userStore.setUser({
    id: data.user.id,
    email: data.user.email,
    plan: data.user.plan,
    isVip: data.user.is_vip ?? false,
    planExpiresAt: data.user.plan_expires_at ?? null,
    subscriptionCancelAtPeriodEnd: data.user.subscription_cancel_at_period_end ?? false,
    authProvider: 'github',
  }, data.session_token)
}

/**
 * Handle BigQuery connection OAuth flow.
 * Creates BigQuery connection with refresh token.
 */
const handleBigQueryFlow = async (code: string): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/auth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: `${window.location.origin}/auth/callback`,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.detail || 'Failed to authenticate')
  }

  const data = await response.json()

  // Store user account info and session token (also syncs connections for Pro/VIP)
  await userStore.setUser({
    id: data.user.id,
    email: data.user.email,
    plan: data.user.plan,
    isVip: data.user.is_vip ?? false,
    planExpiresAt: data.user.plan_expires_at ?? null,
    subscriptionCancelAtPeriodEnd: data.user.subscription_cancel_at_period_end ?? false,
    authProvider: 'google',
  }, data.session_token)

  // Add connection with access token (stored in memory)
  const connectionId = connectionsStore.addBigQueryConnection(
    data.user.email,
    data.access_token,
    data.expires_in
  )

  // Fetch projects, restore previous selection or pick first, and load schemas
  try {
    await bigqueryStore.ready
    const projects = await bigqueryStore.fetchProjects()
    if (projects.length > 0) {
      // Prefer the previously selected project if it still exists
      const savedProjectId = bigqueryStore.projectId
      const targetProjectId = savedProjectId && projects.some(p => p.projectId === savedProjectId)
        ? savedProjectId
        : projects[0].projectId
      bigqueryStore.setProjectId(targetProjectId)
      connectionsStore.setConnectionProjectId(connectionId, targetProjectId)
      connectionsStore.addSchemaProject(connectionId, targetProjectId)

      // Populate schema store so SQL autocompletion works immediately
      try {
        await bigqueryStore.fetchAllSchemas(targetProjectId)
      } catch (schemaErr) {
        console.warn('Could not fetch schemas:', schemaErr)
      }
    }
  } catch (err) {
    console.warn('Could not auto-select project:', err)
    // Continue anyway - user can manually select
  }
}

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get('code')
  const state = urlParams.get('state')
  const error = urlParams.get('error')

  // Handle OAuth errors
  if (error) {
    status.value = 'error'
    errorMessage.value = `OAuth error: ${error}`
    return
  }

  if (!code) {
    status.value = 'error'
    errorMessage.value = 'No authorization code received'
    return
  }

  // Validate state (CSRF protection)
  const savedState = sessionStorage.getItem('squill-oauth-state')
  if (!savedState) {
    status.value = 'error'
    errorMessage.value = 'Invalid state parameter. Please try signing in again.'
    return
  }

  // Parse the state to determine flow type
  const { csrfToken, flowType, chainAction } = parseOAuthState(savedState)
  const receivedCsrf = state ? parseOAuthState(state).csrfToken : null

  // Validate CSRF token
  if (receivedCsrf !== csrfToken) {
    status.value = 'error'
    errorMessage.value = 'Invalid state parameter. Please try signing in again.'
    return
  }

  // Clear the state
  sessionStorage.removeItem('squill-oauth-state')

  try {
    // Route to appropriate handler based on flow type
    if (flowType === 'login' && chainAction === 'then-bigquery') {
      // Login flow with BigQuery chain (incremental auth for new users adding BigQuery)
      await handleLoginFlow(code)
      // After login completes, automatically start BigQuery OAuth flow
      await bigqueryStore.signInWithGoogle()
      // Note: signInWithGoogle redirects to Google, so we won't reach here
    } else if (flowType === 'login') {
      // Login-only flow (user just wants to sign in without adding BigQuery)
      await handleLoginFlow(code)
      router.push('/app')
    } else if (flowType === 'github-login') {
      // GitHub OAuth login flow
      await handleGitHubLoginFlow(code)
      router.push('/app')
    } else {
      // BigQuery connection flow (default, including legacy states)
      await handleBigQueryFlow(code)
      router.push('/app')
    }
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
    <div
      v-if="status === 'loading'"
      class="loading"
    >
      <div class="spinner" />
      <p>Completing sign in...</p>
    </div>
    <div
      v-else-if="status === 'error'"
      class="error"
    >
      <h2>Authentication Failed</h2>
      <p>{{ errorMessage }}</p>
      <button @click="goHome">
        Go Home
      </button>
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

.loading, .error {
  text-align: center;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--border-secondary);
  border-top-color: var(--color-bigquery);
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error h2 {
  color: var(--color-error);
  margin-bottom: 8px;
}

.error p {
  color: var(--text-secondary);
  margin-bottom: 24px;
}

.error button {
  background: var(--color-bigquery);
  color: white;
  border: none;
  padding: 12px 24px;
  cursor: pointer;
  font-size: 14px;
}

.error button:hover {
  filter: brightness(0.85);
}
</style>
