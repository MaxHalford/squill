<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useOAuthSettingsStore } from '../stores/oauthSettings'
import { useDialog } from '../composables/useDialog'
import { isTauri } from '../utils/tauri'
import { getOAuthEnvOverrides, type OAuthConfigSource } from '../services/oauth/googleClientConfig'

const { confirm } = useDialog()

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const oauthSettings = useOAuthSettingsStore()
const isDesktop = isTauri()

const clientIdInput = ref('')
const clientSecretInput = ref('')
const secretVisible = ref(false)
const envOverrideActive = ref(false)
const helpOpen = ref(false)
const saveStatus = ref<'idle' | 'saved'>('idle')
const activeSource = ref<OAuthConfigSource>('none')

const recomputeSource = () => {
  if (envOverrideActive.value) {
    activeSource.value = 'env'
  } else if (oauthSettings.googleClientId && oauthSettings.googleClientSecret) {
    activeSource.value = 'user'
  } else {
    const bundledId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
    const bundledSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET || ''
    activeSource.value = bundledId && bundledSecret ? 'bundled' : 'none'
  }
}

onMounted(async () => {
  if (!isDesktop) return
  await oauthSettings.ready
  clientIdInput.value = oauthSettings.googleClientId
  clientSecretInput.value = oauthSettings.googleClientSecret
  const env = await getOAuthEnvOverrides()
  envOverrideActive.value = !!(env.googleClientId && env.googleClientSecret)
  recomputeSource()
})

watch([() => oauthSettings.googleClientId, () => oauthSettings.googleClientSecret], recomputeSource)

const handleSave = async () => {
  await oauthSettings.setGoogleCredentials(clientIdInput.value, clientSecretInput.value)
  saveStatus.value = 'saved'
  setTimeout(() => { saveStatus.value = 'idle' }, 2000)
}

const handleReset = async () => {
  const confirmed = await confirm('Clear your custom Google OAuth client and fall back to the bundled default?')
  if (!confirmed) return
  await oauthSettings.clearGoogleCredentials()
  clientIdInput.value = ''
  clientSecretInput.value = ''
}

const sourceLabel = (source: OAuthConfigSource): string => {
  switch (source) {
    case 'env': return 'Environment variable override'
    case 'user': return 'Your custom OAuth client'
    case 'bundled': return 'Bundled Squill default'
    case 'none': return 'Not configured'
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bq-oauth-modal-title"
        @click.self="emit('close')"
      >
        <div class="modal-content">
          <div class="modal-header">
            <h3
              id="bq-oauth-modal-title"
              class="modal-title"
            >
              BigQuery OAuth client
            </h3>
            <button
              class="modal-close"
              @click="emit('close')"
            >
              &times;
            </button>
          </div>
          <div class="modal-body">
            <p class="intro">
              By default Squill uses a bundled Google OAuth client to sign in to BigQuery. If your organization restricts third-party OAuth apps, paste a client ID and secret from your own GCP project here.
            </p>

            <div class="source-row">
              <span class="source-label">Active credentials:</span>
              <span
                class="source-value"
                :class="`source-${activeSource}`"
              >{{ sourceLabel(activeSource) }}</span>
            </div>

            <div
              v-if="envOverrideActive"
              class="banner"
            >
              Environment variables <code>SQUILL_GOOGLE_CLIENT_ID</code> and <code>SQUILL_GOOGLE_CLIENT_SECRET</code> are set, so they take precedence over the values below.
            </div>

            <div class="input-row">
              <label class="input-label">Client ID</label>
              <input
                v-model="clientIdInput"
                type="text"
                class="text-input"
                placeholder="123456789-abcdef.apps.googleusercontent.com"
                spellcheck="false"
                autocomplete="off"
              >
            </div>

            <div class="input-row">
              <label class="input-label">Client secret</label>
              <div class="secret-wrapper">
                <input
                  v-model="clientSecretInput"
                  :type="secretVisible ? 'text' : 'password'"
                  class="text-input"
                  placeholder="GOCSPX-..."
                  spellcheck="false"
                  autocomplete="off"
                >
                <button
                  type="button"
                  class="secret-toggle"
                  @click="secretVisible = !secretVisible"
                >
                  {{ secretVisible ? 'Hide' : 'Show' }}
                </button>
              </div>
            </div>

            <div class="button-row">
              <button
                class="save-button"
                :disabled="!clientIdInput || !clientSecretInput"
                @click="handleSave"
              >
                {{ saveStatus === 'saved' ? 'Saved' : 'Save' }}
              </button>
              <button
                class="reset-button"
                :disabled="!oauthSettings.googleClientId && !oauthSettings.googleClientSecret"
                @click="handleReset"
              >
                Use bundled default
              </button>
            </div>

            <div class="env-var-note">
              <strong>Prefer environment variables?</strong> Set <code>SQUILL_GOOGLE_CLIENT_ID</code> and <code>SQUILL_GOOGLE_CLIENT_SECRET</code> in the environment Squill is launched from. They override the values above. Useful for IT-managed deployments.
            </div>

            <button
              type="button"
              class="help-toggle"
              @click="helpOpen = !helpOpen"
            >
              {{ helpOpen ? 'Hide setup steps' : 'How to create an OAuth client in GCP' }}
            </button>

            <div
              v-if="helpOpen"
              class="help"
            >
              <ol class="help-list">
                <li>Open the <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener"
                >GCP Credentials page</a> in the project you want Squill to use.</li>
                <li>Click <em>Create credentials → OAuth client ID</em>.</li>
                <li>Application type: <strong>Desktop app</strong>.</li>
                <li>Enable the <strong>BigQuery API</strong> in the same project.</li>
                <li>On the OAuth consent screen, add scopes: <code>userinfo.email</code>, <code>bigquery.readonly</code>, <code>cloud-platform.read-only</code>.</li>
                <li>Copy the client ID and secret into the fields above and save.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-content {
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  flex-shrink: 0;
}

.modal-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.modal-close:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--space-3);
  overflow-y: auto;
  flex: 1;
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  line-height: var(--line-height-relaxed);
}

.intro {
  margin: 0 0 var(--space-3) 0;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
}

.source-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: var(--font-size-body-sm);
}

.source-label {
  color: var(--text-secondary);
}

.source-value {
  font-family: var(--font-family-mono);
  color: var(--text-primary);
}

.source-env,
.source-user {
  color: var(--color-accent);
  font-weight: 600;
}

.source-none {
  color: #dc3545;
}

.banner {
  padding: var(--space-2);
  margin-bottom: var(--space-3);
  background: var(--surface-secondary);
  border-left: 2px solid var(--color-accent);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
}

.banner code {
  font-family: var(--font-family-mono);
  background: var(--surface-primary);
  padding: 0 4px;
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}

.input-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.text-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: var(--border-width-thin) solid var(--border-secondary);
  background: var(--surface-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.text-input:focus {
  border-color: var(--color-accent);
}

.secret-wrapper {
  display: flex;
  gap: var(--space-1);
}

.secret-wrapper .text-input {
  flex: 1;
}

.secret-toggle {
  padding: var(--space-1) var(--space-2);
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  cursor: pointer;
}

.secret-toggle:hover {
  background: var(--surface-primary);
}

.button-row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  margin-bottom: var(--space-3);
}

.save-button {
  flex: 1;
  padding: var(--space-2);
  background: var(--text-primary);
  color: var(--surface-primary);
  border: none;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  cursor: pointer;
}

.save-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.reset-button {
  padding: var(--space-2) var(--space-3);
  background: transparent;
  color: var(--text-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
}

.reset-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.help-toggle {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  padding: var(--space-1) 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.help {
  margin-top: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-secondary);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  line-height: var(--line-height-relaxed);
}

.help-list {
  margin: 0 0 var(--space-2) 0;
  padding-left: var(--space-3);
}

.help-list li {
  margin-bottom: var(--space-1);
}

.help-list code,
.env-var-note code {
  font-family: var(--font-family-mono);
  background: var(--surface-primary);
  padding: 0 4px;
}

.help-list a {
  color: var(--color-accent);
}

.env-var-note {
  margin-bottom: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-secondary);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
}

.env-var-note strong {
  color: var(--text-primary);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-active .modal-content,
.modal-fade-leave-active .modal-content {
  transition: transform 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .modal-content {
  transform: scale(0.95);
}

.modal-fade-leave-to .modal-content {
  transform: scale(0.95);
}
</style>
