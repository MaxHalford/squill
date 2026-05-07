<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { BACKEND_URL } from '@/services/backend'

interface PendingResponse {
  client_name: string | null
  redirect_uri_host: string
  scope: string | null
}

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const status = ref<'loading' | 'ready' | 'submitting' | 'error'>('loading')
const errorMessage = ref('')
const pending = ref<PendingResponse | null>(null)

const requestId = computed(() => {
  const v = route.query.request_id
  return typeof v === 'string' ? v : null
})

const clientLabel = computed(() => pending.value?.client_name?.trim() || 'An MCP client')

const isPro = computed(() => userStore.isPro)

const fetchPending = async (id: string) => {
  const res = await fetch(`${BACKEND_URL}/oauth/pending/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${userStore.sessionToken}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error_description || body.error || 'Failed to load authorization request')
  }
  return await res.json() as PendingResponse
}

const submit = async (decision: 'allow' | 'deny') => {
  if (!requestId.value) return
  status.value = 'submitting'
  errorMessage.value = ''
  try {
    const res = await fetch(`${BACKEND_URL}/oauth/authorize/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userStore.sessionToken}`,
      },
      body: JSON.stringify({ request_id: requestId.value, decision }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error_description || body.error || 'Failed to submit decision')
    }
    const data = await res.json() as { redirect_url: string }
    window.location.assign(data.redirect_url)
  } catch (err) {
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'Unknown error'
  }
}

const goUpgrade = () => {
  router.push('/account')
}

onMounted(async () => {
  await userStore.ready

  if (!requestId.value) {
    status.value = 'error'
    errorMessage.value = 'Missing request_id'
    return
  }

  if (!userStore.sessionToken) {
    sessionStorage.setItem('squill-login-next', `/oauth/consent?request_id=${encodeURIComponent(requestId.value)}`)
    router.replace('/account')
    return
  }

  try {
    pending.value = await fetchPending(requestId.value)
    status.value = 'ready'
  } catch (err) {
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'Unknown error'
  }
})
</script>

<template>
  <div class="consent-page">
    <div class="consent-card">
      <h1>Authorize MCP access</h1>

      <div
        v-if="status === 'loading'"
        class="loading"
      >
        <div class="spinner" />
        <p>Loading authorization request…</p>
      </div>

      <div
        v-else-if="status === 'error'"
        class="error"
      >
        <p>{{ errorMessage }}</p>
        <button
          class="secondary-button"
          @click="router.push('/app')"
        >
          Go to app
        </button>
      </div>

      <template v-else-if="pending">
        <p class="lede">
          <strong>{{ clientLabel }}</strong> wants access to your Squill canvases via the Model Context Protocol.
        </p>

        <dl class="details">
          <div>
            <dt>Will be redirected to</dt>
            <dd><code>{{ pending.redirect_uri_host }}</code></dd>
          </div>
          <div v-if="pending.scope">
            <dt>Scope</dt>
            <dd><code>{{ pending.scope }}</code></dd>
          </div>
          <div>
            <dt>Signed in as</dt>
            <dd>{{ userStore.email }}</dd>
          </div>
        </dl>

        <div
          v-if="!isPro"
          class="upgrade-banner"
        >
          <p>
            MCP access is a <strong>Pro</strong> feature. Upgrade your account to let MCP-compatible AI agents access your canvases.
          </p>
          <button
            class="primary-button"
            @click="goUpgrade"
          >
            Upgrade to Pro
          </button>
        </div>

        <div class="actions">
          <button
            class="secondary-button"
            :disabled="status === 'submitting'"
            @click="submit('deny')"
          >
            Deny
          </button>
          <button
            class="primary-button"
            :disabled="status === 'submitting' || !isPro"
            @click="submit('allow')"
          >
            Allow
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.consent-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-secondary, #f5f5f5);
  color: var(--text-primary);
  padding: 24px;
}

.consent-card {
  width: 100%;
  max-width: 520px;
  background: var(--surface-primary, white);
  border: 2px solid var(--surface-inverse, black);
  padding: 32px;
  box-shadow: 6px 6px 0 var(--surface-inverse, black);
}

h1 {
  font-size: 22px;
  margin: 0 0 16px;
  letter-spacing: 0.02em;
}

.lede {
  font-size: 15px;
  line-height: 1.5;
  margin: 0 0 20px;
}

.details {
  margin: 0 0 24px;
  padding: 16px;
  background: var(--surface-secondary, #f9f9f9);
  border: 2px solid var(--surface-inverse, black);
  display: grid;
  gap: 12px;
}

.details > div {
  display: grid;
  grid-template-columns: 160px 1fr;
  align-items: baseline;
  gap: 12px;
}

.details dt {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0;
}

.details dd {
  margin: 0;
  font-size: 14px;
  word-break: break-all;
}

code {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 13px;
  background: var(--surface-primary, white);
  padding: 1px 6px;
  border: 1px solid var(--surface-inverse, black);
}

.upgrade-banner {
  background: var(--color-warning-bg, #fff7d1);
  border: 2px solid var(--surface-inverse, black);
  padding: 16px;
  margin-bottom: 24px;
}

.upgrade-banner p {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.5;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.primary-button,
.secondary-button {
  font-family: inherit;
  font-size: 14px;
  padding: 10px 20px;
  border: 2px solid var(--surface-inverse, black);
  cursor: pointer;
  letter-spacing: 0.02em;
}

.primary-button {
  background: var(--surface-inverse, black);
  color: var(--surface-primary, white);
}

.primary-button:hover:not(:disabled) {
  filter: brightness(0.85);
}

.primary-button:disabled {
  background: var(--text-secondary, #888);
  cursor: not-allowed;
}

.secondary-button {
  background: transparent;
  color: var(--text-primary);
}

.secondary-button:hover:not(:disabled) {
  background: var(--surface-secondary, #f5f5f5);
}

.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading,
.error {
  text-align: center;
  padding: 16px 0;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border-secondary, #ddd);
  border-top-color: var(--surface-inverse, black);
  animation: spin 1s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error p {
  color: var(--color-error, #c62828);
  margin-bottom: 16px;
}
</style>
