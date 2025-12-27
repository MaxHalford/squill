<script setup>
import { ref, inject } from 'vue'
import ResizableBox from './ResizableBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useAuthStore } from '../stores/auth'
import { useDuckDBStore } from '../stores/duckdb'
import { detectQueryEngine } from '../utils/queryAnalyzer'

const authStore = useAuthStore()
const duckdbStore = useDuckDBStore()

// Inject canvas zoom for splitter dragging
const canvasZoom = inject('canvasZoom', ref(1))

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialQuery: { type: String, default: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50' },
  initialName: { type: String, default: 'SQL Query' }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'update:query'])

// Editable name state
const isEditingName = ref(false)
const boxName = ref(props.initialName)
const nameInputRef = ref(null)

const MIN_EDITOR_HEIGHT = 100
const MIN_RESULTS_HEIGHT = 200

// Splitter for editor/results
const isDraggingSplitter = ref(false)
const editorHeight = ref(150)
const boxHeight = ref(props.initialHeight)
const dragStart = ref({ y: 0 })

// Query state
const queryText = ref(props.initialQuery)
const queryResults = ref(null)
const queryStats = ref(null)
const isRunning = ref(false)
const error = ref(null)
const detectedEngine = ref(null)
let abortController = null

const editorRef = ref(null)
const resultsRef = ref(null)

// Watch for prop changes (e.g., when loading from localStorage)
import { watch } from 'vue'

let isUpdatingFromProp = false

watch(() => props.initialName, (newName) => {
  boxName.value = newName
})

watch(() => props.initialQuery, (newQuery) => {
  isUpdatingFromProp = true
  queryText.value = newQuery
  setTimeout(() => { isUpdatingFromProp = false }, 0)
})

// Emit query changes to parent for persistence (debounced)
let queryTimeout = null
watch(queryText, (newQuery) => {
  if (isUpdatingFromProp) return

  if (queryTimeout) clearTimeout(queryTimeout)
  queryTimeout = setTimeout(() => {
    emit('update:query', newQuery)
  }, 500)
})

// Run query
const runQuery = async () => {
  if (!authStore.isAuthenticated) {
    error.value = 'Please upload service account credentials in the sidebar'
    return
  }

  isRunning.value = true
  error.value = null
  detectedEngine.value = null
  abortController = new AbortController()

  try {
    const query = editorRef.value.getQuery()
    const startTime = performance.now()

    // Get fresh table names from DuckDB before detecting engine
    const availableTables = await duckdbStore.getFreshTableNames()

    // Detect which engine to use
    const engine = detectQueryEngine(query, availableTables)
    detectedEngine.value = engine

    let result

    if (engine === 'duckdb') {
      // Execute in DuckDB
      result = await duckdbStore.runQuery(query)
    } else {
      // Execute in BigQuery
      result = await authStore.runQuery(query, abortController.signal)

      // Automatically store results in DuckDB
      try {
        const tableName = await duckdbStore.storeResults(boxName.value, result.rows)
        if (tableName) {
          console.log(`Results stored as DuckDB table: ${tableName}`)
        }
      } catch (storageErr) {
        console.warn('Failed to store results in DuckDB:', storageErr)
        // Don't fail the query, just warn
      }
    }

    const endTime = performance.now()

    // Calculate execution time
    const executionTimeMs = endTime - startTime

    queryResults.value = result.rows
    queryStats.value = {
      ...result.stats,
      executionTimeMs: Math.round(executionTimeMs),
      engine: engine
    }

    if (resultsRef.value) {
      resultsRef.value.resetPagination()
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      error.value = 'Query cancelled'
    } else {
      error.value = err.message || 'Query execution failed'
    }
    queryResults.value = null
    queryStats.value = null
  } finally {
    isRunning.value = false
    abortController = null
  }
}

// Stop query
const stopQuery = () => {
  if (abortController) {
    abortController.abort()
  }
}

// Handle splitter dragging
const handleSplitterMouseDown = (e) => {
  e.stopPropagation()
  e.preventDefault()
  isDraggingSplitter.value = true
  dragStart.value.y = e.clientY
}

const handleMouseMove = (e) => {
  if (isDraggingSplitter.value) {
    const zoom = canvasZoom.value
    const deltaY = (e.clientY - dragStart.value.y) / zoom
    const newHeight = editorHeight.value + deltaY
    const maxEditorHeight = boxHeight.value - MIN_RESULTS_HEIGHT

    if (newHeight >= MIN_EDITOR_HEIGHT && newHeight <= maxEditorHeight) {
      editorHeight.value = newHeight
      dragStart.value.y = e.clientY
    }
  }
}

const handleMouseUp = () => {
  isDraggingSplitter.value = false
}

const handleSelect = () => {
  emit('select')
}

const handleUpdatePosition = (newPosition) => {
  emit('update:position', newPosition)
}

const handleUpdateSize = (newSize) => {
  boxHeight.value = newSize.height
  emit('update:size', newSize)
}

// Handle maximize button
const handleMaximize = (e) => {
  e.stopPropagation() // Prevent triggering header drag
  emit('maximize')
}

// Handle delete button
const handleDelete = (e) => {
  e.stopPropagation() // Prevent triggering header drag
  emit('delete')
}

// Handle name editing
const startEditingName = (e) => {
  e.stopPropagation()
  isEditingName.value = true
  nextTick(() => {
    if (nameInputRef.value) {
      nameInputRef.value.focus()
      nameInputRef.value.select()
    }
  })
}

const finishEditingName = () => {
  isEditingName.value = false
  if (boxName.value.trim()) {
    emit('update:name', boxName.value.trim())
  } else {
    boxName.value = props.initialName
  }
}

const handleNameKeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishEditingName()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    boxName.value = props.initialName
    isEditingName.value = false
  }
}

// Add global mouse listeners for splitter
import { onMounted, onUnmounted, nextTick } from 'vue'

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <ResizableBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    @select="handleSelect"
    @update:position="handleUpdatePosition"
    @update:size="handleUpdateSize"
  >
    <template #header>
      <div class="box-name-container">
        <input
          v-if="isEditingName"
          ref="nameInputRef"
          v-model="boxName"
          @blur="finishEditingName"
          @keydown="handleNameKeydown"
          @click.stop
          class="name-input"
          type="text"
        />
        <span
          v-else
          class="box-name"
          @dblclick="startEditingName"
          title="Double-click to edit"
        >{{ boxName }}</span>
      </div>
      <div class="header-buttons">
        <button
          class="header-btn maximize-btn"
          @click="handleMaximize"
          title="Maximize"
        >⛶</button>
        <button
          class="header-btn delete-btn"
          @click="handleDelete"
          title="Delete"
        >✕</button>
      </div>
    </template>

    <QueryEditor
      ref="editorRef"
      v-model="queryText"
      :height="editorHeight"
      :is-running="isRunning"
      :is-authenticated="authStore.isAuthenticated"
      @run="runQuery"
      @stop="stopQuery"
    />

    <!-- Splitter -->
    <div
      class="splitter"
      @mousedown="handleSplitterMouseDown"
    ></div>

    <ResultsTable
      ref="resultsRef"
      :results="queryResults"
      :stats="queryStats"
      :error="error"
    />
  </ResizableBox>
</template>

<style scoped>
/* Splitter */
.splitter {
  height: var(--border-width-thin);
  background: var(--border-primary);
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
}

/* Invisible larger hit area for easier dragging */
.splitter::before {
  content: '';
  position: absolute;
  top: calc(var(--space-1) * -1);
  bottom: calc(var(--space-1) * -1);
  left: 0;
  right: 0;
}

/* Header name container */
.box-name-container {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-right: auto;
}

.box-name {
  cursor: pointer;
  user-select: none;
  display: inline-block;
}

.box-name:hover {
  opacity: 0.7;
}

.name-input {
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font-size: inherit;
  font-family: inherit;
  font-weight: inherit;
  padding: 0;
  margin: 0;
  min-width: 100px;
  max-width: 400px;
  line-height: var(--line-height-tight);
  height: 14px;
  display: inline-block;
}

/* Header buttons */
.header-buttons {
  display: flex;
  gap: var(--space-1);
}

.header-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-inverse);
  cursor: pointer;
  font-size: var(--font-size-body-lg);
  font-weight: bold;
  padding: 0;
  line-height: 1;
  transition: all 0.2s;
  outline: none;
}

.header-btn:focus {
  outline: none;
}

.header-btn:hover {
  background: var(--text-inverse);
  color: var(--surface-inverse);
}

.delete-btn:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: var(--text-inverse);
}
</style>
