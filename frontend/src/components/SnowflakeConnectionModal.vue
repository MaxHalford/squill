<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useSnowflakeStore } from '../stores/snowflake'
import { DATABASE_INFO } from '../types/database'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  connected: [connectionId: string]
}>()

const snowflakeStore = useSnowflakeStore()

const form = ref({
  name: '',
  account: '',
  username: '',
  password: '',
  warehouse: '',
  database: '',
  schemaName: '',
  role: ''
})

const isConnecting = ref(false)
const isTesting = ref(false)
const error = ref<string | null>(null)
const testSuccess = ref(false)
const testMessage = ref<string | null>(null)

// Form is valid if required fields are filled
const isFormValid = computed(() => {
  return form.value.account.trim() !== '' &&
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
  form.value.account,
  form.value.username,
  form.value.password,
  form.value.warehouse,
  form.value.database,
  form.value.schemaName,
  form.value.role
], resetTestState, { deep: true })

const handleTestConnection = async () => {
  if (!isFormValid.value || isTesting.value) return

  isTesting.value = true
  error.value = null
  testMessage.value = null

  try {
    const result = await snowflakeStore.testConnection(
      form.value.account,
      form.value.username,
      form.value.password,
      form.value.warehouse || null,
      form.value.database || null,
      form.value.schemaName || null,
      form.value.role || null
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
    const connectionId = await snowflakeStore.createConnection(
      form.value.name,
      form.value.account,
      form.value.username,
      form.value.password,
      form.value.warehouse || null,
      form.value.database || null,
      form.value.schemaName || null,
      form.value.role || null
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
    // Reset form
    form.value = {
      name: '',
      account: '',
      username: '',
      password: '',
      warehouse: '',
      database: '',
      schemaName: '',
      role: ''
    }
    error.value = null
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
        aria-labelledby="snowflake-modal-title"
        @click.self="emit('close')"
      >
        <div class="modal-content">
          <div class="modal-header">
            <div class="header-content">
              <img
                :src="DATABASE_INFO.snowflake.logo"
                :alt="DATABASE_INFO.snowflake.name"
                class="snowflake-icon"
              />
              <h2 id="snowflake-modal-title">Connect to {{ DATABASE_INFO.snowflake.name }}</h2>
            </div>
            <button class="close-btn" @click="emit('close')" aria-label="Close">&times;</button>
          </div>

          <form @submit.prevent="handleSubmit" class="connection-form">
            <div class="form-group">
              <label for="conn-name">Connection Name</label>
              <input
                id="conn-name"
                v-model="form.name"
                type="text"
                placeholder="My Snowflake Warehouse"
                autocomplete="off"
                required
              />
            </div>

            <div class="form-group">
              <label for="account">Account <span class="required">*</span></label>
              <input
                id="account"
                v-model="form.account"
                type="text"
                placeholder="xy12345.us-east-1"
                autocomplete="off"
                required
              />
              <span class="help-text">Account identifier (e.g., xy12345.us-east-1)</span>
            </div>

            <div class="form-group">
              <label for="username">Username <span class="required">*</span></label>
              <input
                id="username"
                v-model="form.username"
                type="text"
                placeholder="myuser"
                autocomplete="off"
                required
              />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input
                id="password"
                v-model="form.password"
                type="password"
                placeholder="keep_it_secret_keep_it_safe"
                autocomplete="new-password"
              />
            </div>

            <div class="form-group">
              <label for="warehouse">Warehouse</label>
              <input
                id="warehouse"
                v-model="form.warehouse"
                type="text"
                placeholder="COMPUTE_WH"
                autocomplete="off"
              />
            </div>

            <div class="form-row">
              <div class="form-group flex-grow">
                <label for="database">Database</label>
                <input
                  id="database"
                  v-model="form.database"
                  type="text"
                  placeholder="MY_DATABASE"
                  autocomplete="off"
                />
              </div>
              <div class="form-group flex-grow">
                <label for="schema">Schema</label>
                <input
                  id="schema"
                  v-model="form.schemaName"
                  type="text"
                  placeholder="PUBLIC"
                  autocomplete="off"
                />
              </div>
            </div>

            <div class="form-group">
              <label for="role">Role</label>
              <input
                id="role"
                v-model="form.role"
                type="text"
                placeholder="ACCOUNTADMIN"
                autocomplete="off"
              />
            </div>

            <div v-if="testSuccess && testMessage" class="success-message">
              {{ testMessage }}
            </div>

            <div v-if="error" class="error-message">
              {{ error }}
            </div>

            <div class="form-actions">
              <button type="button" class="btn-secondary" @click="emit('close')">
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
                type="submit"
                class="btn-primary"
                :disabled="!canConnect"
                v-tooltip="!testSuccess ? 'Test the connection first' : ''"
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

.snowflake-icon {
  width: 32px;
  height: 32px;
  color: #29B5E8;
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

.help-text {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.form-group input,
.form-group select {
  padding: var(--space-2) var(--space-3);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body);
  font-family: var(--font-family-mono);
  background: var(--surface-primary);
  color: var(--text-primary);
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group select:focus {
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
