<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseBox from './BaseBox.vue'
import { useQueryHistoryStore } from '../stores/queryHistory'
import { useConnectionsStore } from '../stores/connections'
import { DATABASE_INFO } from '../types/database'
import type { QueryHistoryEntry } from '../utils/storageSchemas'

const historyStore = useQueryHistoryStore()
const connectionsStore = useConnectionsStore()

defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 700 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialName: { type: String, default: 'Query history' }
})

const emit = defineEmits([
  'select',
  'update:position',
  'update:size',
  'delete',
  'maximize',
  'update:name',
  'restore-query'
])

// UI state
const searchQuery = ref('')
const selectedConnectionId = ref<string | null>(null)
const selectedEntryId = ref<string | null>(null)

// Get available connections for filter dropdown
const connectionOptions = computed(() => {
  const options: { id: string; name: string; type: string }[] = []
  const seenIds = new Set<string>()

  // Get unique connection IDs from history
  for (const entry of historyStore.historyEntries) {
    if (seenIds.has(entry.connectionId)) continue
    seenIds.add(entry.connectionId)

    // Try to find connection name
    const connection = connectionsStore.connections.find(c => c.id === entry.connectionId)
    const name = connection?.name || entry.connectionId
    const type = entry.connectionType

    options.push({ id: entry.connectionId, name, type })
  }

  return options
})

// Filtered history entries
const filteredHistory = computed(() => {
  return historyStore.getHistory({
    connectionId: selectedConnectionId.value || undefined,
    search: searchQuery.value || undefined
  })
})

// Selected entry for preview
const selectedEntry = computed(() => {
  if (!selectedEntryId.value) return null
  return historyStore.getEntry(selectedEntryId.value)
})

// Format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

// Format execution time
function formatExecutionTime(ms?: number): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Get first line of query for preview
function getQueryPreview(query: string): string {
  const firstLine = query.split('\n')[0].trim()
  return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine
}

// Get connection name for tooltip
function getConnectionName(entry: QueryHistoryEntry): string {
  const connection = connectionsStore.connections.find(c => c.id === entry.connectionId)
  return connection?.name || entry.connectionId
}

// Select an entry
function selectEntry(entry: QueryHistoryEntry) {
  selectedEntryId.value = entry.id
}

// Restore query to new SqlBox
function restoreQuery() {
  if (!selectedEntry.value) return
  emit('restore-query', {
    query: selectedEntry.value.query,
    connectionId: selectedEntry.value.connectionId,
    connectionType: selectedEntry.value.connectionType
  })
}

// Copy query to clipboard
async function copyQuery() {
  if (!selectedEntry.value) return
  try {
    await navigator.clipboard.writeText(selectedEntry.value.query)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

// Delete selected entry
function deleteEntry() {
  if (!selectedEntryId.value) return
  historyStore.deleteEntry(selectedEntryId.value)
  selectedEntryId.value = null
}

// Clear all history
function clearHistory() {
  if (confirm('Clear all query history?')) {
    historyStore.clearAllHistory()
    selectedEntryId.value = null
  }
}
</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="history-box-content">
      <!-- Toolbar -->
      <div class="toolbar">
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Search queries..."
        />
        <select v-model="selectedConnectionId" class="connection-filter">
          <option :value="null">All connections</option>
          <option
            v-for="conn in connectionOptions"
            :key="conn.id"
            :value="conn.id"
          >
            {{ conn.name }}
          </option>
        </select>
        <button
          class="clear-btn"
          title="Clear all history"
          @click="clearHistory"
        >
          Clear
        </button>
      </div>

      <!-- Main content: list + preview -->
      <div class="main-content">
        <!-- History list -->
        <div class="history-list">
          <div
            v-if="filteredHistory.length === 0"
            class="empty-state"
          >
            {{ searchQuery ? 'No queries match your search' : 'No query history yet' }}
          </div>
          <div
            v-for="entry in filteredHistory"
            :key="entry.id"
            class="history-item"
            :class="{
              selected: entry.id === selectedEntryId,
              failed: !entry.success
            }"
            @click="selectEntry(entry)"
          >
            <div class="item-header">
              <span class="item-name">{{ entry.boxName || 'Query' }}</span>
              <span class="item-time">{{ formatRelativeTime(entry.timestamp) }}</span>
            </div>
            <div class="item-preview">{{ getQueryPreview(entry.query) }}</div>
            <div class="item-meta">
              <span
                class="engine-badge"
                :style="{
                  background: DATABASE_INFO[entry.connectionType].color,
                  color: DATABASE_INFO[entry.connectionType].textColor
                }"
                v-tooltip="getConnectionName(entry)"
              >
                {{ DATABASE_INFO[entry.connectionType].shortName }}
              </span>
              <span v-if="entry.success && entry.rowCount !== undefined" class="row-count">
                {{ entry.rowCount }} rows
              </span>
              <span v-if="entry.success && entry.executionTimeMs" class="exec-time">
                {{ formatExecutionTime(entry.executionTimeMs) }}
              </span>
              <span v-if="!entry.success" class="error-indicator">
                Failed
              </span>
            </div>
          </div>
        </div>

        <!-- Query preview -->
        <div class="preview-panel">
          <div v-if="!selectedEntry" class="preview-empty">
            Select a query to preview
          </div>
          <template v-else>
            <div class="preview-header">
              <span class="preview-title">{{ selectedEntry.boxName || 'Query' }}</span>
              <span class="preview-time">
                {{ new Date(selectedEntry.timestamp).toLocaleString() }}
              </span>
            </div>
            <div v-if="!selectedEntry.success && selectedEntry.errorMessage" class="preview-error">
              {{ selectedEntry.errorMessage }}
            </div>
            <pre class="preview-code"><code>{{ selectedEntry.query }}</code></pre>
            <div class="preview-actions">
              <button class="action-btn primary" @click="restoreQuery">
                Restore Query
              </button>
              <button class="action-btn" @click="copyQuery">
                Copy
              </button>
              <button class="action-btn delete" @click="deleteEntry">
                Delete
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </BaseBox>
</template>

<style scoped>
.history-box-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-primary);
}

.toolbar {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2);
  border-bottom: 1px solid var(--border-secondary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-primary);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.connection-filter {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-primary);
  cursor: pointer;
}

.clear-btn {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-secondary);
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--surface-secondary);
  color: var(--color-error);
}

.main-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.history-list {
  width: 45%;
  min-width: 200px;
  border-right: 1px solid var(--border-secondary);
  overflow-y: auto;
}

.empty-state {
  padding: var(--space-4);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body-sm);
}

.history-item {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-tertiary);
  cursor: pointer;
}

.history-item:hover {
  background: var(--surface-secondary);
}

.history-item.selected {
  background: var(--color-selection);
}

.history-item.failed {
  border-left: 3px solid var(--color-error);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.item-name {
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.item-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.item-preview {
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.row-count,
.exec-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.error-indicator {
  font-size: var(--font-size-caption);
  color: var(--color-error);
  font-weight: 500;
}

.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-3);
}

.preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body-sm);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.preview-title {
  font-weight: 500;
  color: var(--text-primary);
}

.preview-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.preview-error {
  padding: var(--space-2);
  margin-bottom: var(--space-2);
  background: var(--color-error-bg);
  border-left: 3px solid var(--color-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-code {
  flex: 1;
  margin: 0;
  padding: var(--space-2);
  background: var(--editor-bg);
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  overflow: auto;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  flex-shrink: 0;
}

.action-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-primary);
  cursor: pointer;
}

.action-btn:hover {
  background: var(--surface-secondary);
}

.action-btn.primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: white;
}

.action-btn.primary:hover {
  opacity: 0.9;
}

.action-btn.delete {
  color: var(--text-secondary);
}

.action-btn.delete:hover {
  background: var(--color-error-bg);
  border-color: var(--color-error);
  color: var(--color-error);
}
</style>
