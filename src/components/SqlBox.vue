<script setup lang="ts">
import { ref, inject, watch, onMounted, onUnmounted } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useAuthStore } from '../stores/auth'
import { useDuckDBStore } from '../stores/duckdb'
import { useCanvasStore } from '../stores/canvas'
import { detectQueryEngine, extractTableReferences } from '../utils/queryAnalyzer'

const authStore = useAuthStore()
const duckdbStore = useDuckDBStore()
const canvasStore = useCanvasStore()

// Inject canvas zoom for splitter dragging
const canvasZoom = inject('canvasZoom', ref(1))

// Inject box executor registry for recursive dependency execution
const registerBoxExecutor = inject('registerBoxExecutor', null)
const unregisterBoxExecutor = inject('unregisterBoxExecutor', null)
const executeBoxQuery = inject('executeBoxQuery', null)

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

// Reference to BaseBox to access boxName
const baseBoxRef = ref(null)

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
let isUpdatingFromProp = false

watch(() => props.initialQuery, (newQuery) => {
  isUpdatingFromProp = true
  queryText.value = newQuery
  setTimeout(() => { isUpdatingFromProp = false }, 0)

  // Update dependencies when query is updated externally (e.g., from table rename)
  if (newQuery) {
    updateDependenciesFromQuery(newQuery)
  }
})

// Watch for table schema changes (renames, etc.) and recalculate dependencies
watch(() => duckdbStore.schemaVersion, () => {
  if (queryText.value) {
    console.log(`📡 Schema changed, recalculating dependencies for box ${props.boxId}`)
    updateDependenciesFromQuery(queryText.value)
  }
})

// Emit query changes to parent for persistence (debounced)
let queryTimeout = null
watch(queryText, (newQuery) => {
  if (isUpdatingFromProp) return

  if (queryTimeout) clearTimeout(queryTimeout)
  queryTimeout = setTimeout(() => {
    emit('update:query', newQuery)
    // Update dependencies reactively when query changes
    updateDependenciesFromQuery(newQuery)
  }, 500)
})

// Reactively update dependencies when query text changes
const updateDependenciesFromQuery = async (query) => {
  try {
    // Get fresh table names
    const availableTables = await duckdbStore.getFreshTableNames()

    // Detect engine
    const engine = detectQueryEngine(query, availableTables)

    // Only track dependencies for DuckDB queries
    if (engine === 'duckdb') {
      const tableRefs = extractTableReferences(query)
      const dependencyBoxIds = tableRefs
        .map(ref => {
          const tableName = ref.split('.').pop().replace(/`/g, '').toLowerCase()
          const boxId = duckdbStore.getTableBoxId(tableName)
          console.log(`🔗 Box ${props.boxId}: Table "${tableName}" -> BoxId ${boxId}`)
          return boxId
        })
        .filter(boxId => boxId && boxId !== props.boxId)

      const uniqueDeps = [...new Set(dependencyBoxIds)]
      console.log(`🔗 Box ${props.boxId} (${baseBoxRef.value?.boxName}): Dependencies updated to [${uniqueDeps.join(', ')}]`)
      canvasStore.updateBoxDependencies(props.boxId, uniqueDeps)
    } else {
      console.log(`🔗 Box ${props.boxId} (${baseBoxRef.value?.boxName}): BigQuery query, clearing dependencies`)
      canvasStore.updateBoxDependencies(props.boxId, [])
    }
  } catch (err) {
    console.warn('Failed to update dependencies:', err)
  }
}

// Detect and run missing dependencies recursively
const runMissingDependencies = async (query) => {
  const tableRefs = extractTableReferences(query)
  if (tableRefs.length === 0) return

  const availableTables = await duckdbStore.getFreshTableNames()

  // Find missing local tables (exclude BigQuery tables with project.dataset.table pattern)
  const missingTables = tableRefs
    .filter(ref => {
      const tableName = ref.split('.').pop().replace(/`/g, '').toLowerCase()
      const isBigQueryTable = ref.includes('.') && ref.split('.').length >= 2
      return !isBigQueryTable && !availableTables.includes(tableName)
    })
    .map(ref => ref.split('.').pop().replace(/`/g, '').toLowerCase())

  if (missingTables.length === 0) return

  // Find and run boxes that produce missing tables
  for (const tableName of missingTables) {
    let boxIdToRun = duckdbStore.getTableBoxId(tableName)

    // Fallback: find by matching table name to box name
    if (!boxIdToRun) {
      const box = canvasStore.boxes.find(b =>
        duckdbStore.sanitizeTableName(b.name) === tableName
      )
      boxIdToRun = box?.id
    }

    if (boxIdToRun && boxIdToRun !== props.boxId && executeBoxQuery) {
      await executeBoxQuery(boxIdToRun)
    }
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
  detectedEngine.value = null
  abortController = new AbortController()

  try {
    const query = editorRef.value.getQuery()

    // Run missing dependencies first
    try {
      await runMissingDependencies(query)
    } catch (depErr) {
      console.warn('Failed to run dependencies:', depErr)
      // Continue with query execution even if dependency resolution fails
    }

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

      // Store results so they can be queried by other boxes
      try {
        await duckdbStore.storeResults(baseBoxRef.value?.boxName || props.initialName, result.rows, props.boxId)
      } catch (storageErr) {
        console.warn('Failed to store DuckDB results:', storageErr)
      }
    } else {
      // Execute in BigQuery
      result = await authStore.runQuery(query, abortController.signal)

      // Store results in DuckDB for cross-query analysis
      try {
        await duckdbStore.storeResults(baseBoxRef.value?.boxName || props.initialName, result.rows, props.boxId)
      } catch (storageErr) {
        console.warn('Failed to store results in DuckDB:', storageErr)
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

    // Update dependencies for DuckDB queries
    if (engine === 'duckdb') {
      try {
        const tableRefs = extractTableReferences(query)
        const dependencyBoxIds = tableRefs
          .map(ref => {
            const tableName = ref.split('.').pop().replace(/`/g, '').toLowerCase()
            return duckdbStore.getTableBoxId(tableName)
          })
          .filter(boxId => boxId && boxId !== props.boxId)

        canvasStore.updateBoxDependencies(props.boxId, [...new Set(dependencyBoxIds)])
      } catch (depErr) {
        console.warn('Failed to update dependencies:', depErr)
      }
    } else {
      canvasStore.updateBoxDependencies(props.boxId, [])
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

const handleUpdateSize = (newSize) => {
  boxHeight.value = newSize.height
  emit('update:size', newSize)
}

// Handle name update from BaseBox - rename DuckDB table
const handleUpdateName = async (newName) => {
  try {
    await duckdbStore.renameTable(props.initialName, newName)
  } catch (err) {
    console.warn('Failed to rename table:', err)
    // Continue with box rename even if table rename fails
  }

  emit('update:name', newName)
}

// Add global mouse listeners for splitter and register executor
onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  // Register this box's runQuery method for dependency execution
  if (registerBoxExecutor) {
    registerBoxExecutor(props.boxId, runQuery)
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)

  // Unregister this box's executor
  if (unregisterBoxExecutor) {
    unregisterBoxExecutor(props.boxId)
  }
})
</script>

<template>
  <BaseBox
    ref="baseBoxRef"
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="handleUpdateSize"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="handleUpdateName"
  >
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
      :box-name="baseBoxRef?.boxName || initialName"
    />
  </BaseBox>
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
</style>
