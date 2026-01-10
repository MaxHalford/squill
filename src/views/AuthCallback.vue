<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConnectionsStore } from '../stores/connections'

const router = useRouter()
const connectionsStore = useConnectionsStore()

const status = ref<'loading' | 'error'>('loading')
const errorMessage = ref('')

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

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
  if (!savedState || state !== savedState) {
    status.value = 'error'
    errorMessage.value = 'Invalid state parameter. Please try signing in again.'
    return
  }

  // Clear the state
  sessionStorage.removeItem('squill-oauth-state')

  try {
    // Exchange code for tokens via backend
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

    // Add connection with access token (stored in memory)
    connectionsStore.addBigQueryConnection(
      data.user.email,
      data.access_token,
      data.expires_in
    )

    // Redirect to app
    router.push('/app')
  } catch (err: any) {
    status.value = 'error'
    errorMessage.value = err.message || 'Authentication failed'
  }
})

const goHome = () => {
  router.push('/')
}
</script>

<template>
  <div class="auth-callback">
    <div v-if="status === 'loading'" class="loading">
      <div class="spinner"></div>
      <p>Completing sign in...</p>
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
  background: #1a1a2e;
  color: #fff;
}

.loading, .error {
  text-align: center;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #333;
  border-top-color: #4285f4;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error h2 {
  color: #ff6b6b;
  margin-bottom: 8px;
}

.error p {
  color: #aaa;
  margin-bottom: 24px;
}

.error button {
  background: #4285f4;
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.error button:hover {
  background: #3367d6;
}
</style>
