<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useCanvasStore } from '../stores/canvas'
import { useConnectionsStore } from '../stores/connections'
import { useSettingsStore } from '../stores/settings'
import { getConnectionTypeName, connectionRequiresAuth } from '../utils/connectionUtils'

const authStore = useAuthStore()
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const settingsStore = useSettingsStore()

// Dropdown states
const activeDropdown = ref(null) // 'connection', 'box', 'settings'

// Box types
const boxTypes = [
  { id: 'sql', name: 'SQL editor' },
  { id: 'schema', name: 'Schema browser' },
  { id: 'note', name: 'Sticky note' }
]

// Connection dropdown state
const isConnectionDropdownOpen = ref(false)
const addDatabaseMenuOpen = ref(false)

// Settings state
const limitInputValue = ref(settingsStore.autoLimitValue)
const paginationInputValue = ref(settingsStore.paginationSize)

// Connection display name
const getConnectionDisplayName = (connection) => {
  const dbName = getConnectionTypeName(connection.type)
  const identifier = connection.type === 'duckdb' ? 'local' : connection.email
  return `${dbName} - ${identifier}`
}

// Toggle dropdown
const toggleDropdown = (dropdown) => {
  if (dropdown === 'connection') {
    isConnectionDropdownOpen.value = !isConnectionDropdownOpen.value
    // Load projects when opening connection dropdown (BigQuery only)
    if (isConnectionDropdownOpen.value && connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired) {
      authStore.fetchProjects().catch(err => console.error('Failed to load projects:', err))
    }
    return
  }

  if (activeDropdown.value === dropdown) {
    activeDropdown.value = null
  } else {
    activeDropdown.value = dropdown
  }
}

// Close dropdown
const closeDropdown = () => {
  activeDropdown.value = null
  isConnectionDropdownOpen.value = false
  addDatabaseMenuOpen.value = false
}

// Handle connection selection
const handleConnectionSelect = async (connectionId) => {
  const connection = connectionsStore.connections.find(c => c.id === connectionId)
  if (!connection) return

  connectionsStore.setActiveConnection(connectionId)

  // Only load projects for BigQuery connections
  if (connection.type === 'bigquery') {
    await authStore.fetchProjects().catch(err => console.error('Failed to load projects:', err))
  } else {
    // Clear project for non-BigQuery connections
    canvasStore.setActiveProjectId(null)
    authStore.setProjectId(null)
  }

  closeDropdown()
}

// Handle project selection
const handleProjectSelect = async (projectId) => {
  canvasStore.setActiveProjectId(projectId)
  authStore.setProjectId(projectId)
  closeDropdown()

  // Fetch all schemas using INFORMATION_SCHEMA
  try {
    await authStore.fetchAllSchemas()
  } catch (error) {
    console.error('Failed to fetch schemas:', error)
    // Don't block the UI if schema fetch fails
  }
}

// Handle add database
const handleAddDatabase = async (databaseType) => {
  addDatabaseMenuOpen.value = false
  isConnectionDropdownOpen.value = false

  if (databaseType === 'bigquery') {
    try {
      await authStore.signInWithGoogle()
      await authStore.fetchProjects()
      // Auto-select first project if available
      if (authStore.projects.length > 0) {
        handleProjectSelect(authStore.projects[0].projectId)
      }
    } catch (error) {
      console.error('Failed to add database:', error)
    }
  }
}

// Handle delete connection
const handleDeleteConnection = (connectionId, event) => {
  event.stopPropagation()
  connectionsStore.removeConnection(connectionId)
}

// Handle reconnect
const handleReconnect = async (connectionId, event) => {
  event.stopPropagation()
  try {
    await authStore.reconnectConnection(connectionId)
    await authStore.fetchProjects()
  } catch (error) {
    console.error('Failed to reconnect:', error)
  }
}

// Add box
const addBox = (boxType) => {
  const boxId = canvasStore.addBox(boxType)
  canvasStore.selectBox(boxId)
  closeDropdown()
}

// Handle refresh schemas
const handleRefreshSchemas = async () => {
  try {
    await authStore.fetchAllSchemas()
    alert('Schemas refreshed successfully!')
  } catch (error) {
    console.error('Failed to refresh schemas:', error)
    alert('Failed to refresh schemas. Please check the console for details.')
  }
}

// Handle reset all data
const handleResetAll = () => {
  if (confirm('This will clear all data including connections, queries, and cached results. Are you sure?')) {
    // Clear all localStorage
    localStorage.clear()
    // Reload the page to reset application state
    window.location.reload()
  }
}

// Handle limit value changes with debouncing
let limitDebounceTimer = null
const handleLimitChange = (e) => {
  const value = e.target.value
  limitInputValue.value = value

  // Debounce setting the value
  if (limitDebounceTimer) clearTimeout(limitDebounceTimer)
  limitDebounceTimer = setTimeout(() => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue > 0) {
      settingsStore.setAutoLimitValue(numValue)
    }
  }, 500)
}

// Handle pagination size changes with debouncing
let paginationDebounceTimer = null
const handlePaginationChange = (e) => {
  const value = e.target.value
  paginationInputValue.value = value

  // Debounce setting the value
  if (paginationDebounceTimer) clearTimeout(paginationDebounceTimer)
  paginationDebounceTimer = setTimeout(() => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue > 0) {
      settingsStore.setPaginationSize(numValue)
    }
  }, 500)
}

// Sync limit input when store changes
watch(() => settingsStore.autoLimitValue, (newValue) => {
  limitInputValue.value = newValue
})

// Sync pagination input when store changes
watch(() => settingsStore.paginationSize, (newValue) => {
  paginationInputValue.value = newValue
})

// Close dropdown when clicking outside
import { onMounted, onUnmounted } from 'vue'

const handleClickOutside = (e) => {
  if (!e.target.closest('.menu-item')) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="menu-bar">
    <div class="menu-left">
      <div class="app-name">Squill</div>

      <!-- Unified Connection Dropdown -->
      <div class="menu-item" :class="{ active: isConnectionDropdownOpen }">
        <button class="menu-button" @click.stop="toggleDropdown('connection')">
          <span v-if="connectionsStore.activeConnection?.type === 'bigquery' && canvasStore.activeProjectId" class="menu-text">
            {{ getConnectionDisplayName(connectionsStore.activeConnection) }} / {{ canvasStore.activeProjectId }}
            <span v-if="connectionsStore.isActiveTokenExpired" class="token-expired-indicator"> (Expired)</span>
          </span>
          <span v-else-if="connectionsStore.activeConnection" class="menu-text">
            {{ getConnectionDisplayName(connectionsStore.activeConnection) }}
            <span v-if="connectionsStore.isActiveTokenExpired" class="token-expired-indicator"> (Expired)</span>
          </span>
          <span v-else class="menu-text placeholder-text">
            No connection
          </span>
          <span class="menu-caret">▼</span>
        </button>

        <div v-if="isConnectionDropdownOpen" class="dropdown connection-dropdown">
          <!-- Connections Section -->
          <div v-if="connectionsStore.connections.length > 0" class="dropdown-section">
            <div class="section-label">Connections</div>
            <button
              v-for="connection in connectionsStore.connections"
              :key="connection.id"
              class="dropdown-item connection-item"
              :class="{
                selected: connectionsStore.activeConnectionId === connection.id,
                expired: connectionRequiresAuth(connection.type) && connectionsStore.isConnectionExpired(connection.id)
              }"
              @click="handleConnectionSelect(connection.id)"
            >
              <img v-if="connection.photo" :src="connection.photo" class="connection-avatar" />
              <div class="connection-info">
                <div class="connection-name">{{ getConnectionDisplayName(connection) }}</div>
                <div v-if="connectionRequiresAuth(connection.type) && connectionsStore.isConnectionExpired(connection.id)" class="expired-badge">
                  Token Expired
                </div>
              </div>
              <div class="connection-actions" @click.stop>
                <button
                  v-if="connectionRequiresAuth(connection.type) && connectionsStore.isConnectionExpired(connection.id)"
                  class="reconnect-btn"
                  @click="handleReconnect(connection.id, $event)"
                  title="Reconnect"
                >
                  ↻
                </button>
                <button
                  class="delete-btn"
                  @click="handleDeleteConnection(connection.id, $event)"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </button>
          </div>

          <!-- Projects Section (BigQuery only) -->
          <div v-if="connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired" class="dropdown-section">
            <div class="section-label">Projects</div>
            <div v-if="authStore.projects.length === 0" class="dropdown-message">
              No projects found
            </div>
            <button
              v-for="project in authStore.projects"
              :key="project.projectId"
              class="dropdown-item project-item"
              :class="{ selected: project.projectId === canvasStore.activeProjectId }"
              @click="handleProjectSelect(project.projectId)"
            >
              <span class="item-text">{{ project.name || project.projectId }}</span>
              <span v-if="project.projectId === canvasStore.activeProjectId" class="item-check">✓</span>
            </button>
          </div>

          <!-- Add Database Section -->
          <div class="dropdown-section add-section">
            <div class="section-divider"></div>
            <button
              class="dropdown-item add-item"
              @click.stop="addDatabaseMenuOpen = !addDatabaseMenuOpen"
            >
              <span class="add-icon">+</span>
              Add database
              <span class="dropdown-arrow">{{ addDatabaseMenuOpen ? '▼' : '▶' }}</span>
            </button>

            <!-- Nested database type menu -->
            <div v-if="addDatabaseMenuOpen" class="nested-menu" @click.stop>
              <button
                class="dropdown-item nested-item"
                @click="handleAddDatabase('bigquery')"
              >
                <img src="../assets/bigquery.svg" class="db-icon" />
                BigQuery
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Box Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'box' }">
        <button class="menu-button" @click.stop="toggleDropdown('box')">
          <span class="menu-text">Add</span>
          <span class="menu-caret">▼</span>
        </button>

        <div v-if="activeDropdown === 'box'" class="dropdown">
          <button
            v-for="boxType in boxTypes"
            :key="boxType.id"
            class="dropdown-item"
            @click="addBox(boxType.id)"
          >
            <div class="item-main">
              <span class="item-text">{{ boxType.name }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Settings Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'settings' }">
        <button class="menu-button" @click.stop="toggleDropdown('settings')">
          <span class="menu-text">Settings</span>
          <span class="menu-caret">▼</span>
        </button>

        <div v-if="activeDropdown === 'settings'" class="dropdown settings-dropdown">
          <div class="settings-section">
            <div class="setting-header">BigQuery Schema Cache</div>
            <div class="setting-description">
              Refresh schema information from BigQuery INFORMATION_SCHEMA
            </div>
            <button @click="handleRefreshSchemas" class="action-button" :disabled="!authStore.isAuthenticated">
              Refresh Schemas
            </button>
          </div>

          <div class="settings-section">
            <div class="setting-header">Auto-limit queries</div>
            <div class="setting-description">
              Automatically add LIMIT clause to queries without one
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <input
                  type="checkbox"
                  :checked="settingsStore.autoLimitEnabled"
                  @change="settingsStore.toggleAutoLimit"
                  class="setting-checkbox"
                />
                <span>Enable auto-limit</span>
              </label>
            </div>

            <div class="setting-row" :class="{ disabled: !settingsStore.autoLimitEnabled }">
              <label class="setting-label">
                <span>Default LIMIT value</span>
                <input
                  type="number"
                  :value="limitInputValue"
                  @input="handleLimitChange"
                  :disabled="!settingsStore.autoLimitEnabled"
                  min="1"
                  max="1000000"
                  class="setting-input-number"
                />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="setting-header">Pagination size</div>
            <div class="setting-description">
              Number of rows to display per page in results tables
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <span>Rows per page</span>
                <input
                  type="number"
                  :value="paginationInputValue"
                  @input="handlePaginationChange"
                  min="1"
                  max="10000"
                  class="setting-input-number"
                />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="setting-header">Viewport behavior</div>
            <div class="setting-description">
              Control how the viewport moves when interacting with boxes
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <input
                  type="checkbox"
                  :checked="settingsStore.panToBoxOnSelect"
                  @change="settingsStore.togglePanToBoxOnSelect"
                  class="setting-checkbox"
                />
                <span>Pan to box on select</span>
              </label>
            </div>
          </div>

          <div class="settings-section settings-section-danger">
            <div class="setting-header">Reset</div>
            <div class="setting-description">
              Clear all data including connections, queries, and cached results
            </div>
            <button @click="handleResetAll" class="reset-button">
              Reset All Data
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="menu-right">
      <!-- Placeholder for future right-side menu items -->
    </div>
  </div>
</template>

<style scoped>
.menu-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  background: var(--surface-primary);
  border-bottom: var(--border-width-thin) solid var(--border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--space-3);
  z-index: 1000;
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body-sm);
}

.menu-left,
.menu-right {
  display: flex;
  align-items: center;
  gap: 0;
  height: 100%;
}

.app-name {
  font-size: var(--font-size-body);
  font-weight: 700;
  color: var(--text-primary);
  margin-right: var(--space-4);
  user-select: none;
  display: flex;
  align-items: center;
  height: 100%;
}

/* Menu Item Container */
.menu-item {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
}

.menu-item.active .menu-button {
  background: var(--surface-secondary);
}

/* Menu Button */
.menu-button {
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  cursor: pointer;
  outline: none;
  transition: background 0.15s;
}

.menu-button:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.menu-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-text {
  font-weight: 500;
  white-space: nowrap;
}

.token-expired-indicator {
  color: var(--color-error);
  font-weight: 600;
}

.menu-caret {
  font-size: 10px;
  opacity: 0.6;
}

/* Dropdown */
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  margin-top: 1px;
  z-index: 2000;
  max-height: 400px;
  overflow-y: auto;
}

.user-dropdown {
  right: 0;
  left: auto;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  text-align: left;
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: background 0.1s;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: var(--surface-secondary);
}

.dropdown-item.selected {
  background: var(--surface-secondary);
}

.item-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}

.item-text {
  flex: 1;
}

.item-check {
  color: var(--color-accent);
  font-weight: bold;
}

.dropdown-message {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

/* User Button */
.user-button {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: var(--border-width-thin) solid var(--border-primary);
  background: var(--surface-primary);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  transition: background 0.15s;
}

.user-button:hover {
  background: var(--surface-secondary);
}

.user-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.user-initials {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-info {
  padding: var(--space-3);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.user-name {
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.user-email {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

/* Sign In Button */
.sign-in-btn {
  height: 24px;
  padding: 0 var(--space-3);
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  border-radius: 4px;
  font-size: var(--font-size-caption);
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--font-family-ui);
  cursor: pointer;
  outline: none;
  transition: background 0.15s;
}

.sign-in-btn:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.sign-in-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Error Toast */
.error-toast {
  position: fixed;
  top: 40px;
  right: var(--space-3);
  max-width: 300px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-error-bg);
  border: var(--border-width-thin) solid var(--border-error);
  color: var(--color-error);
  font-size: var(--font-size-caption);
  box-shadow: var(--shadow-md);
  z-index: 2001;
  border-radius: 4px;
}

/* Settings Dropdown */
.settings-dropdown {
  min-width: 280px;
  padding: 0;
}

.settings-section {
  padding: var(--space-3);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.settings-section:last-child {
  border-bottom: none;
}

.setting-header {
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.setting-description {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-bottom: var(--space-3);
  line-height: var(--line-height-normal);
}

.setting-row {
  margin-bottom: var(--space-2);
}

.setting-row:last-child {
  margin-bottom: 0;
}

.setting-row.disabled {
  opacity: 0.5;
}

.setting-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  cursor: pointer;
}

.setting-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  margin-right: var(--space-1);
}

.setting-input-number {
  width: 80px;
  padding: var(--space-1) var(--space-2);
  border: none;
  background: var(--surface-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  text-align: right;
  outline: none;
  transition: border-color 0.15s;
  border-radius: 4px;
}

.setting-input-number:focus {
  border-color: var(--color-accent);
}

.setting-input-number:disabled {
  background: var(--surface-secondary);
  cursor: not-allowed;
}

/* Remove number input spinners for cleaner look */
.setting-input-number::-webkit-inner-spin-button,
.setting-input-number::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.settings-section-danger {
  background: rgba(255, 0, 0, 0.05);
}

.action-button {
  width: 100%;
  padding: var(--space-2);
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.action-button:hover:not(:disabled) {
  background: #0056b3;
}

.action-button:active:not(:disabled) {
  background: #004494;
}

.action-button:disabled {
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.5;
}

.reset-button {
  width: 100%;
  padding: var(--space-2);
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.reset-button:hover {
  background: #c82333;
}

.reset-button:active {
  background: #bd2130;
}

.setting-input-number[type=number] {
  -moz-appearance: textfield;
}

/* Connection Dropdown Styles */
.connection-dropdown {
  min-width: 300px;
  max-width: 400px;
}

.dropdown-section {
  padding: 0;
}

.section-label {
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-3) var(--space-1) var(--space-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--surface-secondary);
}

.connection-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.connection-item.expired {
  opacity: 0.6;
}

.connection-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
}

.connection-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.connection-name {
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.expired-badge {
  font-size: var(--font-size-caption);
  color: var(--color-error);
  font-weight: 600;
}

.connection-actions {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}

.reconnect-btn,
.delete-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  border-radius: 2px;
  transition: all 0.2s;
}

.reconnect-btn:hover {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.delete-btn:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: white;
}

.section-divider {
  height: var(--border-width-thin);
  background: var(--border-primary);
  margin: var(--space-1) 0;
}

.add-section {
  background: var(--surface-secondary);
}

.add-item {
  color: var(--color-primary);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.add-icon {
  font-size: 18px;
  font-weight: 600;
}

.dropdown-arrow {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
}

.nested-menu {
  padding-left: var(--space-3);
  background: var(--surface-tertiary);
}

.nested-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.db-icon {
  width: 16px;
  height: 16px;
}

.project-item {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
}

.placeholder-text {
  color: var(--text-secondary);
  font-style: italic;
}
</style>
