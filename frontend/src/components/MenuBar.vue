<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import { useBigQueryStore } from '../stores/bigquery'
import { useCanvasStore } from '../stores/canvas'

const ShareDialog = defineAsyncComponent(() => import('./ShareDialog.vue'))
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { useClickHouseStore } from '../stores/clickhouse'
import { useSnowflakeStore } from '../stores/snowflake'
import { useUserStore } from '../stores/user'
import type { BoxType } from '../types/canvas'
import type { ConnectionType } from '../types/connection'
import { DATABASE_INFO } from '../types/database'
import { useDialog } from '../composables/useDialog'

const { confirm, prompt: promptDialog } = useDialog()
import {
  getConnectionDisplayName,
  connectionRequiresAuth
} from '../utils/connectionHelpers'
import { refreshSchemaCache } from '../utils/schemaAdapter'
import ClickHouseConnectionModal from './ClickHouseConnectionModal.vue'
import SnowflakeConnectionModal from './SnowflakeConnectionModal.vue'
import { isTauri } from '../utils/tauri'

// Web-only features (accounts, billing) are hidden in the desktop app.
const isWebApp = !isTauri()
import SettingsPanel from './SettingsPanel.vue'
import CopyButton from './CopyButton.vue'
import { BACKEND_URL } from '@/services/backend'

const router = useRouter()
const bigqueryStore = useBigQueryStore()
const projectSearch = ref('')
const projectSearchRef = ref<HTMLInputElement | null>(null)
const projectsLoading = ref(false)
const sortedProjects = computed(() =>
  [...bigqueryStore.projects].sort((a, b) => {
    const aSelected = isProjectSelected(a.projectId)
    const bSelected = isProjectSelected(b.projectId)
    if (aSelected !== bSelected) return aSelected ? -1 : 1
    return a.projectId.localeCompare(b.projectId)
  })
)
const filteredProjects = computed(() => {
  const q = projectSearch.value.toLowerCase()
  if (!q) return sortedProjects.value
  return sortedProjects.value.filter(p => p.projectId.toLowerCase().includes(q))
})
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const clickhouseStore = useClickHouseStore()
const snowflakeStore = useSnowflakeStore()
const userStore = useUserStore()

// Emits for parent component to handle
const emit = defineEmits<{
  'box-created': [boxId: number]
  'connection-added': [type: 'bigquery' | 'clickhouse' | 'snowflake', connectionId: string]
  'show-shortcuts': []
  'import-files': [files: File[]]
}>()

// ClickHouse modal state
const showClickHouseModal = ref(false)

// Snowflake modal state
const showSnowflakeModal = ref(false)

// Settings panel state
const showSettingsPanel = ref(false)

// Delayed expired state - prevents flash when tokens are being refreshed
// Only show "(Expired)" after the token has been expired for 2 seconds
const EXPIRED_DELAY_MS = 2000
const expiredTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())
const delayedExpiredConnections = ref<Set<string>>(new Set())

// Check if we should show expired state for a specific connection (with delay)
const shouldShowExpired = (connectionId: string): boolean => {
  return delayedExpiredConnections.value.has(connectionId)
}

// Show warning icon on the Connection menu button when active connection has issues
const activeConnectionHasIssue = computed(() => {
  if (!connectionsStore.activeConnectionId) return false
  return shouldShowExpired(connectionsStore.activeConnectionId)
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
const activeDropdown = ref<string | null>(null) // 'canvas', 'connection', 'new', 'tools', 'user'
const showShareDialog = ref(false)
const showMcpModal = ref(false)

const mcpUrl = computed(() => `${BACKEND_URL}/mcp/`)
const mcpCommand = computed(() => `claude mcp add --transport http squill ${mcpUrl.value}`)
const mcpJson = computed(() => JSON.stringify({ mcpServers: { squill: { type: 'http', url: mcpUrl.value } } }, null, 2))

const userDisplayName = computed(() => {
  const u = userStore.user
  if (!u) return null
  if (u.firstName) return u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName
  return u.email
})

const userInitial = computed(() => {
  const name = userStore.user?.firstName || userStore.user?.email || '?'
  return name.charAt(0).toUpperCase()
})


const toggleUserDropdown = () => {
  activeDropdown.value = activeDropdown.value === 'user' ? null : 'user'
}

const handleSignInGoogle = async () => {
  closeDropdown()
  await userStore.loginWithGoogle()
}

const handleSignInGitHub = async () => {
  closeDropdown()
  await userStore.loginWithGitHub()
}

const toggleSignInDropdown = () => {
  activeDropdown.value = activeDropdown.value === 'signin' ? null : 'signin'
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

// Import file input
const importFileInput = ref<HTMLInputElement | null>(null)
const handleImportClick = () => {
  importFileInput.value?.click()
}
const handleImportFiles = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    emit('import-files', Array.from(input.files))
    input.value = '' // Reset so same file can be re-selected
  }
}

// Submenu state
const addDatabaseMenuOpen = ref(false)

// Toggle dropdown - opening one closes all others
const toggleDropdown = (dropdown: string) => {
  if (activeDropdown.value === dropdown) {
    activeDropdown.value = null
  } else {
    activeDropdown.value = dropdown
    addDatabaseMenuOpen.value = false // Close submenu when switching dropdowns

    // Load projects when opening connection dropdown (BigQuery only)
    if (dropdown === 'connection' && connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired) {
      projectsLoading.value = true
      bigqueryStore.fetchProjects()
        .catch(err => console.error('Failed to load projects:', err))
        .finally(() => { projectsLoading.value = false })
      // Auto-focus handled by watch on projectSearchRef below
    }
  }
}

// Close all dropdowns
const closeDropdown = () => {
  activeDropdown.value = null
  addDatabaseMenuOpen.value = false
  projectSearch.value = ''
  projectsLoading.value = false
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
  } else if (connection.type === 'clickhouse') {
    // Prefetch ClickHouse schema for autocompletion
    bigqueryStore.setProjectId(null)
    await clickhouseStore.fetchAllColumns(connectionId).catch(err => console.error('Failed to load ClickHouse schema:', err))
  } else if (connection.type === 'snowflake') {
    // Prefetch Snowflake schema for autocompletion
    bigqueryStore.setProjectId(null)
    await snowflakeStore.fetchAllColumns(connectionId).catch(err => console.error('Failed to load Snowflake schema:', err))
  } else {
    // DuckDB or other local connections
    bigqueryStore.setProjectId(null)
  }

  closeDropdown()
}

// Check if a project is selected for schema loading
const isProjectSelected = (projectId: string): boolean => {
  const conn = connectionsStore.activeConnection
  if (!conn) return false
  return connectionsStore.getSchemaProjectIds(conn.id).includes(projectId)
}

// Check if a project is the billing/active project
const isBillingProject = (projectId: string): boolean => {
  return connectionsStore.activeConnection?.projectId === projectId
}

// Count of extra selected projects beyond the billing project
// Handle project toggle — add/remove from schemaProjectIds
const handleProjectToggle = async (projectId: string) => {
  const connectionId = connectionsStore.activeConnectionId
  if (!connectionId) return

  if (isProjectSelected(projectId)) {
    // Deselect: remove schemas and from list
    connectionsStore.removeSchemaProject(connectionId, projectId)
    try {
      await duckdbStore.removeConnectionCatalogSchemas('bigquery', connectionId, projectId)
      const { clearSchemaCache } = await import('../utils/schemaAdapter')
      clearSchemaCache('bigquery')
    } catch (err) {
      console.warn(`Failed to remove schemas for ${projectId}:`, err)
    }
    // If it was the billing project, set to first remaining or undefined
    if (isBillingProject(projectId)) {
      const remaining = connectionsStore.getSchemaProjectIds(connectionId)
      const newBilling = remaining.length > 0 ? remaining[0] : undefined
      connectionsStore.setConnectionProjectId(connectionId, newBilling)
      bigqueryStore.setProjectId(newBilling || null)
    }
  } else {
    // Select: add to list and fetch schemas
    connectionsStore.addSchemaProject(connectionId, projectId)
    // If no billing project set, make this one the billing project
    if (!connectionsStore.activeConnection?.projectId) {
      connectionsStore.setConnectionProjectId(connectionId, projectId)
      bigqueryStore.setProjectId(projectId)
    }
    try {
      duckdbStore.schemaRefreshMessage = `Refreshing BigQuery schemas (${projectId})...`
      await bigqueryStore.fetchAllSchemas(projectId, connectionId)
    } catch (err) {
      console.warn(`Failed to fetch schemas for ${projectId}:`, err)
    } finally {
      duckdbStore.schemaRefreshMessage = null
    }
  }
}

// Set billing/active project (for query execution)
const handleSetBillingProject = (projectId: string, event: Event) => {
  event.stopPropagation()
  const connectionId = connectionsStore.activeConnectionId
  if (!connectionId) return
  connectionsStore.setConnectionProjectId(connectionId, projectId)
  bigqueryStore.setProjectId(projectId)
}

// Handle add database
const handleAddDatabase = async (databaseType: string) => {
  addDatabaseMenuOpen.value = false
  activeDropdown.value = null

  // Require Squill login for server-proxied connection types (web only).
  // In Tauri, BigQuery authenticates directly with Google — no Squill account needed.
  if (!isTauri() && connectionRequiresAuth(databaseType as ConnectionType) && !userStore.isLoggedIn) {
    await userStore.loginWithGoogle()
    if (!userStore.isLoggedIn) return
  }

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
        handleProjectToggle(bigqueryStore.projects[0].projectId)
      }
    } catch (error) {
      console.error('Failed to add database:', error)
    }
  } else if (databaseType === 'clickhouse') {
    showClickHouseModal.value = true
  } else if (databaseType === 'snowflake') {
    showSnowflakeModal.value = true
  }
}

// Handle successful ClickHouse connection
const handleClickHouseConnected = (connectionId: string) => {
  console.log('ClickHouse connected:', connectionId)
  emit('connection-added', 'clickhouse', connectionId)
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

// Handle refresh schemas for all connections (resilient — skip failures, warn in console)
const handleRefreshSchemas = async () => {
  closeDropdown()
  try {
    const connections = connectionsStore.connections

    // Refresh DuckDB (always available)
    duckdbStore.schemaRefreshMessage = 'Refreshing DuckDB tables...'
    await duckdbStore.loadTablesMetadata()
    await refreshSchemaCache('duckdb')

    // Refresh all BigQuery connections — loop per schema project
    for (const conn of connections.filter(c => c.type === 'bigquery')) {
      const projectIds = connectionsStore.getSchemaProjectIds(conn.id)
      for (const pid of projectIds) {
        try {
          duckdbStore.schemaRefreshMessage = `Refreshing BigQuery schemas (${pid})...`
          await bigqueryStore.fetchAllSchemas(pid, conn.id)
        } catch (err) {
          console.warn(`Schema refresh failed for BigQuery project ${pid}:`, err)
        }
      }
    }
    if (connections.some(c => c.type === 'bigquery')) {
      await refreshSchemaCache('bigquery')
    }

    // Offset-based engines (identical pattern)
    const offsetEngines = [
      { type: 'clickhouse' as const, label: 'ClickHouse', store: clickhouseStore },
      { type: 'snowflake' as const, label: 'Snowflake', store: snowflakeStore },
    ]
    for (const { type, label, store } of offsetEngines) {
      for (const conn of connections.filter(c => c.type === type)) {
        try {
          duckdbStore.schemaRefreshMessage = `Refreshing ${label} schemas (${conn.name || conn.id})...`
          await store.refreshSchemas(conn.id)
          await refreshSchemaCache(type, conn.id)
        } catch (err) {
          console.warn(`Schema refresh failed for ${label} ${conn.name || conn.id}:`, err)
        }
      }
    }
  } catch (error) {
    console.error('Failed to refresh schemas:', error)
  } finally {
    duckdbStore.schemaRefreshMessage = null
  }
}

// Handle reset all data
const handleResetAll = async () => {
  closeDropdown()
  const confirmed = await confirm('This will clear all data including connections, queries, and cached results. Are you sure?')
  if (confirmed) {
    const { deleteDatabase } = await import('../utils/db')
    await deleteDatabase()
    window.location.reload()
  }
}

// Auto-focus the project filter input when it appears (after projects load)
watch(projectSearchRef, (el) => {
  if (el && activeDropdown.value === 'connection') {
    el.focus()
  }
})

// --- Canvas management (inlined from CanvasDropdown) ---

// Canvas list sorted by recent
const canvasList = computed(() => canvasStore.getCanvasList())

// Handle canvas selection
const handleCanvasSelect = async (canvasId: string) => {
  await canvasStore.switchCanvas(canvasId)
  closeDropdown()
}

// Handle create new canvas
const handleCreateCanvas = () => {
  canvasStore.createCanvas()
  closeDropdown()
}

// Handle duplicate active canvas
const handleDuplicateActive = async () => {
  if (!canvasStore.activeCanvasId) return
  await canvasStore.duplicateCanvas(canvasStore.activeCanvasId)
  closeDropdown()
}

// Handle delete active canvas
const handleDeleteActive = async () => {
  if (canvasList.value.length <= 1 || !canvasStore.activeCanvasId) return
  await canvasStore.deleteCanvas(canvasStore.activeCanvasId)
  closeDropdown()
}

// Handle rename active canvas (simple prompt for now)
const handleRenameActive = async () => {
  if (!canvasStore.activeCanvasId) return
  const canvas = canvasList.value.find(c => c.id === canvasStore.activeCanvasId)
  if (!canvas) return
  closeDropdown()
  const newName = await promptDialog('Rename canvas:', canvas.name)
  if (newName) {
    canvasStore.renameCanvas(canvas.id, newName)
  }
}

// Close dropdown when clicking outside
const handleClickOutside = (e: Event) => {
  if (!(e.target as HTMLElement).closest('.menu-item')) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside, { capture: true })
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, { capture: true })
})
</script>

<template>
  <div class="menu-bar">
    <div class="menu-left">
      <!-- Logo -->
      <router-link to="/" class="app-name">
        Squill
      </router-link>

      <!-- Canvas Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'canvas' }">
        <button class="menu-button" @click.stop="toggleDropdown('canvas')">
          <span class="menu-text">Canvas</span>
          <span class="menu-caret">&#x25BE;</span>
        </button>
        <Transition name="dropdown">
          <div v-if="activeDropdown === 'canvas'" class="dropdown os-dropdown">
            <!-- Canvas list -->
            <button
              v-for="canvas in canvasList"
              :key="canvas.id"
              class="dropdown-item"
              :class="{ selected: canvas.id === canvasStore.activeCanvasId }"
              @click="handleCanvasSelect(canvas.id)"
            >
              {{ canvas.name }}
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" @click="handleCreateCanvas">New canvas</button>
            <button
              class="dropdown-item"
              :disabled="!canvasStore.activeCanvasId"
              @click="handleDuplicateActive"
            >Duplicate canvas</button>
            <button
              class="dropdown-item"
              :disabled="!canvasStore.activeCanvasId"
              @click="handleRenameActive"
            >Rename canvas...</button>
            <div class="dropdown-divider"></div>
            <button
              class="dropdown-item"
              :disabled="!userStore.isPro || !canvasStore.activeCanvasId"
              @click="showShareDialog = true; activeDropdown = null"
            >
              Share...
              <span v-if="!userStore.isPro" class="item-hint">(Pro)</span>
            </button>
            <div class="dropdown-divider"></div>
            <button
              class="dropdown-item dropdown-item-danger"
              :disabled="canvasStore.canvasIndex.length <= 1"
              @click="handleDeleteActive"
            >Delete canvas</button>
          </div>
        </Transition>
      </div>

      <!-- New Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'new' }">
        <button class="menu-button" @click.stop="toggleDropdown('new')">
          <span class="menu-text">New</span>
          <span class="menu-caret">&#x25BE;</span>
        </button>
        <Transition name="dropdown">
          <div v-if="activeDropdown === 'new'" class="dropdown os-dropdown">
            <button class="dropdown-item" @click="addBox('sql')">
              SQL editor <span class="shortcut">&#x2318;J</span>
            </button>
            <button class="dropdown-item" @click="addBox('note')">Sticky note</button>
            <button class="dropdown-item" @click="addBox('schema')">Schema browser</button>
            <button class="dropdown-item" @click="addBox('history')">Query history</button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" @click="handleImportClick">
              Import file...
            </button>
            <input
              ref="importFileInput"
              type="file"
              accept=".csv,.duckdb"
              multiple
              style="display:none"
              @change="handleImportFiles"
            >
          </div>
        </Transition>
      </div>

      <!-- Connection Menu -->
      <div
        class="menu-item"
        :class="{ active: activeDropdown === 'connection' }"
      >
        <button
          class="menu-button"
          @click.stop="toggleDropdown('connection')"
        >
          <span class="menu-text">Connection</span>
          <span v-if="activeConnectionHasIssue" class="connection-warning" v-tooltip="'Connection issue'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <span class="menu-caret">&#x25BE;</span>
        </button>

        <Transition name="dropdown">
          <div
            v-if="activeDropdown === 'connection'"
            class="dropdown os-dropdown connection-dropdown"
          >
            <!-- Connections Section -->
            <template v-if="connectionsStore.connections.length > 0">
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
                  <div class="connection-name">
                    {{ getConnectionDisplayName(connection) }}
                  </div>
                  <div
                    v-if="shouldShowExpired(connection.id)"
                    class="expired-badge"
                  >
                    Token Expired
                  </div>
                </div>
                <div
                  class="connection-actions"
                  @click.stop
                >
                  <button
                    v-if="connection.type === 'bigquery'"
                    v-tooltip="shouldShowExpired(connection.id) ? 'Reconnect' : 'Re-login'"
                    class="reconnect-btn"
                    @click="handleReconnect(connection.id, $event)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                  </button>
                  <button
                    v-if="connection.id !== 'duckdb-local'"
                    v-tooltip="'Delete'"
                    class="delete-btn"
                    @click="handleDeleteConnection(connection.id, $event)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </button>
            </template>

            <div class="dropdown-divider"></div>

            <!-- Add database submenu trigger -->
            <div class="submenu-trigger">
              <button
                class="dropdown-item"
                @click.stop="addDatabaseMenuOpen = !addDatabaseMenuOpen"
              >
                Add database...
                <span class="dropdown-arrow">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>

              <!-- Flyout submenu -->
              <div
                class="flyout-menu"
                :class="{ open: addDatabaseMenuOpen }"
                @click.stop
              >
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('bigquery')"
                >
                  <img
                    :src="DATABASE_INFO.bigquery.logo"
                    :alt="DATABASE_INFO.bigquery.name"
                    class="db-icon"
                  >
                  {{ DATABASE_INFO.bigquery.name }}
                </button>
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('clickhouse')"
                >
                  <img
                    :src="DATABASE_INFO.clickhouse.logo"
                    :alt="DATABASE_INFO.clickhouse.name"
                    class="db-icon"
                  >
                  {{ DATABASE_INFO.clickhouse.name }}
                </button>
                <button
                  class="dropdown-item flyout-item"
                  @click="handleAddDatabase('snowflake')"
                >
                  <img
                    :src="DATABASE_INFO.snowflake.logo"
                    :alt="DATABASE_INFO.snowflake.name"
                    class="db-icon"
                  >
                  {{ DATABASE_INFO.snowflake.name }}
                </button>
              </div>
            </div>

            <!-- Projects Section (BigQuery only) -->
            <template v-if="connectionsStore.activeConnection?.type === 'bigquery' && !connectionsStore.isActiveTokenExpired">
              <div class="dropdown-divider"></div>
              <div class="dropdown-label">PROJECTS</div>
              <div class="projects-section">
                <div
                  v-if="sortedProjects.length > 5"
                  class="project-search-wrapper"
                >
                  <input
                    ref="projectSearchRef"
                    v-model="projectSearch"
                    type="text"
                    class="project-search"
                    placeholder="Filter projects..."
                    @click.stop
                    @keydown.stop
                  >
                </div>
                <div
                  v-if="projectsLoading && sortedProjects.length === 0"
                  class="dropdown-message"
                >
                  Retrieving projects...
                </div>
                <div
                  v-else-if="filteredProjects.length === 0"
                  class="dropdown-message"
                >
                  {{ sortedProjects.length === 0 ? 'No projects found' : 'No matching projects' }}
                </div>
                <button
                  v-for="project in filteredProjects"
                  :key="project.projectId"
                  class="dropdown-item project-item"
                  :class="{ selected: isProjectSelected(project.projectId) }"
                  @click="handleProjectToggle(project.projectId)"
                >
                  <span
                    v-if="isProjectSelected(project.projectId)"
                    class="item-check"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span
                    v-else
                    class="item-check-placeholder"
                  />
                  <span class="item-text">{{ project.projectId }}</span>
                  <span
                    v-tooltip="isProjectSelected(project.projectId) ? (isBillingProject(project.projectId) ? 'Billing project' : 'Set as billing project') : undefined"
                    role="button"
                    tabindex="0"
                    class="billing-pin-btn"
                    :class="{ active: isBillingProject(project.projectId), hidden: !isProjectSelected(project.projectId) }"
                    @click.stop="isProjectSelected(project.projectId) && handleSetBillingProject(project.projectId, $event)"
                    @keydown.enter.stop="isProjectSelected(project.projectId) && handleSetBillingProject(project.projectId, $event)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      :fill="isBillingProject(project.projectId) ? 'currentColor' : 'none'"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </span>
                </button>
              </div>
            </template>
          </div>
        </Transition>
      </div>

      <!-- Tools Menu -->
      <div class="menu-item" :class="{ active: activeDropdown === 'tools' }">
        <button class="menu-button" @click.stop="toggleDropdown('tools')">
          <span class="menu-text">Tools</span>
          <span class="menu-caret">&#x25BE;</span>
        </button>
        <Transition name="dropdown">
          <div v-if="activeDropdown === 'tools'" class="dropdown os-dropdown">
            <button class="dropdown-item" @click="showMcpModal = true; activeDropdown = null">
              Connect via MCP...
            </button>
            <button class="dropdown-item" @click="handleRefreshSchemas">Refresh schemas</button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" @click="showShortcuts">
              Keyboard shortcuts
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item dropdown-item-danger" @click="handleResetAll">
              Reset all data...
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <div class="menu-right">
      <!-- Pro Badge -->
      <span v-if="userStore.isPro" class="pro-badge menu-pro-badge">Pro</span>

      <!-- User Menu (web only — desktop has no Squill accounts) -->
      <div
        v-if="userStore.isLoggedIn && isWebApp"
        class="menu-item user-menu-item"
      >
        <button
          class="user-button"
          @click.stop="toggleUserDropdown"
        >
          <span class="user-initials">{{ userInitial }}</span>
        </button>

        <Transition name="dropdown">
          <div
            v-if="activeDropdown === 'user'"
            class="dropdown os-dropdown user-dropdown"
          >
            <div class="user-info">
              <div class="user-name">
                {{ userDisplayName }}
              </div>
              <div
                v-if="userStore.user?.firstName"
                class="user-email"
              >
                {{ userStore.user?.email }}
              </div>
            </div>
            <button
              class="dropdown-item"
              @click="goToAccount"
            >
              <span class="item-text">Account</span>
            </button>
            <button
              class="dropdown-item"
              @click="handleSignOut"
            >
              <span class="item-text">Sign out</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- Sign In Dropdown (web only — desktop has no Squill accounts) -->
      <div
        v-else-if="isWebApp"
        class="menu-item sign-in-menu-item"
      >
        <button
          class="sign-in-btn"
          :disabled="userStore.isLoading"
          @click.stop="toggleSignInDropdown"
        >
          {{ userStore.isLoading ? 'Signing in...' : 'Sign in' }}
        </button>

        <Transition name="dropdown">
          <div
            v-if="activeDropdown === 'signin'"
            class="dropdown signin-dropdown"
          >
            <button
              class="dropdown-item"
              @click="handleSignInGoogle"
            >
              <img class="provider-icon" src="/logos/google.svg" alt="">
              <span class="item-text">Continue with Google</span>
            </button>
            <button
              class="dropdown-item"
              @click="handleSignInGitHub"
            >
              <img class="provider-icon provider-icon-invert" src="/logos/github.svg" alt="">
              <span class="item-text">Continue with GitHub</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- Settings gear -->
      <button class="tray-button" title="Settings" @click="showSettingsPanel = true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- ClickHouse Connection Modal -->
  <ClickHouseConnectionModal
    :show="showClickHouseModal"
    @close="showClickHouseModal = false"
    @connected="handleClickHouseConnected"
  />

  <!-- Snowflake Connection Modal -->
  <SnowflakeConnectionModal
    :show="showSnowflakeModal"
    @close="showSnowflakeModal = false"
    @connected="handleSnowflakeConnected"
  />

  <!-- Share Dialog (Pro only) -->
  <ShareDialog
    :show="showShareDialog"
    @close="showShareDialog = false"
  />

  <!-- MCP Setup Modal -->
  <Teleport to="body">
    <Transition name="dropdown">
      <div v-if="showMcpModal" class="modal-overlay" @click.self="showMcpModal = false">
        <div class="modal-content mcp-modal">
          <div class="modal-header">
            <h3 class="modal-title">Connect via MCP</h3>
            <button class="modal-close" @click="showMcpModal = false">&times;</button>
          </div>
          <div class="modal-body">
            <p>Connect your AI coding assistant to Squill using the <a href="https://modelcontextprotocol.io" target="_blank">Model Context Protocol</a>.</p>

            <div class="mcp-section">
              <div class="mcp-section-title">Claude Code</div>
              <div class="mcp-code-wrapper">
                <pre class="mcp-code"><code>claude mcp add --transport http squill {{ mcpUrl }}</code></pre>
                <CopyButton :text="mcpCommand" size="sm" class="mcp-copy" />
              </div>
              <div class="mcp-hint">Run this in your terminal, then authenticate via the browser.</div>
              <div class="mcp-hint mcp-hint-secondary">Already added? Use <code>claude mcp remove squill</code> first, then re-run the command above.</div>
            </div>

            <div class="mcp-section">
              <div class="mcp-section-title">Cursor / VS Code / Other</div>
              <div class="mcp-hint">Add to your MCP config:</div>
              <div class="mcp-code-wrapper">
                <pre class="mcp-code"><code>{
  "mcpServers": {
    "squill": {
      "type": "http",
      "url": "{{ mcpUrl }}"
    }
  }
}</code></pre>
                <CopyButton :text="mcpJson" size="sm" class="mcp-copy" />
              </div>
            </div>

            <div class="mcp-section">
              <div class="mcp-section-title">Available tools</div>
              <div class="mcp-tools">
                <span class="mcp-tool">list_canvases</span>
                <span class="mcp-tool">get_canvas</span>
                <span class="mcp-tool">create_box</span>
                <span class="mcp-tool">update_box</span>
                <span class="mcp-tool">delete_box</span>
                <span class="mcp-tool">execute_query</span>
                <span class="mcp-tool">list_connections</span>
                <span class="mcp-tool">list_tables</span>
                <span class="mcp-tool">get_table_schema</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Settings Panel -->
  <SettingsPanel :show="showSettingsPanel" @close="showSettingsPanel = false" />
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

.menu-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  font-size: 10px;
}

.token-expired-indicator {
  color: var(--color-error);
  font-weight: 600;
}

/* Dropdown base */
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

/* OS-style dropdown */
.os-dropdown {
  min-width: 220px;
  padding: var(--space-1) 0;
}

.dropdown-label {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  user-select: none;
}

.dropdown-divider {
  height: 1px;
  background: var(--border-secondary);
  margin: var(--space-1) 0;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-left: 2px solid transparent;
  background: none;
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  cursor: pointer;
  text-align: left;
  outline: none;
  transition: background 0.1s;
}

.dropdown-item:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.dropdown-item:disabled {
  color: var(--text-tertiary);
  cursor: default;
}

.dropdown-item:disabled:hover {
  background: none;
  color: var(--text-tertiary);
}

.dropdown-item.selected {
  font-weight: 600;
  background: var(--surface-secondary);
  border-left: 2px solid var(--text-primary);
}

.dropdown-item-danger {
  color: var(--color-error, #ef4444);
}

.shortcut {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  margin-left: var(--space-4);
}

.dropdown-item:hover .shortcut {
  color: var(--text-tertiary);
}

.item-hint {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  margin-left: var(--space-2);
}

.item-text {
  flex: 1;
}

.item-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}

/* Tray buttons (right side) */
.tray-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}

.tray-button:hover {
  color: var(--text-primary);
}

/* User dropdown and right-aligned dropdowns */
.user-dropdown {
  right: 0;
  left: auto;
}

.user-menu-item {
  position: relative;
}

/* User Button */
.user-button {
  padding: 2px 6px;
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
  padding: var(--space-2) var(--space-3);
  margin-left: 2px; /* align with dropdown-item border-left */
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  margin-bottom: var(--space-1);
}

.user-name {
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-primary);
}

.user-email {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Sign In Button */
.sign-in-btn {
  height: 24px;
  padding: 0 var(--space-3);
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
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

.sign-in-menu-item {
  position: relative;
}

.signin-dropdown {
  right: 0;
  left: auto;
  min-width: 200px;
}

.signin-dropdown .dropdown-item {
  justify-content: flex-start;
  gap: var(--space-2);
}

.provider-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

html.dark .provider-icon-invert {
  filter: invert(1);
}

/* Pro badge */
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

.connection-warning {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
}

/* Connection dropdown specifics */
.connection-dropdown {
  min-width: 300px;
  max-width: 400px;
  overflow: visible; /* Allow flyout submenu to extend outside */
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 60px);
}

.connection-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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
}

.flyout-item:hover {
  background: var(--surface-secondary);
}

.db-icon {
  width: 16px;
  height: 16px;
}

/* Projects section */
.projects-section {
  overflow-y: auto;
  flex-shrink: 1;
  min-height: 0;
}

.project-search-wrapper {
  padding: var(--space-2) var(--space-3);
  position: sticky;
  top: 0;
  background: var(--surface-primary);
  z-index: 1;
}

.project-search {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  border: var(--border-width-thin) solid var(--border-secondary);
  background: var(--surface-primary);
  color: var(--text-primary);
  outline: none;
}

.project-search:focus {
  border-color: var(--border-primary);
}

.project-search::placeholder {
  color: var(--text-tertiary);
}

.project-item {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  gap: var(--space-2);
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

.item-check-placeholder {
  width: 12px;
  flex-shrink: 0;
}

.billing-pin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.15s;
}

.billing-pin-btn.hidden {
  visibility: hidden;
  pointer-events: none;
}

.billing-pin-btn:hover {
  color: var(--color-accent);
}

.billing-pin-btn.active {
  color: var(--color-accent);
}

.extra-projects-badge {
  color: var(--text-secondary);
  font-weight: 400;
}

.placeholder-text {
  color: var(--text-secondary);
  font-style: italic;
}

.dropdown-message {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
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

/* MCP Modal */
.mcp-modal {
  max-width: 560px;
}

.mcp-section {
  margin-bottom: var(--space-4);
}

.mcp-section:last-child {
  margin-bottom: 0;
}

.mcp-section-title {
  font-weight: 600;
  font-size: var(--font-size-body-sm);
  margin-bottom: var(--space-2);
  color: var(--text-primary);
}

.mcp-code-wrapper {
  position: relative;
}

.mcp-copy {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}

.mcp-code {
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: var(--space-3);
  padding-right: var(--space-8);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-code);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.mcp-code code {
  color: var(--text-primary);
}

.mcp-hint {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: var(--space-1);
}

.mcp-hint-secondary {
  opacity: 0.7;
}

.mcp-hint-secondary code {
  font-family: var(--font-mono);
  background: var(--bg-secondary);
  padding: 1px 4px;
}

.mcp-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.mcp-tool {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: 2px var(--space-2);
  color: var(--text-secondary);
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
