<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useUserStore } from '../stores/user'
import { useDialog } from '../composables/useDialog'

const { confirm } = useDialog()

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

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

// Settings state
const fetchBatchInputValue = ref<number | string>(settingsStore.fetchBatchSize)
const paginationInputValue = ref<number | string>(settingsStore.paginationSize)
const editorFontSizeInputValue = ref<number | string>(settingsStore.editorFontSize)

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

// Handle reset all data
const handleResetAll = async () => {
  const confirmed = await confirm('This will clear all data including connections, queries, and cached results. Are you sure?')
  if (confirmed) {
    const { deleteDatabase } = await import('../utils/db')
    await deleteDatabase()
    window.location.reload()
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
        aria-labelledby="settings-modal-title"
        @click.self="emit('close')"
      >
        <div class="modal-content">
          <div class="modal-header">
            <h3
              id="settings-modal-title"
              class="modal-title"
            >
              Settings
            </h3>
            <button
              class="modal-close"
              @click="emit('close')"
            >
              &times;
            </button>
          </div>
          <div class="modal-body">
            <div class="settings-section">
              <div class="setting-header">
                Fetch pagination
              </div>
              <div class="setting-description">
                Load large result sets in batches for better performance
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.fetchPaginationEnabled"
                    class="setting-checkbox"
                    @change="settingsStore.toggleFetchPagination"
                  >
                  <span>Enable fetch pagination</span>
                </label>
              </div>

              <div
                class="setting-row"
                :class="{ disabled: !settingsStore.fetchPaginationEnabled }"
              >
                <label class="setting-label">
                  <span>Rows per batch</span>
                  <input
                    type="number"
                    :value="fetchBatchInputValue"
                    :disabled="!settingsStore.fetchPaginationEnabled"
                    min="100"
                    max="100000"
                    class="setting-input-number"
                    @input="handleFetchBatchChange"
                  >
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Hex remover
                <span
                  v-if="!userStore.isPro"
                  class="pro-badge"
                >Pro</span>
              </div>
              <div class="setting-description">
                Automatically suggest fixes when queries fail
              </div>

              <div
                class="setting-row"
                :class="{ disabled: !userStore.isPro }"
              >
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.autofixEnabled"
                    :disabled="!userStore.isPro"
                    class="setting-checkbox"
                    @change="settingsStore.toggleAutofix"
                  >
                  <span>Enable hex remover</span>
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Pagination size
              </div>
              <div class="setting-description">
                Number of rows to display per page in results tables
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <span>Rows per page</span>
                  <input
                    type="number"
                    :value="paginationInputValue"
                    min="1"
                    max="10000"
                    class="setting-input-number"
                    @input="handlePaginationChange"
                  >
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Code editor
              </div>
              <div class="setting-description">
                Configure the SQL editor appearance
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <span>Font size</span>
                  <input
                    type="number"
                    :value="editorFontSizeInputValue"
                    min="8"
                    max="24"
                    class="setting-input-number"
                    @input="handleEditorFontSizeChange"
                  >
                </label>
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.showEditorLineNumbers"
                    class="setting-checkbox"
                    @change="settingsStore.toggleEditorLineNumbers"
                  >
                  <span>Show line numbers</span>
                </label>
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.tableLinkEnabled"
                    class="setting-checkbox"
                    @change="settingsStore.toggleTableLink"
                  >
                  <span>Cmd+click table navigation</span>
                </label>
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.sqlBoxLayout === 'horizontal'"
                    class="setting-checkbox"
                    @change="settingsStore.toggleSqlBoxLayout"
                  >
                  <span>Horizontal split</span>
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Appearance
              </div>
              <div class="setting-description">
                Change the look and feel of the canvas
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <span>Theme</span>
                  <select
                    :value="settingsStore.themePreference"
                    class="setting-select"
                    @change="settingsStore.setThemePreference(($event.target as HTMLSelectElement).value as 'system' | 'light' | 'dark')"
                  >
                    <option value="system">
                      System
                    </option>
                    <option value="light">
                      Light
                    </option>
                    <option value="dark">
                      Dark
                    </option>
                  </select>
                </label>
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <span>Canvas pattern</span>
                  <select
                    :value="settingsStore.canvasPattern"
                    class="setting-select"
                    @change="settingsStore.setCanvasPattern(($event.target as HTMLSelectElement).value as 'dots' | 'grid' | 'waves' | 'none')"
                  >
                    <option value="dots">
                      Dots
                    </option>
                    <option value="grid">
                      Grid
                    </option>
                    <option value="waves">
                      Waves
                    </option>
                    <option value="none">
                      None
                    </option>
                  </select>
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Accent color
              </div>
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
                  :title="color"
                  @click="settingsStore.setTableLinkHighlightColor(color)"
                />
                <label class="color-picker-wrapper">
                  <input
                    type="color"
                    class="color-picker-input"
                    :value="settingsStore.accentColor"
                    @input="settingsStore.setTableLinkHighlightColor(($event.target as HTMLInputElement).value)"
                  >
                  <span
                    class="color-swatch color-picker-swatch"
                    :class="{ active: !accentColors.includes(settingsStore.accentColor) }"
                    :style="{ background: accentColors.includes(settingsStore.accentColor) ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : settingsStore.accentColor }"
                  />
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Viewport behavior
              </div>
              <div class="setting-description">
                Control how the viewport moves when interacting with boxes
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.panToBoxOnSelect"
                    class="setting-checkbox"
                    @change="settingsStore.togglePanToBoxOnSelect"
                  >
                  <span>Pan to box on select</span>
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Notifications
              </div>
              <div class="setting-description">
                Announce query results when the tab is in the background
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.voiceNotifyEnabled"
                    class="setting-checkbox"
                    @change="settingsStore.toggleVoiceNotify"
                  >
                  <span>Voice notify on long queries</span>
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="setting-header">
                Execution
              </div>
              <div class="setting-description">
                Automatically re-run downstream dependent boxes when an upstream box executes
              </div>

              <div class="setting-row">
                <label class="setting-label">
                  <input
                    type="checkbox"
                    :checked="settingsStore.autoRunDownstream"
                    class="setting-checkbox"
                    @change="settingsStore.toggleAutoRunDownstream"
                  >
                  <span>Auto-run downstream boxes</span>
                </label>
              </div>
            </div>

            <div class="settings-section settings-section-danger">
              <div class="setting-header">
                Reset
              </div>
              <div class="setting-description">
                Clear all data including connections, queries, and cached results
              </div>
              <button
                class="reset-button"
                @click="handleResetAll"
              >
                Reset all data
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Uses global .modal-overlay from style.css */

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
  padding: 0;
  overflow-y: auto;
  flex: 1;
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  line-height: var(--line-height-relaxed);
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

.setting-select {
  padding: var(--space-1) var(--space-2);
  border: none;
  background: var(--surface-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
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

.settings-section-danger {
  background: rgba(255, 0, 0, 0.05);
}

.action-button {
  width: 100%;
  padding: var(--space-2);
  background: #007bff;
  color: white;
  border: none;
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

/* Modal animation */
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
