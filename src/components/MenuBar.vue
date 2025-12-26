<script setup>
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'

const authStore = useAuthStore()
const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()

// Dropdown states
const activeDropdown = ref(null) // 'database', 'project', 'box', 'settings', 'user'

// Database types
const databases = [
  { id: 'bigquery', name: 'BigQuery' }
]

// Box types
const boxTypes = [
  { id: 'sql', name: 'SQL editor' },
  { id: 'schema', name: 'Schema browser' }
]

// Projects loading state
const isLoadingProjects = ref(false)
const availableProjects = ref([])

// Settings state
const limitInputValue = ref(settingsStore.autoLimitValue)

// Get current database
const currentDatabase = computed(() => {
  return databases.find(db => db.id === canvasStore.selectedDatabase)
})

// Get current project name
const currentProjectName = computed(() => {
  if (!canvasStore.selectedProject) return 'No Project'
  return canvasStore.selectedProject
})

// Toggle dropdown
const toggleDropdown = (dropdown) => {
  if (activeDropdown.value === dropdown) {
    activeDropdown.value = null
  } else {
    activeDropdown.value = dropdown

    // Load projects when opening project dropdown
    if (dropdown === 'project' && canvasStore.selectedDatabase === 'bigquery') {
      loadProjects()
    }
  }
}

// Close dropdown
const closeDropdown = () => {
  activeDropdown.value = null
}

// Select database
const selectDatabase = (databaseId) => {
  canvasStore.setSelectedDatabase(databaseId)
  canvasStore.setSelectedProject(null)
  closeDropdown()
}

// Select project
const selectProject = (projectId) => {
  canvasStore.setSelectedProject(projectId)
  authStore.setProjectId(projectId)
  closeDropdown()
}

// Load projects for BigQuery
const loadProjects = async () => {
  if (!authStore.isAuthenticated) return

  isLoadingProjects.value = true
  try {
    const projects = await authStore.fetchProjects()
    availableProjects.value = projects.map(p => ({
      id: p.projectId,
      name: p.name || p.projectId
    }))
  } catch (error) {
    console.error('Failed to load projects:', error)
  } finally {
    isLoadingProjects.value = false
  }
}

// Add box
const addBox = (boxType) => {
  canvasStore.addBox(boxType)
  closeDropdown()
}

// Sign in
const isSigningIn = ref(false)
const signInError = ref(null)

const signIn = async () => {
  if (canvasStore.selectedDatabase !== 'bigquery') {
    signInError.value = 'Sign in is only available for BigQuery'
    setTimeout(() => signInError.value = null, 3000)
    return
  }

  isSigningIn.value = true
  signInError.value = null

  try {
    await authStore.signInWithGoogle()
    // Auto-load projects after sign in
    await loadProjects()
    // Auto-select first project if available
    if (availableProjects.value.length > 0) {
      selectProject(availableProjects.value[0].id)
    }
  } catch (error) {
    signInError.value = error.message || 'Failed to sign in'
    setTimeout(() => signInError.value = null, 5000)
  } finally {
    isSigningIn.value = false
  }
}

// Sign out
const signOut = () => {
  authStore.signOut()
  canvasStore.setSelectedProject(null)
  closeDropdown()
}

// Get user initials
const userInitials = computed(() => {
  if (!authStore.userName) return '?'
  return authStore.userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
})

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

// Sync limit input when store changes
watch(() => settingsStore.autoLimitValue, (newValue) => {
  limitInputValue.value = newValue
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

      <!-- Database Selector -->
      <div class="menu-item" :class="{ active: activeDropdown === 'database' }">
        <button class="menu-button" @click.stop="toggleDropdown('database')">
          <span class="menu-text">{{ currentDatabase?.name || 'Database' }}</span>
          <span class="menu-caret">▼</span>
        </button>

        <div v-if="activeDropdown === 'database'" class="dropdown">
          <button
            v-for="db in databases"
            :key="db.id"
            class="dropdown-item"
            :class="{ selected: db.id === canvasStore.selectedDatabase }"
            @click="selectDatabase(db.id)"
          >
            <span class="item-text">{{ db.name }}</span>
            <span v-if="db.id === canvasStore.selectedDatabase" class="item-check">✓</span>
          </button>
        </div>
      </div>

      <!-- Project Selector -->
      <div class="menu-item" :class="{ active: activeDropdown === 'project' }">
        <button
          class="menu-button"
          :disabled="!authStore.isAuthenticated && canvasStore.selectedDatabase === 'bigquery'"
          @click.stop="toggleDropdown('project')"
        >
          <span class="menu-text">{{ currentProjectName }}</span>
          <span class="menu-caret">▼</span>
        </button>

        <div v-if="activeDropdown === 'project'" class="dropdown">
          <div v-if="canvasStore.selectedDatabase === 'bigquery'">
            <div v-if="isLoadingProjects" class="dropdown-message">
              Loading projects...
            </div>
            <div v-else-if="availableProjects.length === 0" class="dropdown-message">
              No projects available
            </div>
            <button
              v-else
              v-for="project in availableProjects"
              :key="project.id"
              class="dropdown-item"
              :class="{ selected: project.id === canvasStore.selectedProject }"
              @click="selectProject(project.id)"
            >
              <span class="item-text">{{ project.name }}</span>
              <span v-if="project.id === canvasStore.selectedProject" class="item-check">✓</span>
            </button>
          </div>
          <div v-else class="dropdown-message">
            Project selection not available for {{ currentDatabase?.name }}
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
            <div class="setting-header">Auto-limit Queries</div>
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
        </div>
      </div>
    </div>

    <div class="menu-right">
      <!-- Error Toast -->
      <div v-if="signInError" class="error-toast">
        {{ signInError }}
      </div>

      <!-- Sign In / User Menu -->
      <div v-if="!authStore.isAuthenticated" class="menu-item">
        <button
          class="sign-in-btn"
          :disabled="isSigningIn || canvasStore.selectedDatabase !== 'bigquery'"
          @click="signIn"
        >
          <span v-if="isSigningIn">Signing in...</span>
          <span v-else>Sign in with Google</span>
        </button>
      </div>

      <div v-else class="menu-item" :class="{ active: activeDropdown === 'user' }">
        <button class="user-button" @click.stop="toggleDropdown('user')">
          <img v-if="authStore.userPhoto" :src="authStore.userPhoto" alt="User" class="user-avatar" />
          <span v-else class="user-initials">{{ userInitials }}</span>
        </button>

        <div v-if="activeDropdown === 'user'" class="dropdown user-dropdown">
          <div class="user-info">
            <div class="user-name">{{ authStore.userName }}</div>
            <div class="user-email">{{ authStore.userEmail }}</div>
          </div>
          <button class="dropdown-item" @click="signOut">
            Sign Out
          </button>
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
  border: var(--border-width-thin) solid var(--border-primary);
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

.setting-input-number[type=number] {
  -moz-appearance: textfield;
}
</style>
