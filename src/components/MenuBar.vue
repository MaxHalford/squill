<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const emit = defineEmits(['add-box'])

const error = ref(null)
const isSigningIn = ref(false)
const projects = ref([])
const isLoadingProjects = ref(false)

// Schema browser modal state
const showSchemaBrowser = ref(false)
const datasets = ref([])
const selectedDataset = ref('')
const tables = ref([])
const expandedTables = ref({})
const tableSchemas = ref({})
const isLoadingDatasets = ref(false)
const isLoadingTables = ref(false)

// User dropdown state
const showUserDropdown = ref(false)

const handleSignIn = async () => {
  try {
    isSigningIn.value = true
    error.value = null
    await authStore.signInWithGoogle()
    await loadProjects()
  } catch (err) {
    error.value = err.message || 'Failed to sign in with Google'
  } finally {
    isSigningIn.value = false
  }
}

const handleSignOut = () => {
  authStore.signOut()
  projects.value = []
  error.value = null
  showUserDropdown.value = false
}

const loadProjects = async () => {
  try {
    isLoadingProjects.value = true
    projects.value = await authStore.fetchProjects()
  } catch (err) {
    console.error('Failed to load projects:', err)
  } finally {
    isLoadingProjects.value = false
  }
}

const handleProjectChange = async (event) => {
  authStore.setProjectId(event.target.value)
  if (event.target.value) {
    await loadDatasets()
  }
}

const loadDatasets = async () => {
  if (!authStore.projectId) return

  try {
    isLoadingDatasets.value = true
    datasets.value = await authStore.fetchDatasets()
    selectedDataset.value = ''
    tables.value = []
    expandedTables.value = {}
  } catch (err) {
    console.error('Failed to load datasets:', err)
  } finally {
    isLoadingDatasets.value = false
  }
}

const handleDatasetChange = async (event) => {
  selectedDataset.value = event.target.value
  if (selectedDataset.value) {
    await loadTables()
  } else {
    tables.value = []
    expandedTables.value = {}
  }
}

const loadTables = async () => {
  if (!selectedDataset.value) return

  try {
    isLoadingTables.value = true
    const datasetId = selectedDataset.value.split('.').pop()
    tables.value = await authStore.fetchTables(datasetId)
    expandedTables.value = {}
  } catch (err) {
    console.error('Failed to load tables:', err)
  } finally {
    isLoadingTables.value = false
  }
}

const toggleTable = async (tableRef) => {
  const tableId = tableRef.tableId.split('.').pop()
  const datasetId = selectedDataset.value.split('.').pop()
  const key = `${datasetId}.${tableId}`

  if (expandedTables.value[key]) {
    expandedTables.value[key] = false
  } else {
    expandedTables.value[key] = true

    if (!tableSchemas.value[key]) {
      try {
        const schema = await authStore.fetchTableSchema(datasetId, tableId)
        tableSchemas.value[key] = schema
      } catch (err) {
        console.error('Failed to load table schema:', err)
      }
    }
  }
}

const openSchemaBrowser = async () => {
  showSchemaBrowser.value = true
  if (authStore.projectId && datasets.value.length === 0) {
    await loadDatasets()
  }
}

// Close dropdown when clicking outside
const handleClickOutside = (event) => {
  if (showUserDropdown.value && !event.target.closest('.user-menu')) {
    showUserDropdown.value = false
  }
}

onMounted(() => {
  if (authStore.isAuthenticated) {
    loadProjects()
    if (authStore.projectId) {
      loadDatasets()
    }
  }
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="menu-bar">
    <!-- Left section -->
    <div class="menu-left">
      <div class="app-name">Squill</div>
      <button @click="emit('add-box')" class="menu-btn" title="Add SQL Box">
        + SQL Box
      </button>
      <button
        v-if="authStore.isAuthenticated && authStore.projectId"
        @click="openSchemaBrowser"
        class="menu-btn"
        title="Browse schema"
      >
        Schema
      </button>
    </div>

    <!-- Right section -->
    <div class="menu-right">
      <!-- Project selector -->
      <select
        v-if="authStore.isAuthenticated"
        :value="authStore.projectId"
        @change="handleProjectChange"
        class="project-select"
        :disabled="isLoadingProjects"
        title="Select BigQuery project"
      >
        <option value="" disabled>
          {{ isLoadingProjects ? 'Loading...' : 'Select project' }}
        </option>
        <option
          v-for="project in projects"
          :key="project.projectId"
          :value="project.projectId"
        >
          {{ project.name || project.projectId }}
        </option>
      </select>

      <!-- User profile / Sign in -->
      <div v-if="authStore.isAuthenticated" class="user-menu">
        <button
          @click="showUserDropdown = !showUserDropdown"
          class="user-button"
          title="User menu"
        >
          <img
            v-if="authStore.userPhoto"
            :src="authStore.userPhoto"
            :alt="authStore.userName"
            class="user-avatar"
          />
          <span v-else class="user-initials">
            {{ authStore.userName?.charAt(0).toUpperCase() }}
          </span>
        </button>

        <!-- User dropdown -->
        <div v-if="showUserDropdown" class="user-dropdown">
          <div class="user-info">
            <div class="user-name">{{ authStore.userName }}</div>
            <div class="user-email">{{ authStore.userEmail }}</div>
          </div>
          <button @click="handleSignOut" class="dropdown-item">
            Sign Out
          </button>
        </div>
      </div>

      <button
        v-else
        @click="handleSignIn"
        :disabled="isSigningIn"
        class="sign-in-btn"
        title="Sign in with Google"
      >
        <svg class="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        {{ isSigningIn ? 'Signing in...' : 'Sign in' }}
      </button>
    </div>

    <!-- Error message -->
    <div v-if="error" class="error-toast">
      {{ error }}
    </div>

    <!-- Schema Browser Modal -->
    <div v-if="showSchemaBrowser" class="modal-overlay" @click="showSchemaBrowser = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>Schema Browser</h2>
          <button @click="showSchemaBrowser = false" class="close-btn">✕</button>
        </div>

        <div class="modal-content">
          <!-- Dataset selector -->
          <div class="field">
            <label for="dataset-select">Dataset</label>
            <select
              id="dataset-select"
              v-model="selectedDataset"
              @change="handleDatasetChange"
              class="select"
              :disabled="isLoadingDatasets"
            >
              <option value="">
                {{ isLoadingDatasets ? 'Loading datasets...' : 'Select a dataset' }}
              </option>
              <option
                v-for="dataset in datasets"
                :key="dataset.datasetReference.datasetId"
                :value="dataset.datasetReference.datasetId"
              >
                {{ dataset.datasetReference.datasetId }}
              </option>
            </select>
          </div>

          <!-- Tables list -->
          <div v-if="selectedDataset" class="tables-section">
            <label>Tables</label>
            <div class="tables-list">
              <div v-if="isLoadingTables" class="loading-state">
                Loading tables...
              </div>
              <div v-else-if="tables.length === 0" class="empty-state">
                No tables found
              </div>
              <div v-else>
                <div
                  v-for="table in tables"
                  :key="table.tableReference.tableId"
                  class="table-item"
                >
                  <div class="table-header" @click="toggleTable(table.tableReference)">
                    <span class="table-caret">
                      {{ expandedTables[`${selectedDataset}.${table.tableReference.tableId.split('.').pop()}`] ? '▼' : '▶' }}
                    </span>
                    <span class="table-name">{{ table.tableReference.tableId.split('.').pop() }}</span>
                  </div>
                  <div
                    v-if="expandedTables[`${selectedDataset}.${table.tableReference.tableId.split('.').pop()}`]"
                    class="columns-list"
                  >
                    <div
                      v-for="column in tableSchemas[`${selectedDataset}.${table.tableReference.tableId.split('.').pop()}`] || []"
                      :key="column.name"
                      class="column-item"
                    >
                      <span class="column-name">{{ column.name }}</span>
                      <span class="column-type">{{ column.type }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--bg-primary);
  border-bottom: var(--border-slim) solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--spacing-md);
  z-index: 1000;
  font-family: var(--font-ui);
}

.menu-left,
.menu-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.app-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin-right: var(--spacing-md);
  user-select: none;
}

.menu-btn {
  background: transparent;
  color: var(--text-primary);
  border: none;
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-base);
  font-weight: 600;
  font-family: var(--font-ui);
  cursor: pointer;
  border-radius: var(--border-radius);
  transition: background 0.2s;
  outline: none;
}

.menu-btn:hover {
  background: var(--bg-secondary);
}

.menu-btn:focus {
  outline: none;
}

.project-select {
  min-width: 200px;
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-sm);
  font-family: var(--font-ui);
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-weight: 600;
  outline: none;
}

.project-select:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.project-select:focus {
  outline: none;
  background: var(--bg-secondary);
}

.project-select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.user-menu {
  position: relative;
}

.user-button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: var(--border-slim) solid var(--border-color);
  background: var(--bg-primary);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  transition: background 0.2s;
}

.user-button:hover {
  background: var(--bg-secondary);
}

.user-button:focus {
  outline: none;
}

.user-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.user-initials {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--bg-primary);
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.user-info {
  padding: var(--spacing-md);
  border-bottom: var(--border-slim) solid var(--border-color);
}

.user-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.user-email {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.dropdown-item {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  background: transparent;
  border: none;
  text-align: left;
  font-size: var(--font-size-base);
  font-family: var(--font-ui);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: background 0.2s;
}

.dropdown-item:hover {
  background: var(--bg-secondary);
}

.dropdown-item:focus {
  outline: none;
}

.sign-in-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--bg-primary);
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-ui);
  cursor: pointer;
  outline: none;
  transition: background 0.2s;
}

.sign-in-btn:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.sign-in-btn:focus {
  outline: none;
}

.sign-in-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.google-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.error-toast {
  position: fixed;
  top: 60px;
  right: 20px;
  max-width: 300px;
  padding: var(--spacing-md);
  background: #fef2f2;
  border: var(--border-slim) solid #fecaca;
  border-radius: var(--border-radius);
  color: #dc2626;
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-lg);
  z-index: 1001;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  background: var(--bg-primary);
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: var(--border-slim) solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: var(--border-slim) solid var(--border-color);
  background: transparent;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 18px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  transition: background 0.2s;
}

.close-btn:hover {
  background: var(--bg-secondary);
}

.close-btn:focus {
  outline: none;
}

.modal-content {
  padding: var(--spacing-lg);
  overflow-y: auto;
  flex: 1;
}

.field {
  margin-bottom: var(--spacing-lg);
}

.field label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.select {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-base);
  font-family: var(--font-ui);
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-weight: 600;
  outline: none;
}

.select:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.select:focus {
  outline: none;
  background: var(--bg-secondary);
}

.select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.tables-section {
  margin-top: var(--spacing-lg);
}

.tables-section > label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.tables-list {
  border: var(--border-slim) solid var(--border-color);
  border-radius: var(--border-radius);
  max-height: 400px;
  overflow-y: auto;
}

.loading-state,
.empty-state {
  padding: var(--spacing-lg);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.table-item {
  border-bottom: var(--border-slim) solid var(--border-color);
}

.table-item:last-child {
  border-bottom: none;
}

.table-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.table-header:hover {
  background: var(--bg-secondary);
}

.table-caret {
  font-size: 10px;
  color: var(--text-secondary);
  width: 12px;
}

.table-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-results);
}

.columns-list {
  padding: var(--spacing-sm) var(--spacing-md) var(--spacing-sm) calc(var(--spacing-md) + 20px);
  background: var(--bg-secondary);
  border-top: var(--border-slim) solid var(--border-color);
}

.column-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-sm);
}

.column-name {
  font-family: var(--font-results);
  color: var(--text-primary);
  font-weight: 500;
}

.column-type {
  font-family: var(--font-results);
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
}
</style>
