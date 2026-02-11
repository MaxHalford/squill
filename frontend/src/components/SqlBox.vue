<script setup lang="ts">
/**
 * SqlBox — canvas-aware SQL query box.
 *
 * Thin wrapper around QueryPanel that adds canvas integration:
 * - BaseBox window chrome (drag, resize, close, maximize)
 * - Dependency tracking and recursive execution
 * - Query history recording
 * - DuckDB table rename on box name change
 */
import { ref, watch, onMounted, onUnmounted, computed, inject } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryPanel, { type QueryCompleteEvent } from './QueryPanel.vue'
import { useDuckDBStore } from '../stores/duckdb'
import { useCanvasStore } from '../stores/canvas'
import { useConnectionsStore } from '../stores/connections'
import { useQueryHistoryStore } from '../stores/queryHistory'
import { getEffectiveEngine, extractTableReferences, isLocalConnectionType, type TableReferenceWithPosition } from '../utils/queryAnalyzer'
import { DATABASE_INFO } from '../types/database'

const duckdbStore = useDuckDBStore()
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const queryHistoryStore = useQueryHistoryStore()

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
  initialQuery: { type: String, default: 'SELECT *\nFROM bigquery-public-data.chicago_taxi_trips.taxi_trips' },
  initialName: { type: String, default: 'SQL Query' },
  connectionId: { type: String, default: undefined },
})

const emit = defineEmits([
  'select', 'update:position', 'update:size', 'delete', 'maximize',
  'update:name', 'update:query', 'show-row-detail', 'show-column-analytics',
  'drag-start', 'drag-end', 'navigate-to-table',
])

const baseBoxRef = ref<InstanceType<typeof BaseBox> | null>(null)
const queryPanelRef = ref<InstanceType<typeof QueryPanel> | null>(null)
const queryText = ref(props.initialQuery)

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const boxConnection = computed(() => {
  if (!props.connectionId) return null
  return connectionsStore.connections.find(c => c.id === props.connectionId) || null
})

const isConnectionMissing = computed(() => {
  if (!props.connectionId) return false
  return !boxConnection.value
})

const missingConnectionType = computed((): string | undefined => {
  if (!props.connectionId) return undefined
  if (props.connectionId.startsWith('postgres')) return DATABASE_INFO.postgres.name
  if (props.connectionId.startsWith('bigquery')) return DATABASE_INFO.bigquery.name
  if (props.connectionId.startsWith('snowflake')) return DATABASE_INFO.snowflake.name
  return 'database'
})

// ---------------------------------------------------------------------------
// Dependency tracking
// ---------------------------------------------------------------------------

const updateDependenciesFromQuery = (query: string) => {
  try {
    const availableTables = Object.keys(duckdbStore.tables)
    const connectionType = boxConnection.value?.type
    const engine = getEffectiveEngine(connectionType, query, availableTables)

    if (isLocalConnectionType(engine)) {
      const tableRefs = extractTableReferences(query)
      const dependencyBoxIds = tableRefs
        .map(ref => {
          const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
          let boxId = duckdbStore.getTableBoxId(tableName)

          if (boxId === null) {
            const matchingBox = canvasStore.boxes.find(b =>
              duckdbStore.sanitizeTableName(b.name) === tableName,
            )
            boxId = matchingBox?.id ?? null
          }

          return boxId
        })
        .filter((boxId): boxId is number => boxId !== null && boxId !== undefined && boxId !== props.boxId)

      const uniqueDeps = [...new Set(dependencyBoxIds)]
      canvasStore.updateBoxDependencies(props.boxId, uniqueDeps)
    } else {
      canvasStore.updateBoxDependencies(props.boxId, [])
    }
  } catch (err) {
    console.warn('Failed to update dependencies:', err)
  }
}

const runMissingDependencies = async (query: string) => {
  const tableRefs = extractTableReferences(query)
  if (tableRefs.length === 0) return

  const availableTables = await duckdbStore.getFreshTableNames()

  const missingTables = tableRefs
    .filter(ref => {
      const tableName = ref.split('.').pop()!.replace(/`/g, '').toLowerCase()
      const isBigQueryTable = ref.includes('.') && ref.split('.').length >= 2
      return !isBigQueryTable && !availableTables.includes(tableName)
    })
    .map(ref => ref.split('.').pop()!.replace(/`/g, '').toLowerCase())

  if (missingTables.length === 0) return

  for (const tableName of missingTables) {
    let boxIdToRun = duckdbStore.getTableBoxId(tableName)

    if (!boxIdToRun) {
      const box = canvasStore.boxes.find(b =>
        duckdbStore.sanitizeTableName(b.name) === tableName,
      )
      boxIdToRun = box?.id ?? null
    }

    if (boxIdToRun && boxIdToRun !== props.boxId && executeBoxQuery) {
      await executeBoxQuery(boxIdToRun)
    }
  }
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

// Sync queryText from prop changes (e.g., from localStorage reload)
let isUpdatingFromProp = false
watch(() => props.initialQuery, (newQuery) => {
  isUpdatingFromProp = true
  queryText.value = newQuery
  setTimeout(() => { isUpdatingFromProp = false }, 0)

  if (newQuery) updateDependenciesFromQuery(newQuery)
})

// Recalculate dependencies when DuckDB schema changes (table renames, etc.)
watch(() => duckdbStore.schemaVersion, () => {
  if (queryText.value) updateDependenciesFromQuery(queryText.value)
})

// Debounced emit of query changes for persistence + dependency tracking
let queryTimeout: ReturnType<typeof setTimeout> | null = null
watch(queryText, (newQuery) => {
  if (isUpdatingFromProp) return

  if (queryTimeout) clearTimeout(queryTimeout)
  queryTimeout = setTimeout(() => {
    emit('update:query', newQuery)
    updateDependenciesFromQuery(newQuery)
  }, 500)
})

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

const handleQueryComplete = (result: QueryCompleteEvent) => {
  updateDependenciesFromQuery(queryPanelRef.value?.getQuery() || queryText.value)

  if (props.connectionId) {
    queryHistoryStore.recordQuery({
      query: queryPanelRef.value?.getQuery() || queryText.value,
      connectionId: props.connectionId,
      connectionType: result.engine,
      success: true,
      boxName: baseBoxRef.value?.boxName || props.initialName,
      executionTimeMs: result.executionTimeMs,
      rowCount: result.rowCount,
    })
  }
}

const handleQueryError = (errorMessage: string) => {
  if (props.connectionId) {
    const currentEngine = getEffectiveEngine(
      boxConnection.value?.type,
      queryText.value,
      Object.keys(duckdbStore.tables),
    )
    queryHistoryStore.recordQuery({
      query: queryPanelRef.value?.getQuery() || queryText.value,
      connectionId: props.connectionId,
      connectionType: currentEngine,
      success: false,
      boxName: baseBoxRef.value?.boxName || props.initialName,
      errorMessage,
    })
  }
}

const handleNavigateToTable = (ref: TableReferenceWithPosition) => {
  const connectionType = boxConnection.value?.type || 'duckdb'
  const connectionId = boxConnection.value?.id

  const navigationInfo: {
    connectionType: string
    connectionId?: string
    tableName: string
    projectId?: string
    datasetId?: string
    databaseName?: string
    schemaName?: string
  } = {
    connectionType,
    connectionId,
    tableName: ref.rawName,
  }

  if (connectionType === 'bigquery' && ref.parts.length === 3) {
    navigationInfo.projectId = ref.parts[0]
    navigationInfo.datasetId = ref.parts[1]
    navigationInfo.tableName = ref.parts[2]
  } else if (connectionType === 'snowflake' && ref.parts.length === 3) {
    navigationInfo.databaseName = ref.parts[0]
    navigationInfo.schemaName = ref.parts[1]
    navigationInfo.tableName = ref.parts[2]
  } else if ((connectionType === 'postgres' || connectionType === 'snowflake') && ref.parts.length === 2) {
    navigationInfo.schemaName = ref.parts[0]
    navigationInfo.tableName = ref.parts[1]
  }

  emit('navigate-to-table', navigationInfo)
}

const handleUpdateName = async (newName: string) => {
  try {
    await duckdbStore.renameTable(props.initialName, newName)
  } catch (err) {
    console.warn('Failed to rename table:', err)
  }
  emit('update:name', newName)
}

// Registered run function that first resolves dependencies, then executes
const registeredRun = async () => {
  const query = queryPanelRef.value?.getQuery() || queryText.value
  try {
    await runMissingDependencies(query)
  } catch (depErr) {
    console.warn('Failed to run dependencies:', depErr)
  }
  await queryPanelRef.value?.runQuery()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  if (registerBoxExecutor) {
    registerBoxExecutor(props.boxId, registeredRun)
  }
})

onUnmounted(() => {
  if (queryTimeout) {
    clearTimeout(queryTimeout)
    queryTimeout = null
  }
  if (unregisterBoxExecutor) {
    unregisterBoxExecutor(props.boxId)
  }
})

defineExpose({
  focusEditor: () => queryPanelRef.value?.focusEditor(),
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
    :connection-missing="isConnectionMissing"
    :connection-type="missingConnectionType"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="handleUpdateName"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <QueryPanel
      ref="queryPanelRef"
      v-model="queryText"
      :connection-id="connectionId"
      :box-id="boxId"
      :box-name="baseBoxRef?.boxName || initialName"
      @query-complete="handleQueryComplete"
      @query-error="handleQueryError"
      @navigate-to-table="handleNavigateToTable"
      @show-row-detail="emit('show-row-detail', $event)"
      @show-column-analytics="emit('show-column-analytics', $event)"
    />
  </BaseBox>
</template>
