<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBigQueryStore } from '../stores/bigquery'
import { useCanvasStore } from '../stores/canvas'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useSettingsStore } from '../stores/settings'
import { useUserStore } from '../stores/user'
import type { BoxType } from '../types/canvas'
import { DATABASE_INFO } from '../types/database'
import {
  getConnectionDisplayName,
  connectionRequiresAuth
} from '../utils/connectionHelpers'
import { refreshSchemaCache } from '../utils/schemaAdapter'
import PostgresConnectionModal from './PostgresConnectionModal.vue'
import SnowflakeConnectionModal from './SnowflakeConnectionModal.vue'
import CanvasDropdown from './CanvasDropdown.vue'

const router = useRouter()
const bigqueryStore = useBigQueryStore()
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const settingsStore = useSettingsStore()
const userStore = useUserStore()

// Accent color palette presets
const accentColors = [
  '#9333ea',  // Purple (default)
  '#aed581',  // Green
  '#81d4fa',  // Blue
  '#ffcc80',  // Orange
  '#f87171',  // Red
]

// Emits for parent component to handle
const emit = defineEmits<{
  'box-created': [boxId: number]
  'connection-added': [type: 'bigquery' | 'postgres' | 'snowflake', connectionId: string]
  'show-shortcuts': []
}>()

// PostgreSQL modal state
const showPostgresModal = ref(false)

// Snowflake modal state
const showSnowflakeModal = ref(false)

// Delayed expired state - prevents flash when tokens are being refreshed
// Only show "(Expired)" after the token has been expired for 2 seconds
const EXPIRED_DELAY_MS = 2000
const expiredTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())
const delayedExpiredConnections = ref<Set<string>>(new Set())

// Check if we should show expired state for a specific connection (with delay)
const shouldShowExpired = (connectionId: string): boolean => {
  return delayedExpiredConnections.value.has(connectionId)
}

// Check if active connection should show expired state (with delay)
const shouldShowActiveExpired = computed(() => {
  if (!connectionsStore.activeConnectionId) return false
  return delayedExpiredConnections.value.has(connectionsStore.activeConnectionId)
})

// Watch for changes in connection expired states and apply delay
watch(
  () => connectionsStore.connections.map(c => ({
    id: c.id,
    type: c.type,
    expired: connectionRequiresAuth(c.type) && connectionsStore.isConnectionExpired(c.id)
  })),
  (newStates) => {
    for (const state of newStates) {
      const currentlyShowingExpired = delayedExpiredConnections.value.has(state.id)
      const existingTimer = expiredTimers.value.get(state.id)

      if (state.expired && !currentlyShowingExpired && !existingTimer) {
        // Token just expired - start timer to show expired state after delay
        const timer = setTimeout(() => {
          delayedExpiredConnections.value.add(state.id)
          expiredTimers.value.delete(state.id)
        }, EXPIRED_DELAY_MS)
        expiredTimers.value.set(state.id, timer)
      } else if (!state.expired) {
        // Token is valid - clear any pending timer and hide expired state
        if (existingTimer) {
          clearTimeout(existingTimer)
          expiredTimers.value.delete(state.id)
        }
        delayedExpiredConnections.value.delete(state.id)
      }
    }
  },
  { immediate: true, deep: true }
)

// Clean up timers on unmount
onUnmounted(() => {
  for (const timer of expiredTimers.value.values()) {
    clearTimeout(timer)
  }
})

// Single dropdown state - opening one closes others
const activeDropdown = ref<string | null>(null) // 'canvas', 'connection', 'box', 'settings', 'user'

const userInitial = computed(() => {
  const email = userStore.user?.email || '?'
  return email.charAt(0).toUpperCase()
})


const toggleUserDropdown = () => {
  activeDropdown.value = activeDropdown.value === 'user' ? null : 'user'
}

const handleSignIn = async () => {
  closeDropdown()
  // Use login-only flow - only requests email permission (incremental auth)
  await userStore.loginWithGoogle()
}

const handleSignOut = async () => {
  closeDropdown()
  await userStore.logout()
}

const goToAccount = () => {
  closeDropdown()
  router.push('/account')
}

const showShortcuts = () => {
  closeDropdown()
  emit('show-shortcuts')
}

// Box types
const boxTypes: Array<{ id: BoxType; name: string }> = [
  { id: 'sql', name: 'SQL editor' },
  { id: 'schema', name: 'Schema browser' },
  { id: 'note', name: 'Sticky note' },
  { id: 'history', name: 'Query history' }
]

// Submenu state
const addDatabaseMenuOpen = ref(false)

// Settings state
const fetchBatchInputValue = ref<number | string>(settingsStore.fetchBatchSize)
const paginationInputValue = ref<number | string>(settingsStore.paginationSize)
const editorFontSizeInputValue = ref<number | string>(settingsStore.editorFontSize)

// Toggle dropdown - opening one closes all others
const toggleDropdown = (dropdown: string) => {
  if (activeDropdown.value === dropdown) {
    activeDropdown.value = null
  } else {
    activeDropdown.value = dropdown
    addDatabaseMenuOpen.value = false // Close submenu when switching dropdowns

    // Load projects when opening connection dropdown (BigQuery only)
    if (dropdown === 'connection' && connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired) {
      bigqueryStore.fetchProjects().catch(err => console.error('Failed to load projects:', err))
    }
  }
}

// Close all dropdowns
const closeDropdown = () => {
  activeDropdown.value = null
  addDatabaseMenuOpen.value = false
}

// Handle connection selection
const handleConnectionSelect = async (connectionId: string) => {
  const connection = connectionsStore.connections.find(c => c.id === connectionId)
  if (!connection) return

  connectionsStore.setActiveConnection(connectionId)

  // Handle connection-specific setup
  if (connection.type === 'bigquery') {
    await bigqueryStore.fetchProjects().catch(err => console.error('Failed to load projects:', err))
    // Sync auth store with connection's project
    if (connection.projectId) {
      bigqueryStore.setProjectId(connection.projectId)
    }
  } else if (connection.type === 'postgres') {
    // Prefetch PostgreSQL schema for autocompletion
    bigqueryStore.setProjectId(null as any)
    await postgresStore.fetchAllColumns(connectionId).catch(err => console.error('Failed to load PostgreSQL schema:', err))
  } else if (connection.type === 'snowflake') {
    // Prefetch Snowflake schema for autocompletion
    bigqueryStore.setProjectId(null as any)
    await snowflakeStore.fetchAllColumns(connectionId).catch(err => console.error('Failed to load Snowflake schema:', err))
  } else {
    // DuckDB or other local connections
    bigqueryStore.setProjectId(null as any)
  }

  closeDropdown()
}

// Handle project selection - stores project on the active connection
const handleProjectSelect = async (projectId: string) => {
  const activeConnectionId = connectionsStore.activeConnectionId
  if (activeConnectionId) {
    connectionsStore.setConnectionProjectId(activeConnectionId, projectId)
  }
  bigqueryStore.setProjectId(projectId)
  closeDropdown()

  // Fetch all schemas using INFORMATION_SCHEMA
  try {
    await bigqueryStore.fetchAllSchemas()
  } catch (error) {
    console.error('Failed to fetch schemas:', error)
  }
}

// Handle add database
const handleAddDatabase = async (databaseType: string) => {
  addDatabaseMenuOpen.value = false
  activeDropdown.value = null

  if (databaseType === 'bigquery') {
    try {
      await bigqueryStore.signInWithGoogle()
      // Wait for Vue reactivity to settle after connection is added
      await nextTick()

      const connectionId = connectionsStore.activeConnectionId
      if (connectionId) {
        emit('connection-added', 'bigquery', connectionId)
      }

      // Re-open dropdown to show the new connection
      activeDropdown.value = 'connection'
      await bigqueryStore.fetchProjects()

      // Auto-select first project if available
      if (bigqueryStore.projects.length > 0) {
        handleProjectSelect(bigqueryStore.projects[0].projectId)
      }
    } catch (error) {
      console.error('Failed to add database:', error)
    }
  } else if (databaseType === 'postgres') {
    showPostgresModal.value = true
  } else if (databaseType === 'snowflake') {
    showSnowflakeModal.value = true
  }
}

// Handle successful PostgreSQL connection
const handlePostgresConnected = (connectionId: string) => {
  console.log('PostgreSQL connected:', connectionId)
  emit('connection-added', 'postgres', connectionId)
  // Re-open dropdown to show the new connection
  activeDropdown.value = 'connection'
}

// Handle successful Snowflake connection
const handleSnowflakeConnected = (connectionId: string) => {
  console.log('Snowflake connected:', connectionId)
  emit('connection-added', 'snowflake', connectionId)
  // Re-open dropdown to show the new connection
  activeDropdown.value = 'connection'
}

// Handle delete connection
const handleDeleteConnection = (connectionId: string, event: Event) => {
  event.stopPropagation()
  connectionsStore.removeConnection(connectionId)
}

// Handle reconnect
const handleReconnect = async (connectionId: string, event: Event) => {
  event.stopPropagation()
  try {
    await bigqueryStore.reconnectConnection(connectionId)
    await bigqueryStore.fetchProjects()
  } catch (error) {
    console.error('Failed to reconnect:', error)
  }
}

// Add box with engine and connection based on active connection
const addBox = (boxType: BoxType) => {
  const activeConnection = connectionsStore.activeConnection
  const engine = activeConnection?.type || 'duckdb'
  const connectionId = activeConnection?.id
  const boxId = canvasStore.addBox(boxType, null, engine, connectionId)
  emit('box-created', boxId)
  closeDropdown()
}

// Handle refresh schemas for all connections
const handleRefreshSchemas = async () => {
  try {
    const connections = connectionsStore.connections
    let refreshedCount = 0

    // Refresh DuckDB (always available)
    await duckdbStore.loadTablesMetadata()
    refreshSchemaCache('duckdb') // Update localStorage cache
    refreshedCount++

    // Refresh all BigQuery connections with project IDs (token refresh handled automatically)
    for (const conn of connections.filter(c => c.type === 'bigquery')) {
      if (conn.projectId) {
        await bigqueryStore.fetchAllSchemas(conn.projectId, conn.id)
        refreshedCount++
      }
    }
    // Update BigQuery cache once after all connections refreshed
    if (connections.some(c => c.type === 'bigquery')) {
      refreshSchemaCache('bigquery')
    }

    // Refresh all PostgreSQL connections
    for (const conn of connections.filter(c => c.type === 'postgres')) {
      await postgresStore.refreshSchemas(conn.id)
      refreshSchemaCache('postgres', conn.id) // Update localStorage cache
      refreshedCount++
    }

    // Refresh all Snowflake connections
    for (const conn of connections.filter(c => c.type === 'snowflake')) {
      await snowflakeStore.refreshSchemas(conn.id)
      refreshSchemaCache('snowflake', conn.id) // Update localStorage cache
      refreshedCount++
    }

    alert(`Schemas refreshed successfully! (${refreshedCount} connection${refreshedCount !== 1 ? 's' : ''})`)
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

// Handle fetch batch size changes with debouncing
let fetchBatchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const handleFetchBatchChange = (e: Event) => {
  const value = (e.target as HTMLInputElement).value
  fetchBatchInputValue.value = value

  // Debounce setting the value
  if (fetchBatchDebounceTimer) clearTimeout(fetchBatchDebounceTimer)
  fetchBatchDebounceTimer = setTimeout(() => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue > 0) {
      settingsStore.setFetchBatchSize(numValue)
    }
  }, 500)
}

// Handle pagination size changes with debouncing
let paginationDebounceTimer: ReturnType<typeof setTimeout> | null = null
const handlePaginationChange = (e: Event) => {
  const value = (e.target as HTMLInputElement).value
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

// Handle editor font size changes with debouncing
let fontSizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
const handleEditorFontSizeChange = (e: Event) => {
  const value = (e.target as HTMLInputElement).value
  editorFontSizeInputValue.value = value

  // Debounce setting the value
  if (fontSizeDebounceTimer) clearTimeout(fontSizeDebounceTimer)
  fontSizeDebounceTimer = setTimeout(() => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue >= 8 && numValue <= 24) {
      settingsStore.setEditorFontSize(numValue)
    }
  }, 500)
}

// Sync fetch batch input when store changes
watch(() => settingsStore.fetchBatchSize, (newValue) => {
  fetchBatchInputValue.value = newValue
})

// Sync pagination input when store changes
watch(() => settingsStore.paginationSize, (newValue) => {
  paginationInputValue.value = newValue
})

// Sync editor font size input when store changes
watch(() => settingsStore.editorFontSize, (newValue) => {
  editorFontSizeInputValue.value = newValue
})

// Close dropdown when clicking outside
const handleClickOutside = (e: Event) => {
  if (!(e.target as HTMLElement).closest('.menu-item')) {
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
      <router-link to="/" class="app-name">Squill</router-link>

      <!-- Canvas Dropdown -->
      <CanvasDropdown
        :active-dropdown="activeDropdown"
        @toggle-dropdown="toggleDropdown"
        @close-dropdown="closeDropdown"
      />

      <!-- Unified Connection Dropdown -->
      <div class="menu-item" :class="{ active: activeDropdown === 'connection' }">
        <button class="menu-button" @click.stop="toggleDropdown('connection')">
          <span v-if="connectionsStore.activeConnection?.type === 'bigquery' && connectionsStore.activeConnection?.projectId" class="menu-text">
            {{ getConnectionDisplayName(connectionsStore.activeConnection) }} / {{ connectionsStore.activeConnection.projectId }}
            <span v-if="shouldShowActiveExpired" class="token-expired-indicator"> (Expired)</span>
          </span>
          <span v-else-if="connectionsStore.activeConnection" class="menu-text">
            {{ getConnectionDisplayName(connectionsStore.activeConnection) }}
            <span v-if="shouldShowActiveExpired" class="token-expired-indicator"> (Expired)</span>
          </span>
          <span v-else class="menu-text placeholder-text">
            No connection
          </span>
          <span class="menu-caret">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
        </button>

        <Transition name="dropdown">
        <div v-if="activeDropdown === 'connection'" class="dropdown connection-dropdown">
          <!-- Connections Section -->
          <div v-if="connectionsStore.connections.length > 0" class="dropdown-section">
            <div class="section-label">Connections</div>
            <button
              v-for="connection in connectionsStore.connections"
              :key="connection.id"
              class="dropdown-item connection-item"
              :class="{
                selected: connectionsStore.activeConnectionId === connection.id,
                expired: shouldShowExpired(connection.id)
              }"
              @click="handleConnectionSelect(connection.id)"
            >
              <div class="connection-info">
                <div class="connection-name">{{ getConnectionDisplayName(connection) }}</div>
                <div v-if="shouldShowExpired(connection.id)" class="expired-badge">
                  Token Expired
                </div>
              </div>
              <div class="connection-actions" @click.stop>
                <button
                  v-if="shouldShowExpired(connection.id)"
                  class="reconnect-btn"
                  @click="handleReconnect(connection.id, $event)"
                  v-tooltip="'Reconnect'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                    <path d="M3 21v-5h5"/>
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  @click="handleDeleteConnection(connection.id, $event)"
                  v-tooltip="'Delete'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </button>
          </div>

          <!-- Projects Section (BigQuery only) -->
          <div v-if="connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired" class="dropdown-section">
            <div class="section-label">Projects</div>
            <div v-if="bigqueryStore.projects.length === 0" class="dropdown-message">
              No projects found
            </div>
            <button
              v-for="project in bigqueryStore.projects"
              :key="project.projectId"
              class="dropdown-item project-item"
              :class="{ selected: project.projectId === connectionsStore.activeConnection?.projectId }"
              @click="handleProjectSelect(project.projectId)"
            >
              <span class="item-text">{{ project.name || project.projectId }}</span>
              <span v-if="project.projectId === connectionsStore.activeConnection?.projectId" class="item-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </span>
            </button>
          </div>

          <!-- Add Database Section -->
          <div class="dropdown-section add-section">
            <div class="section-divider"></div>
            <div class="submenu-trigger">
              <button
                class="dropdown-item add-item"
                @click.stop="addDatabaseMenuOpen = !addDatabaseMenuOpen"
              >
                <span class="add-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </span>
                Add database
                <span class="dropdown-arrow">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 6l6 6-6 6"/>
                  </svg>
                </span>
              </button>

              <!-- Flyout submenu -->
              <div class="flyout-menu" :class="{ open: addDatabaseMenuOpen }" @click.stop>
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('bigquery')"
                >
                  <img :src="DATABASE_INFO.bigquery.logo" :alt="DATABASE_INFO.bigquery.name" class="db-icon" />
                  {{ DATABASE_INFO.bigquery.name }}
                </button>
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('postgres')"
                >
                  <img :src="DATABASE_INFO.postgres.logo" :alt="DATABASE_INFO.postgres.name" class="db-icon" />
                  {{ DATABASE_INFO.postgres.name }}
                </button>
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('snowflake')"
                >
                  <img :src="DATABASE_INFO.snowflake.logo" :alt="DATABASE_INFO.snowflake.name" class="db-icon" />
                  {{ DATABASE_INFO.snowflake.name }}
                </button>
              </div>
            </div>
          </div>
        </div>
        </Transition>
      </div>

      <!-- Add Box Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'box' }">
        <button class="menu-button" @click.stop="toggleDropdown('box')">
          <span class="menu-text">Add</span>
          <span class="menu-caret">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
        </button>

        <Transition name="dropdown">
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
        </Transition>
      </div>

    </div>

    <div class="menu-right">
      <!-- Settings Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'settings' }">
        <button class="menu-button" @click.stop="toggleDropdown('settings')">
          <span class="menu-text">Settings</span>
          <span class="menu-caret">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
        </button>

        <Transition name="dropdown">
        <div v-if="activeDropdown === 'settings'" class="dropdown settings-dropdown right-dropdown">
          <div class="settings-section">
            <div class="setting-header">Fetch pagination</div>
            <div class="setting-description">
              Load large result sets in batches for better performance
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <input
                  type="checkbox"
                  :checked="settingsStore.fetchPaginationEnabled"
                  @change="settingsStore.toggleFetchPagination"
                  class="setting-checkbox"
                />
                <span>Enable fetch pagination</span>
              </label>
            </div>

            <div class="setting-row" :class="{ disabled: !settingsStore.fetchPaginationEnabled }">
              <label class="setting-label">
                <span>Rows per batch</span>
                <input
                  type="number"
                  :value="fetchBatchInputValue"
                  @input="handleFetchBatchChange"
                  :disabled="!settingsStore.fetchPaginationEnabled"
                  min="100"
                  max="100000"
                  class="setting-input-number"
                />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="setting-header">
              AI autofix
              <span v-if="!userStore.isPro" class="pro-badge">Pro</span>
            </div>
            <div class="setting-description">
              Automatically suggest fixes when queries fail
            </div>

            <div class="setting-row" :class="{ disabled: !userStore.isPro }">
              <label class="setting-label">
                <input
                  type="checkbox"
                  :checked="settingsStore.autofixEnabled"
                  @change="settingsStore.toggleAutofix"
                  :disabled="!userStore.isPro"
                  class="setting-checkbox"
                />
                <span>Enable AI autofix</span>
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
            <div class="setting-header">Code editor</div>
            <div class="setting-description">
              Configure the SQL editor appearance
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <span>Font size</span>
                <input
                  type="number"
                  :value="editorFontSizeInputValue"
                  @input="handleEditorFontSizeChange"
                  min="8"
                  max="24"
                  class="setting-input-number"
                />
              </label>
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <input
                  type="checkbox"
                  :checked="settingsStore.showEditorLineNumbers"
                  @change="settingsStore.toggleEditorLineNumbers"
                  class="setting-checkbox"
                />
                <span>Show line numbers</span>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="setting-header">Appearance</div>
            <div class="setting-description">
              Change the look and feel of the canvas
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <span>Theme</span>
                <select
                  :value="settingsStore.themePreference"
                  @change="settingsStore.setThemePreference(($event.target as HTMLSelectElement).value as 'system' | 'light' | 'dark')"
                  class="setting-select"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>

            <div class="setting-row">
              <label class="setting-label">
                <span>Canvas pattern</span>
                <select
                  :value="settingsStore.canvasPattern"
                  @change="settingsStore.setCanvasPattern(($event.target as HTMLSelectElement).value as 'dots' | 'grid' | 'crosshatch' | 'waves' | 'none')"
                  class="setting-select"
                >
                  <option value="dots">Dots</option>
                  <option value="grid">Grid</option>
                  <option value="crosshatch">Crosshatch</option>
                  <option value="waves">Waves</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="setting-header">Accent color</div>
            <div class="setting-description">
              Main highlight color used throughout the app
            </div>
            <div class="color-palette">
              <button
                v-for="color in accentColors"
                :key="color"
                class="color-swatch"
                :class="{ active: settingsStore.accentColor === color }"
                :style="{ background: color }"
                @click="settingsStore.setTableLinkHighlightColor(color)"
                :title="color"
              />
              <label class="color-picker-wrapper">
                <input
                  type="color"
                  class="color-picker-input"
                  :value="settingsStore.accentColor"
                  @input="settingsStore.setTableLinkHighlightColor(($event.target as HTMLInputElement).value)"
                />
                <span
                  class="color-swatch color-picker-swatch"
                  :class="{ active: !accentColors.includes(settingsStore.accentColor) }"
                  :style="{ background: accentColors.includes(settingsStore.accentColor) ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : settingsStore.accentColor }"
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

          <div class="settings-section">
            <div class="setting-header">Schema cache</div>
            <div class="setting-description">
              Refresh schema information for all connections
            </div>
            <button @click="handleRefreshSchemas" class="action-button">
              Refresh schemas
            </button>
          </div>

          <div class="settings-section">
            <div class="setting-header">Help</div>
            <button @click="showShortcuts" class="action-button">
              Keyboard shortcuts
            </button>
          </div>

          <div class="settings-section settings-section-danger">
            <div class="setting-header">Reset</div>
            <div class="setting-description">
              Clear all data including connections, queries, and cached results
            </div>
            <button @click="handleResetAll" class="reset-button">
              Reset all data
            </button>
          </div>
        </div>
        </Transition>
      </div>
      <!-- Pro Badge -->
      <span v-if="userStore.isPro" class="pro-badge menu-pro-badge">Pro</span>

      <!-- User Menu -->
      <div v-if="userStore.isLoggedIn" class="menu-item user-menu-item">
        <button class="user-button" @click.stop="toggleUserDropdown">
          <span class="user-initials">{{ userInitial }}</span>
        </button>

        <Transition name="dropdown">
        <div v-if="activeDropdown === 'user'" class="dropdown user-dropdown">
          <div class="user-info">
            <div class="user-email">{{ userStore.user?.email }}</div>
          </div>
          <button class="dropdown-item" @click="goToAccount">
            <span class="item-text">Account</span>
          </button>
          <button class="dropdown-item" @click="handleSignOut">
            <span class="item-text">Sign out</span>
          </button>
        </div>
        </Transition>
      </div>

      <!-- Sign In Button (when not logged in) -->
      <button
        v-else
        class="sign-in-btn"
        @click="handleSignIn"
        :disabled="userStore.isLoading"
      >
        {{ userStore.isLoading ? 'Signing in...' : 'Sign in' }}
      </button>
    </div>
  </div>

  <!-- PostgreSQL Connection Modal -->
  <PostgresConnectionModal
    :show="showPostgresModal"
    :user-email="userStore.user?.email || connectionsStore.activeConnection?.email || 'anonymous'"
    @close="showPostgresModal = false"
    @connected="handlePostgresConnected"
  />

  <!-- Snowflake Connection Modal -->
  <SnowflakeConnectionModal
    :show="showSnowflakeModal"
    :user-email="userStore.user?.email || connectionsStore.activeConnection?.email || 'anonymous'"
    @close="showSnowflakeModal = false"
    @connected="handleSnowflakeConnected"
  />
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
  text-decoration: none;
  transition: opacity 0.15s;
}

.app-name:hover {
  opacity: 0.7;
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
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
}

.menu-caret svg {
  display: block;
}

/* Dropdown */
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  background: var(--dropdown-bg);
  border: var(--dropdown-border);
  border-radius: var(--dropdown-border-radius);
  box-shadow: var(--dropdown-shadow);
  margin-top: 1px;
  z-index: var(--dropdown-z-index);
  max-height: 400px;
  overflow-y: auto;
}

.user-dropdown,
.right-dropdown {
  right: 0;
  left: auto;
}

.user-menu-item {
  position: relative;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--dropdown-item-padding);
  background: transparent;
  border: none;
  border-bottom: var(--dropdown-item-border);
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
  background: var(--dropdown-item-hover-bg);
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
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
}

.item-check svg {
  display: block;
}

.dropdown-message {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

/* User Button */
.user-button {
  padding: 2px 6px;
  border-radius: 3px;
  border: var(--border-width-thin) solid var(--border-primary);
  background: var(--surface-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  transition: background 0.15s;
}

.user-button:hover {
  background: var(--surface-secondary);
}

.user-initials {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-primary);
}

.user-info {
  padding: var(--space-3);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
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
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pro-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  background: var(--text-primary);
  color: var(--surface-primary);
  border-radius: 3px;
}

.menu-pro-badge {
  margin-right: var(--space-2);
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

.setting-select {
  padding: var(--space-1) var(--space-2);
  border: none;
  background: var(--surface-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  outline: none;
  border-radius: 4px;
  cursor: pointer;
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

/* Color palette for highlight colors */
.color-palette {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  padding: 0;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  box-shadow: 0 0 0 2px var(--surface-primary), 0 0 0 3px var(--border-secondary);
}

.color-picker-wrapper {
  position: relative;
  cursor: pointer;
}

.color-picker-input {
  position: absolute;
  width: 24px;
  height: 24px;
  opacity: 0;
  cursor: pointer;
}

.color-picker-swatch {
  display: block;
}

/* Connection Dropdown Styles */
.connection-dropdown {
  min-width: 300px;
  max-width: 400px;
  overflow: visible; /* Allow flyout submenu to extend outside */
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
  padding: 0;
  border-radius: 2px;
  transition: all 0.2s;
}

.reconnect-btn svg,
.delete-btn svg {
  display: block;
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.add-icon svg {
  display: block;
}

.dropdown-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.6;
}

.dropdown-arrow svg {
  display: block;
}

/* Flyout submenu trigger container */
.submenu-trigger {
  position: relative;
}

/* Highlight parent item when flyout is open */
.submenu-trigger:has(.flyout-menu) .add-item {
  background: var(--surface-secondary);
}

/* Flyout menu - appears to the right like classic OS menus */
.flyout-menu {
  position: absolute;
  left: calc(100% - 2px); /* Slight overlap for visual connection */
  top: -1px; /* Align with parent border */
  min-width: 160px;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: 4px 4px 0 0 rgba(0, 0, 0, 0.15); /* Retro hard shadow */
  z-index: 2001;
  /* Animation */
  opacity: 0;
  visibility: hidden;
  transform: translateX(-8px);
  transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
  pointer-events: none;
}

.flyout-menu.open {
  opacity: 1;
  visibility: visible;
  transform: translateX(0);
  pointer-events: auto;
}

.flyout-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border-bottom: none; /* Clean look for single item */
}

.flyout-item:hover {
  background: var(--surface-secondary);
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

/* About Dropdown */
.about-dropdown {
  min-width: 180px;
}

.about-dropdown .dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.about-dropdown .dropdown-item:hover .item-icon {
  color: var(--text-primary);
}

.external-link-icon {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* About Modal - uses global .modal-overlay from style.css */

.modal-content {
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
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
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.modal-close:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--space-4);
  overflow-y: auto;
  flex: 1;
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  line-height: var(--line-height-relaxed);
}

.modal-body p {
  margin: 0 0 var(--space-3) 0;
}

.modal-body p:last-child {
  margin-bottom: 0;
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

</style>
