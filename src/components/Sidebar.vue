<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const isOpen = ref(false)
const error = ref(null)
const isSigningIn = ref(false)
const projects = ref([])
const isLoadingProjects = ref(false)

// Schema browser state
const datasets = ref([])
const selectedDataset = ref('')
const tables = ref([])
const expandedTables = ref({})
const tableSchemas = ref({})
const isLoadingDatasets = ref(false)
const isLoadingTables = ref(false)

const toggleSidebar = () => {
  isOpen.value = !isOpen.value
}

const handleSignIn = async () => {
  try {
    isSigningIn.value = true
    error.value = null
    await authStore.signInWithGoogle()

    // Load projects after sign in
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
  // Load datasets for the new project
  if (event.target.value) {
    await loadDatasets()
  }
}

// Load datasets for current project
const loadDatasets = async () => {
  if (!authStore.projectId) return

  try {
    isLoadingDatasets.value = true
    datasets.value = await authStore.fetchDatasets()
    // Clear tables and selection when datasets change
    selectedDataset.value = ''
    tables.value = []
    expandedTables.value = {}
  } catch (err) {
    console.error('Failed to load datasets:', err)
  } finally {
    isLoadingDatasets.value = false
  }
}

// Handle dataset change
const handleDatasetChange = async (event) => {
  selectedDataset.value = event.target.value
  if (selectedDataset.value) {
    await loadTables()
  } else {
    tables.value = []
    expandedTables.value = {}
  }
}

// Load tables for selected dataset
const loadTables = async () => {
  if (!selectedDataset.value) return

  try {
    isLoadingTables.value = true
    const datasetId = selectedDataset.value.split('.').pop() // Get dataset ID from full reference
    tables.value = await authStore.fetchTables(datasetId)
    expandedTables.value = {}
  } catch (err) {
    console.error('Failed to load tables:', err)
  } finally {
    isLoadingTables.value = false
  }
}

// Toggle table expansion and load schema if needed
const toggleTable = async (tableRef) => {
  const tableId = tableRef.tableId.split('.').pop()
  const datasetId = selectedDataset.value.split('.').pop()
  const key = `${datasetId}.${tableId}`

  if (expandedTables.value[key]) {
    expandedTables.value[key] = false
  } else {
    expandedTables.value[key] = true

    // Load schema if not already loaded
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

onMounted(() => {
  // If already authenticated, load projects and datasets
  if (authStore.isAuthenticated) {
    loadProjects()
    if (authStore.projectId) {
      loadDatasets()
    }
  }
})
</script>

<template>
  <div class="sidebar-container">
    <!-- Sidebar -->
    <div class="sidebar" :class="{ open: isOpen }">
      <!-- Toggle button (part of sidebar) -->
      <button @click="toggleSidebar" class="toggle-btn">
        <span class="caret" :class="{ open: isOpen }">‹</span>
      </button>

      <div class="sidebar-content">
        <h2>Settings</h2>

        <!-- BigQuery Configuration -->
        <section class="config-section">
          <h3>BigQuery Authentication</h3>

          <div v-if="authStore.isAuthenticated" class="auth-status">
            <!-- User info -->
            <div class="user-info">
              <img
                v-if="authStore.userPhoto"
                :src="authStore.userPhoto"
                :alt="authStore.userName"
                class="user-photo"
              />
              <div class="user-details">
                <div class="user-name">{{ authStore.userName }}</div>
                <div class="user-email">{{ authStore.userEmail }}</div>
              </div>
            </div>

            <!-- Project selector -->
            <div class="project-selector">
              <label for="project-select" class="project-label">
                BigQuery Project
              </label>
              <select
                id="project-select"
                :value="authStore.projectId"
                @change="handleProjectChange"
                class="project-select"
                :disabled="isLoadingProjects"
              >
                <option value="" disabled>
                  {{ isLoadingProjects ? 'Loading projects...' : 'Select a project' }}
                </option>
                <option
                  v-for="project in projects"
                  :key="project.projectId"
                  :value="project.projectId"
                >
                  {{ project.name || project.projectId }}
                </option>
              </select>
            </div>

            <button @click="handleSignOut" class="sign-out-btn">
              Sign Out
            </button>
          </div>

          <div v-else class="auth-prompt">
            <p class="auth-description">
              Sign in with your Google account to run BigQuery queries.
            </p>
            <button
              @click="handleSignIn"
              :disabled="isSigningIn"
              class="google-sign-in-btn"
            >
              <svg class="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>{{ isSigningIn ? 'Signing in...' : 'Sign in with Google' }}</span>
            </button>
            <p class="help-text">
              You'll be asked to grant access to BigQuery and your Google Cloud projects.
            </p>
          </div>

          <div v-if="error" class="error-message">
            {{ error }}
          </div>
        </section>

        <!-- Schema Browser -->
        <section v-if="authStore.isAuthenticated && authStore.projectId" class="config-section">
          <h3>Schema Browser</h3>

          <!-- Dataset selector -->
          <div class="dataset-selector">
            <label for="dataset-select" class="dataset-label">
              Dataset
            </label>
            <select
              id="dataset-select"
              v-model="selectedDataset"
              @change="handleDatasetChange"
              class="dataset-select"
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
          <div v-if="selectedDataset" class="tables-list">
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
                <div
                  class="table-header"
                  @click="toggleTable(table.tableReference)"
                >
                  <span class="table-caret">{{ expandedTables[`${selectedDataset}.${table.tableReference.tableId.split('.').pop()}`] ? '▼' : '▶' }}</span>
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
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-container {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 1000;
}

.sidebar {
  position: fixed;
  top: 0;
  right: -320px;
  width: 320px;
  height: 100vh;
  background: var(--bg-primary);
  border-left: var(--border-width) solid var(--border-color);
  transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
}

.sidebar.open {
  right: 0;
}

.toggle-btn {
  position: fixed;
  right: 20px;
  top: 20px;
  width: 48px;
  height: 48px;
  background: var(--bg-primary);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: none;
  z-index: 1001;
  font-size: var(--font-size-base);
  font-weight: 600;
  outline: none;
  font-family: var(--font-ui);
}

.sidebar.open .toggle-btn {
  right: calc(320px + 20px);
}

.toggle-btn:hover {
  background: var(--bg-secondary);
}

.toggle-btn:focus {
  outline: none;
}

.toggle-btn:active {
  background: var(--bg-secondary);
}

.caret {
  font-size: 24px;
  color: #6b7280;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-block;
  line-height: 1;
}

.caret.open {
  transform: rotate(180deg);
}

.sidebar-content {
  padding: 20px;
}

h2 {
  margin: 0 0 var(--spacing-xl) 0;
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--text-primary);
}

.config-section {
  margin-bottom: var(--spacing-xl);
  padding-bottom: var(--spacing-xl);
  border-bottom: var(--border-width) solid var(--border-color);
}

.config-section:last-child {
  border-bottom: none;
}

h3 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.auth-status {
  padding: 16px;
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 6px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #86efac;
}

.user-photo {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid #10b981;
}

.user-details {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-weight: 600;
  font-size: 14px;
  color: #065f46;
  margin-bottom: 2px;
}

.user-email {
  font-size: 12px;
  color: #059669;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selector {
  margin-bottom: 16px;
}

.project-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.project-select {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-base);
  font-family: var(--font-ui);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: none;
  outline: none;
  font-weight: 600;
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
  background: var(--bg-secondary);
}

.sign-out-btn {
  width: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-base);
  font-weight: 600;
  cursor: pointer;
  transition: none;
  outline: none;
}

.sign-out-btn:hover {
  background: var(--bg-secondary);
}

.sign-out-btn:focus {
  outline: none;
}

.auth-prompt {
  padding: 16px;
  background: #f9fafb;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.auth-description {
  margin: 0 0 16px 0;
  font-size: 13px;
  color: #374151;
  line-height: 1.5;
}

.google-sign-in-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--bg-primary);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  transition: none;
  outline: none;
}

.google-sign-in-btn:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.google-sign-in-btn:focus {
  outline: none;
}

.google-sign-in-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  background: var(--bg-secondary);
}

.google-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.help-text {
  margin: 12px 0 0 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
}

.error-message {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  color: #dc2626;
  font-size: 13px;
}

/* Schema Browser */
.dataset-selector {
  margin-bottom: 16px;
}

.dataset-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.dataset-select {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-base);
  font-family: var(--font-ui);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: none;
  outline: none;
  font-weight: 600;
}

.dataset-select:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.dataset-select:focus {
  outline: none;
  background: var(--bg-secondary);
}

.dataset-select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  background: var(--bg-secondary);
}

.tables-list {
  margin-top: 12px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #f9fafb;
}

.loading-state,
.empty-state {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: #6b7280;
}

.table-item {
  border-bottom: 1px solid #e5e7eb;
}

.table-item:last-child {
  border-bottom: none;
}

.table-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}

.table-header:hover {
  background: #f3f4f6;
}

.table-caret {
  font-size: 10px;
  color: #6b7280;
  width: 12px;
  display: inline-block;
}

.table-name {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  font-family: var(--font-results);
}

.columns-list {
  padding: 8px 12px 8px 32px;
  background: white;
  border-top: 1px solid #e5e7eb;
}

.column-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  font-size: 12px;
  border-bottom: 1px solid #f3f4f6;
}

.column-item:last-child {
  border-bottom: none;
}

.column-name {
  font-family: var(--font-results);
  color: #374151;
  font-weight: 500;
}

.column-type {
  font-family: var(--font-results);
  color: #6b7280;
  font-size: 11px;
  text-transform: uppercase;
}
</style>
