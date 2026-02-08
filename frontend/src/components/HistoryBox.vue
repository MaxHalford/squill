<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import BaseBox from './BaseBox.vue'
import CopyButton from './CopyButton.vue'
import { useQueryHistoryStore } from '../stores/queryHistory'
import { useConnectionsStore } from '../stores/connections'
import { DATABASE_INFO } from '../types/database'
import type { QueryHistoryEntry } from '../utils/storageSchemas'
import { formatRelativeTime, formatExecutionTime, formatRowCount, getFirstLine } from '../utils/formatUtils'
import { EditorView } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'

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
  initialName: { type: String, default: 'Query History' }
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

// CodeMirror refs
const editorRef = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null

// SQL highlight style using CSS variables
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.special(tags.string), color: 'var(--syntax-string)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-number)' },
  { tag: tags.null, color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--syntax-punctuation)' },
  { tag: tags.bracket, color: 'var(--syntax-punctuation)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.propertyName, color: 'var(--syntax-property)' },
  { tag: tags.variableName, color: 'var(--text-primary)' },
])

// Read-only editor theme
const readOnlyTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-body-sm)',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--font-family-mono)',
    color: 'var(--text-primary)',
    padding: 'var(--space-2)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    overflow: 'auto',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

// Get available connections for filter dropdown
const connectionOptions = computed(() => {
  const options: { id: string; name: string; type: string }[] = []
  const seenIds = new Set<string>()

  for (const entry of historyStore.historyEntries) {
    if (seenIds.has(entry.connectionId)) continue
    seenIds.add(entry.connectionId)

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


// Create/update CodeMirror editor
function updateEditor(query: string) {
  if (!editorRef.value) return

  if (editorView) {
    editorView.destroy()
  }

  editorView = new EditorView({
    parent: editorRef.value,
    state: EditorState.create({
      doc: query,
      extensions: [
        sql(),
        syntaxHighlighting(sqlHighlightStyle, { fallback: true }),
        readOnlyTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]
    })
  })
}

// Watch for selected entry changes
watch(selectedEntry, (entry) => {
  if (entry) {
    // Use nextTick to ensure DOM is ready
    setTimeout(() => updateEditor(entry.query), 0)
  }
})

onMounted(() => {
  if (selectedEntry.value) {
    updateEditor(selectedEntry.value.query)
  }
})

onUnmounted(() => {
  editorView?.destroy()
})
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
          name="history-search"
          type="text"
          class="search-input"
          placeholder="Search queries..."
        >
        <select
          v-model="selectedConnectionId"
          class="connection-filter"
        >
          <option :value="null">
            All connections
          </option>
          <option
            v-for="conn in connectionOptions"
            :key="conn.id"
            :value="conn.id"
          >
            {{ conn.name }}
          </option>
        </select>
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
            <div class="item-preview">
              {{ getFirstLine(entry.query) }}
            </div>
            <div class="item-meta">
              <span
                v-tooltip="getConnectionName(entry)"
                class="engine-badge"
                :style="{
                  background: DATABASE_INFO[entry.connectionType].color,
                  color: DATABASE_INFO[entry.connectionType].textColor
                }"
              >
                {{ DATABASE_INFO[entry.connectionType].shortName }}
              </span>
              <span
                v-if="entry.success && entry.rowCount !== undefined"
                class="row-count"
              >
                {{ formatRowCount(entry.rowCount) }}
              </span>
              <span
                v-if="entry.success && entry.executionTimeMs"
                class="exec-time"
              >
                {{ formatExecutionTime(entry.executionTimeMs) }}
              </span>
              <span
                v-if="!entry.success"
                class="error-indicator"
              >
                Failed
              </span>
            </div>
          </div>
        </div>

        <!-- Query preview -->
        <div class="preview-panel">
          <div
            v-if="!selectedEntry"
            class="preview-empty"
          >
            Select a query to preview
          </div>
          <template v-else>
            <!-- Action buttons -->
            <div class="preview-actions">
              <button
                v-tooltip="'Open in new SQL box'"
                class="icon-btn"
                @click.stop="restoreQuery"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line
                    x1="10"
                    y1="14"
                    x2="21"
                    y2="3"
                  />
                </svg>
              </button>
              <CopyButton :text="selectedEntry.query" />
            </div>
            <!-- Error message if failed -->
            <div
              v-if="!selectedEntry.success && selectedEntry.errorMessage"
              class="preview-error"
            >
              {{ selectedEntry.errorMessage }}
            </div>
            <!-- CodeMirror editor -->
            <div
              ref="editorRef"
              class="code-editor"
            />
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
  border: none;
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
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

/* Failed queries show "Failed" text indicator instead of border */

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
  position: relative;
}

.preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body-sm);
}

.preview-actions {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-1);
  z-index: 10;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  background: var(--surface-primary);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}


.preview-error {
  padding: var(--space-2);
  margin: var(--space-2);
  background: var(--color-error-bg);
  border-left: 3px solid var(--color-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  white-space: pre-wrap;
  word-break: break-word;
  flex-shrink: 0;
}

.code-editor {
  flex: 1;
  overflow: hidden;
  background: var(--editor-bg);
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}
</style>
