<script setup lang="ts">
import { ref, inject, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useAuthStore } from '../stores/auth'
import { useDuckDBStore } from '../stores/duckdb'
import { useCanvasStore } from '../stores/canvas'
import { useSchemaStore } from '../stores/schema'
import { useConnectionsStore } from '../stores/connections'
import { getEffectiveEngine, extractTableReferences, isLocalConnectionType } from '../utils/queryAnalyzer'
import { buildDuckDBSchema, buildBigQuerySchema, combineSchemas } from '../utils/schemaBuilder'

const authStore = useAuthStore()
const duckdbStore = useDuckDBStore()
const canvasStore = useCanvasStore()
const schemaStore = useSchemaStore()
const connectionsStore = useConnectionsStore()

// Inject canvas zoom for splitter dragging
const canvasZoom = inject('canvasZoom', ref(1))

// Inject box executor registry for recursive dependency execution
const registerBoxExecutor = inject<((boxId: number, runFn: () => Promise<void>) => void) | null>('registerBoxExecutor', null)
const unregisterBoxExecutor = inject<((boxId: number) => void) | null>('unregisterBoxExecutor', null)
const executeBoxQuery = inject<((boxId: number) => Promise<void>) | null>('executeBoxQuery', null)

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialQuery: { type: String, default: 'SELECT *\nFROM bigquery-public-data.samples.shakespeare\nLIMIT 50' },
  initialName: { type: String, default: 'SQL Query' },
  connectionId: { type: String, default: undefined }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'update:query', 'show-row-detail', 'drag-start', 'drag-end'])

// Reference to BaseBox to access boxName
const baseBoxRef = ref<any>(null)

const MIN_EDITOR_HEIGHT = 100
const MIN_RESULTS_HEIGHT = 200

// Splitter for editor/results
const isDraggingSplitter = ref(false)
const editorHeight = ref(150)
const boxHeight = ref(props.initialHeight)
const dragStart = ref({ y: 0 })

// Query state
const queryText = ref(props.initialQuery)
const resultTableName = ref<string | null>(null)
const queryStats = ref<any | null>(null)
const isRunning = ref(false)
const error = ref<string | null>(null)
const detectedEngine = ref<string | null>(null)
let abortController: AbortController | null = null

const editorRef = ref<any>(null)

// Get the connection object for this box
const boxConnection = computed(() => {
  if (!props.connectionId) return null
  return connectionsStore.connections.find(c => c.id === props.connectionId) || null
})

// Get the effective engine based on connection and query content
// Connection type is the default, but DuckDB table references override to DuckDB
const currentDialect = computed(() => {
  const tables = duckdbStore.tables
  const connectionType = boxConnection.value?.type
  return getEffectiveEngine(connectionType, queryText.value, Object.keys(tables))
})

// Build combined schema for autocompletion
const editorSchema = computed(() => {
  const duckdbSchema = buildDuckDBSchema(duckdbStore.tables)
  // Get project from connection for BigQuery schema
  const projectId = boxConnection.value?.projectId
  const bigquerySchema = buildBigQuerySchema(
    schemaStore.bigQuerySchemas,
    projectId
  )

  return combineSchemas(duckdbSchema, bigquerySchema)
})

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
let queryTimeout: ReturnType<typeof setTimeout> | null = null
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
const updateDependenciesFromQuery = async (query: string) => {
  try {
    // Get fresh table names
    const availableTables = await duckdbStore.getFreshTableNames()

    // Get effective engine based on connection and query
    const connectionType = boxConnection.value?.type
    const engine = getEffectiveEngine(connectionType, query, availableTables)

    // Only track dependencies for local database queries (DuckDB)
    if (isLocalConnectionType(engine)) {
      const tableRefs = extractTableReferences(query)
      const dependencyBoxIds = tableRefs
        .map(ref => {
          const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
          let boxId = duckdbStore.getTableBoxId(tableName)

          // Fallback: find box by matching table name to box name
          // This handles page reload when DuckDB tables metadata is not persisted
          if (boxId === null) {
            const matchingBox = canvasStore.boxes.find(b =>
              duckdbStore.sanitizeTableName(b.name) === tableName
            )
            boxId = matchingBox?.id ?? null
          }

          return boxId
        })
        .filter((boxId): boxId is number => boxId !== null && boxId !== undefined && boxId !== props.boxId)

      const uniqueDeps = [...new Set(dependencyBoxIds)]
      console.log(`🔗 Box ${props.boxId} (${baseBoxRef.value?.boxName}): Dependencies updated to [${uniqueDeps.join(', ')}]`)
      canvasStore.updateBoxDependencies(props.boxId, uniqueDeps)
    } else {
      console.log(`🔗 Box ${props.boxId} (${baseBoxRef.value?.boxName}): Remote query, clearing dependencies`)
      canvasStore.updateBoxDependencies(props.boxId, [])
    }
  } catch (err) {
    console.warn('Failed to update dependencies:', err)
  }
}

// Detect and run missing dependencies recursively
const runMissingDependencies = async (query: string) => {
  const tableRefs = extractTableReferences(query)
  if (tableRefs.length === 0) return

  const availableTables = await duckdbStore.getFreshTableNames()

  // Find missing local tables (exclude BigQuery tables with project.dataset.table pattern)
  const missingTables = tableRefs
    .filter(ref => {
      const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
      const isBigQueryTable = ref.includes('.') && ref.split('.').length >= 2
      return !isBigQueryTable && !availableTables.includes(tableName)
    })
    .map(ref => ref.split('.').pop()!.replace(/`/g, '').toLowerCase())

  if (missingTables.length === 0) return

  // Find and run boxes that produce missing tables
  for (const tableName of missingTables) {
    let boxIdToRun = duckdbStore.getTableBoxId(tableName)

    // Fallback: find by matching table name to box name
    if (!boxIdToRun) {
      const box = canvasStore.boxes.find(b =>
        duckdbStore.sanitizeTableName(b.name) === tableName
      )
      boxIdToRun = box?.id ?? null
    }

    if (boxIdToRun && boxIdToRun !== props.boxId && executeBoxQuery) {
      await executeBoxQuery(boxIdToRun)
    }
  }
}

// Run query
const runQuery = async () => {
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

    // Get effective engine based on connection and query content
    const connectionType = boxConnection.value?.type
    const engine = getEffectiveEngine(connectionType, query, availableTables)
    detectedEngine.value = engine

    let result

    // Execute query based on effective engine
    if (isLocalConnectionType(engine)) {
      // Execute in local DuckDB with CTAS for efficient storage
      // This avoids the Arrow → JS → SQL INSERT roundtrip
      result = await duckdbStore.runQueryWithStorage(
        query,
        baseBoxRef.value?.boxName || props.initialName,
        props.boxId
      )
    } else {
      // Execute in remote database based on connection type
      // Currently supports: BigQuery
      // Future: Postgres, Snowflake, etc.
      if (engine === 'bigquery') {
        if (!authStore.isAuthenticated) {
          throw new Error('Please connect to BigQuery first')
        }
        result = await authStore.runQuery(query, abortController.signal)
      } else {
        // Placeholder for future database types
        throw new Error(`Database type "${engine}" is not yet supported`)
      }

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

    // Set the table name for ResultsTable to query from DuckDB
    const boxName = baseBoxRef.value?.boxName || props.initialName
    resultTableName.value = duckdbStore.sanitizeTableName(boxName)

    queryStats.value = {
      ...result.stats,
      executionTimeMs: Math.round(executionTimeMs),
      engine: engine
    }

    // Update dependencies after query execution
    updateDependenciesFromQuery(query)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      error.value = 'Query cancelled'
    } else {
      // Extract the actual error message
      // DuckDB errors might have the message in different properties
      const errorMessage = err.message || err.toString() || 'Query execution failed'
      error.value = errorMessage
      console.error('Query error:', err)
    }
    resultTableName.value = null
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
const handleSplitterMouseDown = (e: MouseEvent) => {
  e.stopPropagation()
  e.preventDefault()
  isDraggingSplitter.value = true
  dragStart.value.y = e.clientY
}

const handleMouseMove = (e: MouseEvent) => {
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

const handleUpdateSize = (newSize: { width: number; height: number }) => {
  boxHeight.value = newSize.height
  emit('update:size', newSize)
}

// Handle name update from BaseBox - rename DuckDB table
const handleUpdateName = async (newName: string) => {
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

  // Auto-focus editor if box is selected (newly created or duplicated)
  if (props.isSelected) {
    // Wait for DOM updates and CodeMirror initialization
    nextTick(() => {
      setTimeout(() => {
        editorRef.value?.focus()
      }, 150)
    })
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
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="handleUpdateSize"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="handleUpdateName"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <QueryEditor
      ref="editorRef"
      v-model="queryText"
      :height="editorHeight"
      :is-running="isRunning"
      :dialect="currentDialect"
      :schema="editorSchema"
      @run="runQuery"
      @stop="stopQuery"
    />

    <!-- Splitter -->
    <div
      class="splitter"
      @mousedown="handleSplitterMouseDown"
    ></div>

    <ResultsTable
      :table-name="resultTableName"
      :stats="queryStats"
      :error="error"
      :box-name="baseBoxRef?.boxName || initialName"
      @show-row-detail="emit('show-row-detail', $event)"
    />
  </BaseBox>
</template>

<style scoped>
/* Splitter */
.splitter {
  height: var(--border-width-thin);
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
