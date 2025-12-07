<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'

const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  isSelected: { type: Boolean, default: false }
})

const emit = defineEmits(['select'])

const boxRef = ref(null)
const editorRef = ref(null)
const headerRef = ref(null)

const position = ref({ x: props.initialX, y: props.initialY })
const size = ref({ width: props.initialWidth, height: props.initialHeight })
const isDragging = ref(false)
const isResizing = ref(false)
const resizeDirection = ref(null)
const dragStart = ref({ x: 0, y: 0 })
const initialSize = ref({ width: 0, height: 0 })
const initialPosition = ref({ x: 0, y: 0 })

const minWidth = 300
const minHeight = 400 // Increased to accommodate editor + results

// Splitter for editor/results
const isDraggingSplitter = ref(false)
const editorHeight = ref(150) // Height of the editor section

// Query results
const queryResults = ref(null)
const currentPage = ref(1)
const pageSize = ref(10)
const isRunning = ref(false)
const error = ref(null)

const totalPages = computed(() => {
  if (!queryResults.value) return 0
  return Math.ceil(queryResults.value.length / pageSize.value)
})

const paginatedData = computed(() => {
  if (!queryResults.value) return []
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return queryResults.value.slice(start, end)
})

const columns = computed(() => {
  if (!queryResults.value || queryResults.value.length === 0) return []
  return Object.keys(queryResults.value[0])
})

const nextPage = (e) => {
  e.stopPropagation()
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}

const prevPage = (e) => {
  e.stopPropagation()
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

// Run query
const runQuery = async () => {
  if (!authStore.isAuthenticated) {
    error.value = 'Please upload service account credentials in the sidebar'
    return
  }

  isRunning.value = true
  error.value = null

  try {
    const query = editorView.state.doc.toString()
    const results = await authStore.runQuery(query)
    queryResults.value = results
    currentPage.value = 1
  } catch (err) {
    error.value = err.message || 'Query execution failed'
    queryResults.value = null
  } finally {
    isRunning.value = false
  }
}

let editorView = null
const fontThemeCompartment = new Compartment()

// Create font theme
const createFontTheme = (fontFamily) => {
  return EditorView.theme({
    '&': {
      fontFamily: fontFamily,
    },
    '.cm-content, .cm-line': {
      fontFamily: fontFamily,
    },
    '.cm-scroller': {
      fontFamily: fontFamily,
    },
  })
}

// Handle selection
const handleBoxClick = (e) => {
  emit('select')
}

// Handle dragging
const handleHeaderMouseDown = (e) => {
  e.stopPropagation()
  emit('select')
  isDragging.value = true
  dragStart.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y
  }
}

// Handle resizing
const handleResizeStart = (e, direction) => {
  e.stopPropagation()
  e.preventDefault()
  emit('select')
  isResizing.value = true
  resizeDirection.value = direction
  dragStart.value = { x: e.clientX, y: e.clientY }
  initialSize.value = { ...size.value }
  initialPosition.value = { ...position.value }
}

// Handle splitter dragging
const handleSplitterMouseDown = (e) => {
  e.stopPropagation()
  e.preventDefault()
  isDraggingSplitter.value = true
  dragStart.value.y = e.clientY
}

const handleMouseMove = (e) => {
  if (isDragging.value) {
    position.value = {
      x: e.clientX - dragStart.value.x,
      y: e.clientY - dragStart.value.y
    }
  } else if (isResizing.value) {
    const deltaX = e.clientX - dragStart.value.x
    const deltaY = e.clientY - dragStart.value.y
    const dir = resizeDirection.value

    let newWidth = initialSize.value.width
    let newHeight = initialSize.value.height
    let newX = initialPosition.value.x
    let newY = initialPosition.value.y

    // Handle horizontal resizing
    if (dir.includes('e')) {
      newWidth = Math.max(minWidth, initialSize.value.width + deltaX)
    } else if (dir.includes('w')) {
      const proposedWidth = initialSize.value.width - deltaX
      if (proposedWidth >= minWidth) {
        newWidth = proposedWidth
        newX = initialPosition.value.x + deltaX
      }
    }

    // Handle vertical resizing
    if (dir.includes('s')) {
      newHeight = Math.max(minHeight, initialSize.value.height + deltaY)
    } else if (dir.includes('n')) {
      const proposedHeight = initialSize.value.height - deltaY
      if (proposedHeight >= minHeight) {
        newHeight = proposedHeight
        newY = initialPosition.value.y + deltaY
      }
    }

    size.value = { width: newWidth, height: newHeight }
    position.value = { x: newX, y: newY }
  } else if (isDraggingSplitter.value) {
    const deltaY = e.clientY - dragStart.value.y
    const newHeight = editorHeight.value + deltaY
    const minEditorHeight = 100
    const maxEditorHeight = size.value.height - 200 // Leave at least 200px for results

    if (newHeight >= minEditorHeight && newHeight <= maxEditorHeight) {
      editorHeight.value = newHeight
      dragStart.value.y = e.clientY
    }
  }
}

const handleMouseUp = () => {
  isDragging.value = false
  isResizing.value = false
  isDraggingSplitter.value = false
  resizeDirection.value = null
}

onMounted(() => {
  // Keyboard shortcut for running query
  const runShortcut = EditorView.domEventHandlers({
    keydown(event, view) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        runQuery()
        return true
      }
      return false
    }
  })

  // Initialize CodeMirror
  editorView = new EditorView({
    extensions: [
      basicSetup,
      sql(),
      oneDark,
      fontThemeCompartment.of(createFontTheme(settingsStore.editorFont)),
      EditorView.lineWrapping,
      runShortcut
    ],
    parent: editorRef.value,
    doc: `
    SELECT *
    FROM \`export.P_TD_Product_Composition\`
    WHERE composition IS NOT NULL
    LIMIT 10;
    `.trim()
  })

  // Watch for font changes and update editor
  watch(() => settingsStore.editorFont, (newFont) => {
    if (editorView) {
      editorView.dispatch({
        effects: fontThemeCompartment.reconfigure(createFontTheme(newFont))
      })
    }
  })

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  if (editorView) {
    editorView.destroy()
  }
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div
    ref="boxRef"
    class="sql-box"
    :class="{
      'selected': isSelected,
      'dragging': isDragging || isResizing
    }"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${size.width}px`,
      height: `${size.height}px`
    }"
    @click="handleBoxClick"
  >
    <div
      ref="headerRef"
      class="sql-box-header"
      @mousedown="handleHeaderMouseDown"
    >
      <span>SQL Query</span>
      <div class="header-actions">
        <button
          @click.stop="runQuery"
          :disabled="isRunning || !authStore.isAuthenticated"
          class="run-button"
          :title="authStore.isAuthenticated ? 'Run query (Ctrl + Enter)' : 'Upload credentials in sidebar first'"
        >
          {{ isRunning ? '...' : '▶' }}
        </button>
        <div class="drag-indicator">⋮⋮</div>
      </div>
    </div>
    <div
      ref="editorRef"
      class="sql-editor"
      :style="{ height: `${editorHeight}px` }"
    ></div>

    <!-- Splitter -->
    <div
      class="splitter"
      @mousedown="handleSplitterMouseDown"
    >
      <div class="splitter-line"></div>
    </div>

    <!-- Results section -->
    <div class="results-section">
      <div v-if="error" class="error-banner" @click.stop>
        {{ error }}
      </div>
      <div class="results-header">
        <span class="results-title">Results{{ queryResults ? ` (${queryResults.length} rows)` : '' }}</span>
        <div class="pagination" v-if="queryResults && queryResults.length > 0">
          <button
            @click="prevPage"
            :disabled="currentPage === 1"
            class="pagination-btn"
          >
            ←
          </button>
          <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
          <button
            @click="nextPage"
            :disabled="currentPage === totalPages"
            class="pagination-btn"
          >
            →
          </button>
        </div>
      </div>
      <div class="table-container" @click.stop>
        <table class="results-table" :style="{ fontFamily: settingsStore.tableFont }">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in paginatedData" :key="row.id">
              <td v-for="column in columns" :key="column">{{ row[column] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Resize handles - only show when selected -->
    <template v-if="isSelected">
      <!-- Corner handles -->
      <div class="resize-handle nw" @mousedown="handleResizeStart($event, 'nw')"></div>
      <div class="resize-handle ne" @mousedown="handleResizeStart($event, 'ne')"></div>
      <div class="resize-handle sw" @mousedown="handleResizeStart($event, 'sw')"></div>
      <div class="resize-handle se" @mousedown="handleResizeStart($event, 'se')"></div>

      <!-- Edge handles -->
      <div class="resize-handle n" @mousedown="handleResizeStart($event, 'n')"></div>
      <div class="resize-handle e" @mousedown="handleResizeStart($event, 'e')"></div>
      <div class="resize-handle s" @mousedown="handleResizeStart($event, 's')"></div>
      <div class="resize-handle w" @mousedown="handleResizeStart($event, 'w')"></div>
    </template>
  </div>
</template>

<style scoped>
.sql-box {
  position: absolute;
  background: #282c34;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  isolation: isolate;
  z-index: 1;
}

.sql-box.selected {
  border-color: #42b883;
  box-shadow: 0 4px 16px rgba(66, 184, 131, 0.4);
  z-index: 10;
}

.sql-box.dragging {
  z-index: 100;
}

.sql-box-header {
  background: #21252b;
  padding: 12px 16px;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #181a1f;
}

.sql-box-header:active {
  cursor: grabbing;
}

.sql-box-header span {
  color: #abb2bf;
  font-weight: 500;
  font-size: 14px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-button {
  background: #42b883;
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
}

.run-button:hover:not(:disabled) {
  background: #35a372;
  transform: scale(1.05);
}

.run-button:disabled {
  background: #4a5568;
  cursor: not-allowed;
  opacity: 0.5;
}

.drag-indicator {
  color: #5c6370;
  font-size: 12px;
  letter-spacing: -2px;
}

.sql-editor {
  overflow: auto;
  cursor: text;
  flex-shrink: 0;
}

.sql-editor :deep(.cm-editor) {
  height: 100%;
  cursor: text;
}

.sql-editor :deep(.cm-scroller) {
  overflow: auto;
  cursor: text;
}

.sql-editor :deep(.cm-content) {
  cursor: text;
}

/* Splitter */
.splitter {
  height: 8px;
  background: #21252b;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.splitter:hover {
  background: #2c313a;
}

.splitter-line {
  width: 40px;
  height: 2px;
  background: #5c6370;
  border-radius: 1px;
}

/* Results section */
.results-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e2227;
}

.error-banner {
  padding: 10px 12px;
  background: #3f1f1f;
  border-bottom: 1px solid #7f1d1d;
  color: #fca5a5;
  font-size: 12px;
  flex-shrink: 0;
}

.results-header {
  padding: 8px 12px;
  background: #21252b;
  border-bottom: 1px solid #181a1f;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.results-title {
  color: #abb2bf;
  font-size: 12px;
  font-weight: 500;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-btn {
  background: #2c313a;
  color: #abb2bf;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: #3e4451;
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  color: #abb2bf;
  font-size: 12px;
  min-width: 50px;
  text-align: center;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: default;
  position: relative;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 12px;
  color: #abb2bf;
}

.results-table thead {
  position: sticky;
  top: 0;
  background: #282c34;
  z-index: 2;
}

.results-table thead tr {
  display: table-row;
}

.results-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 2px solid #181a1f;
  white-space: nowrap;
  background: #282c34;
  position: sticky;
  top: 0;
}

.results-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #181a1f;
  white-space: nowrap;
}

.results-table tbody tr:hover {
  background: #2c313a;
}

/* Resize handles */
.resize-handle {
  position: absolute;
  background: #42b883;
  z-index: 10;
}

/* Corner handles */
.resize-handle.nw,
.resize-handle.ne,
.resize-handle.sw,
.resize-handle.se {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.resize-handle.nw {
  top: -4px;
  left: -4px;
  cursor: nw-resize;
}

.resize-handle.ne {
  top: -4px;
  right: -4px;
  cursor: ne-resize;
}

.resize-handle.sw {
  bottom: -4px;
  left: -4px;
  cursor: sw-resize;
}

.resize-handle.se {
  bottom: -4px;
  right: -4px;
  cursor: se-resize;
}

/* Edge handles */
.resize-handle.n,
.resize-handle.s {
  height: 4px;
  left: 8px;
  right: 8px;
  cursor: ns-resize;
}

.resize-handle.e,
.resize-handle.w {
  width: 4px;
  top: 8px;
  bottom: 8px;
  cursor: ew-resize;
}

.resize-handle.n {
  top: -2px;
}

.resize-handle.s {
  bottom: -2px;
}

.resize-handle.e {
  right: -2px;
}

.resize-handle.w {
  left: -2px;
}

.resize-handle:hover {
  background: #35a372;
}
</style>
