<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'

const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const isOpen = ref(false)
const fileInputRef = ref(null)
const error = ref(null)
const isUploading = ref(false)

const toggleSidebar = () => {
  isOpen.value = !isOpen.value
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  try {
    isUploading.value = true
    error.value = null

    const text = await file.text()
    const credentials = JSON.parse(text)

    await authStore.loadServiceAccount(credentials)
  } catch (err) {
    error.value = err.message || 'Failed to load credentials'
  } finally {
    isUploading.value = false
  }
}

const handleClearCredentials = () => {
  authStore.clearCredentials()
  error.value = null
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}
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
          <h3>BigQuery Configuration</h3>

          <div v-if="authStore.isAuthenticated" class="auth-status">
            <div class="status-row">
              <span class="status-indicator authenticated">●</span>
              <span class="status-text">Connected</span>
            </div>
            <div class="project-id">
              Project: <strong>{{ authStore.projectId }}</strong>
            </div>
            <button @click="handleClearCredentials" class="clear-btn">
              Clear Credentials
            </button>
          </div>

          <div v-else class="auth-upload">
            <label for="sidebar-credentials-file" class="upload-label">
              Service Account JSON
            </label>
            <input
              id="sidebar-credentials-file"
              ref="fileInputRef"
              type="file"
              accept=".json"
              @change="handleFileUpload"
              class="file-input"
            />
            <p class="help-text">
              Upload your BigQuery service account JSON file to enable querying.
            </p>
          </div>

          <div v-if="error" class="error-message">
            {{ error }}
          </div>
        </section>

        <!-- Font Configuration -->
        <section class="config-section">
          <h3>Font Settings</h3>

          <div class="font-option">
            <label for="editor-font" class="font-label">SQL Editor Font</label>
            <select
              id="editor-font"
              v-model="settingsStore.editorFont"
              class="font-select"
            >
              <option
                v-for="option in settingsStore.editorFontOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="font-option">
            <label for="table-font" class="font-label">Data Table Font</label>
            <select
              id="table-font"
              v-model="settingsStore.tableFont"
              class="font-select"
            >
              <option
                v-for="option in settingsStore.tableFontOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
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
  background: white;
  border-left: 1px solid #e0e0e0;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
}

.sidebar.open {
  right: 0;
}

.toggle-btn {
  position: fixed;
  right: 0;
  top: 20px;
  width: 32px;
  height: 48px;
  background: white;
  border: 1px solid #e0e0e0;
  border-right: none;
  border-radius: 6px 0 0 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: -2px 2px 6px rgba(0, 0, 0, 0.08);
  z-index: 1001;
}

.sidebar.open .toggle-btn {
  right: 320px;
}

.toggle-btn:hover {
  background: #f9fafb;
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
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.config-section {
  margin-bottom: 24px;
}

h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.auth-status {
  padding: 12px;
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 6px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-indicator {
  font-size: 12px;
}

.status-indicator.authenticated {
  color: #10b981;
}

.status-text {
  font-weight: 500;
  color: #065f46;
}

.project-id {
  font-size: 13px;
  color: #065f46;
  margin-bottom: 12px;
}

.clear-btn {
  background: #ef4444;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.clear-btn:hover {
  background: #dc2626;
}

.auth-upload {
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.upload-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 8px;
}

.file-input {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
}

.help-text {
  margin: 8px 0 0 0;
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

.font-option {
  margin-bottom: 16px;
}

.font-option:last-child {
  margin-bottom: 0;
}

.font-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.font-select {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #1f2937;
  cursor: pointer;
  transition: border-color 0.2s;
}

.font-select:hover {
  border-color: #9ca3af;
}

.font-select:focus {
  outline: none;
  border-color: #42b883;
  box-shadow: 0 0 0 3px rgba(66, 184, 131, 0.1);
}
</style>
