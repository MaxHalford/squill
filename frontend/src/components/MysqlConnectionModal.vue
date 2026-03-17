<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useMysqlStore } from '../stores/mysql'
import { DATABASE_INFO } from '../types/database'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  connected: [connectionId: string]
}>()

const mysqlStore = useMysqlStore()

const form = ref({
  name: '',
  host: '',
  port: '3306',
  username: '',
  password: '',
  database: ''
})

// Public read-only credentials — https://docs.rfam.org/en/latest/database.html
const fillDemo = () => {
  form.value = {
    name: 'Rfam Public Database',
    host: 'mysql-rfam-public.ebi.ac.uk',
    port: '4497',
    username: 'rfamro',
    password: '',
    database: 'Rfam'
  }
}

const isConnecting = ref(false)
const isTesting = ref(false)
const error = ref<string | null>(null)
const testSuccess = ref(false)
const testMessage = ref<string | null>(null)

// Form is valid if required fields are filled
const isFormValid = computed(() => {
  return form.value.host.trim() !== '' &&
         form.value.username.trim() !== ''
})

// Can only connect after a successful test and name is provided
const canConnect = computed(() => {
  return isFormValid.value &&
         form.value.name.trim() !== '' &&
         testSuccess.value &&
         !isConnecting.value
})

// Reset test state when connection params change
const resetTestState = () => {
  testSuccess.value = false
  testMessage.value = null
  error.value = null
}

// Watch for changes to connection params and reset test state
watch(() => [
  form.value.host,
  form.value.port,
  form.value.username,
  form.value.password,
  form.value.database
], resetTestState, { deep: true })

const handleTestConnection = async () => {
  if (!isFormValid.value || isTesting.value) return

  isTesting.value = true
  error.value = null
  testMessage.value = null

  try {
    const result = await mysqlStore.testConnection(
      form.value.host,
      parseInt(form.value.port) || 3306,
      form.value.username,
      form.value.password,
      form.value.database || null,
      false
    )

    testSuccess.value = result.success
    testMessage.value = result.message

    if (!result.success) {
      error.value = result.message
    }
  } catch (err: unknown) {
    testSuccess.value = false
    error.value = err instanceof Error ? err.message : 'Connection test failed'
  } finally {
    isTesting.value = false
  }
}

const handleSubmit = async () => {
  if (!canConnect.value) return

  isConnecting.value = true
  error.value = null

  try {
    const connectionId = await mysqlStore.createConnection(
      form.value.name,
      form.value.host,
      parseInt(form.value.port) || 3306,
      form.value.username,
      form.value.password,
      form.value.database || null,
      false
    )
    emit('connected', connectionId)
    emit('close')
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to connect'
  } finally {
    isConnecting.value = false
  }
}

// Reset form when modal closes
watch(() => props.show, (showing) => {
  if (showing) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
    form.value = {
      name: '',
      host: '',
      port: '3306',
      username: '',
      password: '',
      database: ''
    }
    error.value = null
    isConnecting.value = false
    isTesting.value = false
    testSuccess.value = false
    testMessage.value = null
  }
})

// Close on Escape key
const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mysql-modal-title"
        @click.self="emit('close')"
      >
        <div class="modal-content">
          <div class="modal-header">
            <div class="header-content">
              <img
                :src="DATABASE_INFO.mysql.logo"
                :alt="DATABASE_INFO.mysql.name"
                class="mysql-icon"
              >
              <h2 id="mysql-modal-title">
                Connect to {{ DATABASE_INFO.mysql.name }}
              </h2>
            </div>
            <button
              class="close-btn"
              aria-label="Close"
              @click="emit('close')"
            >
              &times;
            </button>
          </div>

          <button
            class="btn-demo"
            type="button"
            @click="fillDemo"
          >
            Try demo — Rfam Public Database (read-only)
          </button>

          <form
            class="connection-form"
            @submit.prevent="handleSubmit"
          >
            <div class="form-group">
              <label for="conn-name">Connection Name</label>
              <input
                id="conn-name"
                v-model="form.name"
                type="text"
                placeholder="My MySQL Database"
                autocomplete="off"
                required
              >
            </div>

            <div class="form-row">
              <div class="form-group flex-grow">
                <label for="host">Host <span class="required">*</span></label>
                <input
                  id="host"
                  v-model="form.host"
                  type="text"
                  placeholder="my-database.example.com"
                  autocomplete="off"
                  required
                >
              </div>
              <div class="form-group port-group">
                <label for="port">Port</label>
                <input
                  id="port"
                  v-model="form.port"
                  type="text"
                  placeholder="3306"
                  autocomplete="off"
                >
              </div>
            </div>

            <div class="form-group">
              <label for="username">Username <span class="required">*</span></label>
              <input
                id="username"
                v-model="form.username"
                type="text"
                placeholder="root"
                autocomplete="off"
                required
              >
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input
                id="password"
                v-model="form.password"
                type="password"
                placeholder="keep_it_secret_keep_it_safe"
                autocomplete="new-password"
              >
            </div>

            <div class="form-group">
              <label for="database">Database</label>
              <input
                id="database"
                v-model="form.database"
                type="text"
                placeholder="mydb"
                autocomplete="off"
              >
            </div>

            <div
              v-if="testSuccess && testMessage"
              class="success-message"
            >
              {{ testMessage }}
            </div>

            <div
              v-if="error"
              class="error-message"
            >
              {{ error }}
            </div>

            <div class="form-actions">
              <button
                type="button"
                class="btn-secondary"
                @click="emit('close')"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn-test"
                :class="{ success: testSuccess }"
                :disabled="!isFormValid || isTesting"
                @click="handleTestConnection"
              >
                <span v-if="isTesting">Testing...</span>
                <span v-else-if="testSuccess">Tested</span>
                <span v-else>Test connection</span>
              </button>
              <button
                v-tooltip="!testSuccess ? 'Test the connection first' : ''"
                type="submit"
                class="btn-primary"
                :disabled="!canConnect"
              >
                {{ isConnecting ? 'Connecting...' : 'Connect' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Uses global .modal-overlay from style.css */

.modal-content {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: var(--space-5);
  border-radius: var(--border-radius-md);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.header-content {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.mysql-icon {
  width: 32px;
  height: 32px;
}

.modal-header h2 {
  font-size: var(--font-size-heading);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: var(--space-1);
  line-height: 1;
  transition: color 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
}

.connection-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-group label {
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.required {
  color: var(--color-error);
}

.form-group input[type="text"],
.form-group input[type="password"] {
  padding: var(--space-2) var(--space-3);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body);
  font-family: var(--font-family-mono);
  background: var(--surface-primary);
  color: var(--text-primary);
  transition: border-color 0.2s;
}

.form-group input[type="text"]:focus,
.form-group input[type="password"]:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-group input::placeholder {
  color: var(--text-tertiary);
}

.form-row {
  display: flex;
  gap: var(--space-3);
}

.flex-grow {
  flex: 1;
}

.port-group {
  width: 100px;
  flex-shrink: 0;
}

.success-message {
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  border: var(--border-width-thin) solid var(--color-success);
  border-radius: var(--border-radius-sm);
  padding: var(--space-2) var(--space-3);
  color: var(--color-success);
  font-size: var(--font-size-body-sm);
}

.error-message {
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
  border: var(--border-width-thin) solid var(--color-error);
  border-radius: var(--border-radius-sm);
  padding: var(--space-2) var(--space-3);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding-top: var(--space-4);
  border-top: var(--border-width-thin) solid var(--border-secondary);
}

.btn-secondary,
.btn-primary {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--color-accent);
  border: var(--border-width-thick) solid var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 85%, black);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-test {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  color: var(--text-primary);
}

.btn-test:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-test.success {
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  border-color: var(--color-success);
  color: var(--color-success);
}

/* Transition animations */
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
