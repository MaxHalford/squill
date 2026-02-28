<script setup lang="ts">
/**
 * QueryPanel — reusable query execution panel.
 *
 * Contains the full "editor + splitter + results" triad with all execution
 * logic. Used by both SqlBox (wrapped in BaseBox with dependency tracking)
 * and ChatBox (embedded alongside the chat panel).
 */
import { ref, inject, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useBigQueryStore } from '../stores/bigquery'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useConnectionsStore } from '../stores/connections'
import { useSettingsStore } from '../stores/settings'
import { useUserStore } from '../stores/user'
import { useQueryResultsStore } from '../stores/queryResults'
import { getEffectiveEngine, isLocalConnectionType, type TableReferenceWithPosition } from '../utils/queryAnalyzer'
import { cleanQueryForExecution } from '../utils/sqlSanitize'
import { useQueryExecution } from '../composables/useQueryExecution'
import { buildDuckDBSchema, type SchemaNamespace } from '../utils/schemaBuilder'
import { suggestFix, type LineSuggestion, type FixContext } from '../services/ai'
import { isFixableError } from '../utils/errorClassifier'
import { getConnectionDisplayName } from '../utils/connectionHelpers'
import { type DatabaseEngine, type QueryCompleteEvent } from '../types/database'

export type { QueryCompleteEvent }

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const bigqueryStore = useBigQueryStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const connectionsStore = useConnectionsStore()
const settingsStore = useSettingsStore()
const userStore = useUserStore()
const queryResultsStore = useQueryResultsStore()
const { executeQuery } = useQueryExecution()

// Inject canvas zoom for splitter dragging (defaults to 1 when not on canvas)
const canvasZoom = inject('canvasZoom', ref(1))

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  modelValue?: string
  connectionId?: string
  boxId?: number | null
  boxName?: string
  showAutofix?: boolean
  showRowDetail?: boolean
  showAnalytics?: boolean
  initialEditorHeight?: number
}>(), {
  modelValue: '',
  connectionId: undefined,
  boxId: null,
  boxName: 'untitled',
  showAutofix: true,
  showRowDetail: true,
  showAnalytics: true,
  initialEditorHeight: 150,
})

const emit = defineEmits<{
  'update:modelValue': [query: string]
  'update:editorHeight': [height: number]
  'query-complete': [result: QueryCompleteEvent]
  'query-error': [error: string]
  'navigate-to-table': [ref: TableReferenceWithPosition]
  'show-row-detail': [payload: { rowData: Record<string, unknown>; columnTypes: Record<string, string>; rowIndex: number; globalRowIndex: number; clickX: number; clickY: number }]
  'show-column-analytics': [payload: { columnName: string; columnType: string; typeCategory: string; tableName: string; clickX: number; clickY: number; sourceEngine?: string; originalQuery?: string; connectionId?: string; availableColumns?: string[] }]
}>()

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_EDITOR_HEIGHT = 100
const MIN_RESULTS_FRACTION = 0.1
const SPLITTER_HEIGHT = 4

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Splitter
const isDraggingSplitter = ref(false)
const editorHeight = ref(props.initialEditorHeight)
const panelHeight = ref(500) // tracked via ResizeObserver
const dragStart = ref({ y: 0 })

// Query state
const queryText = ref(props.modelValue)
const resultTableName = ref<string | null>(null)
const queryStats = ref<Record<string, unknown> | null>(null)
const isRunning = ref(false)
const error = ref<string | null>(null)
const detectedEngine = ref<string | null>(null)
let abortController: AbortController | null = null
let backgroundLoadController: AbortController | null = null

// Fix suggestion state
const suggestion = ref<LineSuggestion | null>(null)
const isFetchingFix = ref(false)

const editorRef = ref<InstanceType<typeof QueryEditor> | null>(null)
const rootRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

// ---------------------------------------------------------------------------
// Sync v-model
// ---------------------------------------------------------------------------

let isUpdatingFromProp = false

watch(() => props.modelValue, (newVal) => {
  if (newVal !== queryText.value) {
    isUpdatingFromProp = true
    queryText.value = newVal
    setTimeout(() => { isUpdatingFromProp = false }, 0)
  }
})

watch(queryText, (newQuery) => {
  if (!isUpdatingFromProp) {
    emit('update:modelValue', newQuery)
  }
})

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const boxConnection = computed(() => {
  if (!props.connectionId) return null
  return connectionsStore.connections.find(c => c.id === props.connectionId) || null
})

const connectionDisplayName = computed(() => {
  const baseName = getConnectionDisplayName(boxConnection.value)
  if (boxConnection.value?.type === 'bigquery' && boxConnection.value?.projectId) {
    return `${baseName} / ${boxConnection.value.projectId}`
  }
  return baseName
})

const isConnectionMissing = computed(() => {
  if (!props.connectionId) return false
  return !boxConnection.value
})


// ---------------------------------------------------------------------------
// Engine detection & schema
// ---------------------------------------------------------------------------

const currentEngine = computed(() => {
  const tables = duckdbStore.tables
  const connectionType = boxConnection.value?.type
  return getEffectiveEngine(connectionType, queryText.value, Object.keys(tables))
})

const currentDialect = computed((): 'bigquery' | 'duckdb' | 'postgres' => {
  const engine = currentEngine.value
  if (engine === 'snowflake') return 'postgres'
  return engine
})

const isEngineLoading = computed(() => {
  if (duckdbStore.isInitializing) return true
  if (!duckdbStore.isInitialized && duckdbStore.initError) return true
  if (isConnectionMissing.value) return true
  return false
})

// Editor schema for CodeMirror autocompletion.
// DuckDB's own tables are always included; connection-specific schemas are
// loaded asynchronously from the _schemas DuckDB table.
const editorSchema = ref<SchemaNamespace>({})

watch(
  [() => boxConnection.value, () => duckdbStore.schemaVersion],
  async () => {
    const duckdbSchema = buildDuckDBSchema(duckdbStore.tables)
    const conn = boxConnection.value
    if (conn?.type && conn.type !== 'duckdb' && conn?.id) {
      const connectionSchema = await duckdbStore.getEditorSchema(
        conn.type,
        conn.id,
        conn.projectId,
      )
      editorSchema.value = { ...duckdbSchema, ...connectionSchema }
    } else {
      editorSchema.value = duckdbSchema
    }
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// Lazy loading
// ---------------------------------------------------------------------------

const fetchNextBatch = async (
  engine: string,
  query: string,
  tableName: string,
  schema: { name: string; type: string }[],
  pageTokenOrOffset: string | number | undefined,
) => {
  if (!settingsStore.fetchPaginationEnabled) return
  if (props.boxId === null) return

  if (backgroundLoadController) backgroundLoadController.abort()
  backgroundLoadController = new AbortController()
  queryResultsStore.setBackgroundLoading(props.boxId, true)

  const batchSize = settingsStore.fetchBatchSize

  try {
    if (engine === 'bigquery') {
      const pageToken = pageTokenOrOffset as string | undefined
      if (!pageToken) return

      const result = await bigqueryStore.runQueryPaginated(
        query, batchSize, pageToken, backgroundLoadController.signal, boxConnection.value?.id,
      )
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        queryResultsStore.updateFetchProgress(
          props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, result.pageToken,
        )
      }
    } else if (engine === 'postgres') {
      const offset = pageTokenOrOffset as number
      const result = await postgresStore.runQueryPaginated(
        boxConnection.value?.id || '', query, batchSize, offset, false, backgroundLoadController.signal,
      )
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        queryResultsStore.updateFetchProgress(
          props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, undefined, result.nextOffset,
        )
      }
    } else if (engine === 'snowflake') {
      const offset = pageTokenOrOffset as number
      const result = await snowflakeStore.runQueryPaginated(
        boxConnection.value?.id || '', query, batchSize, offset, false, backgroundLoadController.signal,
      )
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        queryResultsStore.updateFetchProgress(
          props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, undefined, result.nextOffset,
        )
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Lazy loading failed:', err)
    }
  } finally {
    if (props.boxId !== null) queryResultsStore.setBackgroundLoading(props.boxId, false)
    backgroundLoadController = null
  }
}

const handleRequestMoreData = async (_neededRows: number) => {
  if (props.boxId === null) return
  const fetchState = queryResultsStore.getFetchState(props.boxId)
  if (!fetchState || !fetchState.hasMoreRows || fetchState.isFetching || fetchState.isBackgroundLoading) return

  const engine = fetchState.sourceEngine
  const query = fetchState.originalQuery
  const tableName = resultTableName.value
  const schema = fetchState.schema
  if (!query || !tableName || !schema) return

  const pageTokenOrOffset = engine === 'bigquery' ? fetchState.pageToken : fetchState.nextOffset
  await fetchNextBatch(engine, query, tableName, schema, pageTokenOrOffset)
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

const runQuery = async (overrideQuery?: string): Promise<QueryCompleteEvent> => {
  // If an override query is provided, set it in the editor first
  if (overrideQuery !== undefined) {
    queryText.value = overrideQuery
    await nextTick()
  }

  isRunning.value = true
  error.value = null
  detectedEngine.value = null
  abortController = new AbortController()

  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
  }

  try {
    const query = cleanQueryForExecution(editorRef.value?.getQuery() ?? queryText.value)
    const startTime = performance.now()

    const availableTables = await duckdbStore.getFreshTableNames()
    const connectionType = boxConnection.value?.type
    const engine = getEffectiveEngine(connectionType, query, availableTables)
    detectedEngine.value = engine

    const tableName = duckdbStore.sanitizeTableName(props.boxName || 'untitled')
    const usePagination = settingsStore.fetchPaginationEnabled && !isLocalConnectionType(engine)
    const connectionId = boxConnection.value?.id

    let execResult: { rowCount: number; executionTimeMs: number; engine: string; stats?: Record<string, unknown> }

    if (usePagination) {
      const batchSize = settingsStore.fetchBatchSize

      if (engine === 'bigquery') {
        if (!connectionId) throw new Error('Please connect to BigQuery first')

        const paginatedResult = await bigqueryStore.runQueryPaginated(
          query, batchSize, undefined, abortController.signal, connectionId,
        )
        await duckdbStore.storeResults(props.boxName || 'untitled', paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns, 'bigquery')
        if (props.boxId !== null) {
          queryResultsStore.initQueryResult(props.boxId, 'bigquery', {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            pageToken: paginatedResult.pageToken,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns,
          })
        }
        execResult = { rowCount: paginatedResult.rows.length, executionTimeMs: 0, engine, stats: paginatedResult.stats }
      } else if (engine === 'postgres') {
        if (!connectionId) throw new Error('No PostgreSQL connection selected')

        const paginatedResult = await postgresStore.runQueryPaginated(
          connectionId, query, batchSize, 0, true, abortController.signal,
        )
        await duckdbStore.storeResults(props.boxName || 'untitled', paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns)
        if (props.boxId !== null) {
          queryResultsStore.initQueryResult(props.boxId, 'postgres', {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            nextOffset: paginatedResult.nextOffset,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns,
          })
        }
        execResult = { rowCount: paginatedResult.rows.length, executionTimeMs: 0, engine, stats: paginatedResult.stats }
      } else if (engine === 'snowflake') {
        if (!connectionId) throw new Error('No Snowflake connection selected')

        const paginatedResult = await snowflakeStore.runQueryPaginated(
          connectionId, query, batchSize, 0, true, abortController.signal,
        )
        await duckdbStore.storeResults(props.boxName || 'untitled', paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns)
        if (props.boxId !== null) {
          queryResultsStore.initQueryResult(props.boxId, 'snowflake', {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            nextOffset: paginatedResult.nextOffset,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns,
          })
        }
        execResult = { rowCount: paginatedResult.rows.length, executionTimeMs: 0, engine, stats: paginatedResult.stats }
      } else {
        throw new Error(`Database type "${engine}" is not yet supported`)
      }

      execResult.executionTimeMs = Math.round(performance.now() - startTime)
    } else {
      const result = await executeQuery(query, props.boxName || 'untitled', boxConnection.value?.type, connectionId, { boxId: props.boxId ?? undefined })
      if (props.boxId !== null) {
        queryResultsStore.initQueryResult(props.boxId, result.engine, {
          totalRows: result.rowCount,
          fetchedRows: result.rowCount,
          hasMoreRows: false,
        })
      }
      execResult = result
    }

    // Clear any previous suggestion on successful run
    suggestion.value = null

    // Clear first to trigger watch even if table name is unchanged
    resultTableName.value = null
    await nextTick()

    resultTableName.value = tableName

    queryStats.value = {
      ...(execResult.stats || {}),
      rowCount: execResult.rowCount,
      executionTimeMs: execResult.executionTimeMs,
      engine,
    }

    const completeEvent: QueryCompleteEvent = {
      tableName,
      rowCount: execResult.rowCount,
      columns: (execResult as { columns?: string[] }).columns || [],
      executionTimeMs: execResult.executionTimeMs,
      engine: engine as DatabaseEngine,
      stats: execResult.stats as QueryCompleteEvent['stats'],
    }

    emit('query-complete', completeEvent)
    return completeEvent
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      error.value = 'Query cancelled'
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err)
      error.value = errorMessage
      console.error('Query error:', err)

      emit('query-error', errorMessage)

      // Request AI fix suggestion
      if (props.showAutofix) {
        suggestion.value = null
        const engine = currentEngine.value
        const databaseDialect: 'bigquery' | 'postgres' | 'duckdb' = engine === 'snowflake' ? 'postgres' : engine
        if (settingsStore.autofixEnabled && userStore.isPro && userStore.sessionToken && isFixableError(errorMessage, databaseDialect)) {
          isFetchingFix.value = true
          try {
            const query = editorRef.value?.getQuery() || queryText.value
            const fixContext: FixContext = {
              connectionId: props.connectionId,
              connectionType: engine,
              projectId: boxConnection.value?.projectId,
            }
            const fix = await suggestFix({
              query,
              error_message: errorMessage,
              database_dialect: databaseDialect,
            }, userStore.sessionToken, fixContext)
            suggestion.value = fix
          } catch (fixErr) {
            console.warn('Failed to get fix suggestion:', fixErr)
          } finally {
            isFetchingFix.value = false
          }
        }
      }
    }
    resultTableName.value = null
    queryStats.value = null
    throw err // Re-throw so callers can handle
  } finally {
    isRunning.value = false
    abortController = null
  }
}

const stopQuery = () => {
  if (abortController) abortController.abort()
  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
    if (props.boxId !== null) queryResultsStore.setBackgroundLoading(props.boxId, false)
  }
}

const handleAcceptSuggestion = () => {
  if (editorRef.value && suggestion.value) {
    editorRef.value.acceptSuggestion()
    suggestion.value = null
    error.value = null
  }
}

// ---------------------------------------------------------------------------
// Splitter
// ---------------------------------------------------------------------------

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
    const contentHeight = panelHeight.value
    const minResultsHeight = contentHeight * MIN_RESULTS_FRACTION
    const maxEditorHeight = contentHeight - SPLITTER_HEIGHT - minResultsHeight
    if (newHeight >= MIN_EDITOR_HEIGHT && newHeight <= maxEditorHeight) {
      editorHeight.value = newHeight
      dragStart.value.y = e.clientY
    }
  }
}

const handleMouseUp = () => {
  if (isDraggingSplitter.value) {
    isDraggingSplitter.value = false
    emit('update:editorHeight', editorHeight.value)
  }
}

const handleSplitterDblClick = () => {
  editorHeight.value = (panelHeight.value - SPLITTER_HEIGHT) / 2
  emit('update:editorHeight', editorHeight.value)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  // Track panel height via ResizeObserver
  if (rootRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        panelHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(rootRef.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  resizeObserver?.disconnect()

  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
  }

  if (props.boxId !== null) {
    queryResultsStore.cleanup(props.boxId)
  }
})

// ---------------------------------------------------------------------------
// Expose
// ---------------------------------------------------------------------------

defineExpose({
  runQuery,
  stopQuery,
  getQuery: () => editorRef.value?.getQuery() || queryText.value,
  focusEditor: () => editorRef.value?.focus(),
})
</script>

<template>
  <div
    ref="rootRef"
    class="query-panel"
  >
    <QueryEditor
      ref="editorRef"
      v-model="queryText"
      :height="editorHeight"
      :is-running="isRunning"
      :disabled="isEngineLoading"
      :dialect="currentDialect"
      :schema="editorSchema"
      :suggestion="showAutofix ? suggestion : undefined"
      :connection-type="boxConnection?.type"
      :connection-id="boxConnection?.id"
      @run="runQuery()"
      @stop="stopQuery"
      @accept-suggestion="handleAcceptSuggestion"
      @dismiss-suggestion="suggestion = null"
      @navigate-to-table="emit('navigate-to-table', $event)"
      @ready="() => {}"
    />

    <div
      class="splitter"
      @mousedown="handleSplitterMouseDown"
      @dblclick="handleSplitterDblClick"
    />

    <ResultsTable
      :table-name="resultTableName"
      :stats="queryStats"
      :error="error"
      :is-fetching-fix="isFetchingFix"
      :no-relevant-fix="suggestion?.noRelevantFix"
      :box-name="boxName"
      :box-id="boxId"
      :connection-name="connectionDisplayName"
      :show-row-detail="showRowDetail"
      :show-analytics="showAnalytics"
      @show-row-detail="emit('show-row-detail', $event)"
      @show-column-analytics="emit('show-column-analytics', $event)"
      @request-more-data="handleRequestMoreData"
    />
  </div>
</template>

<style scoped>
.query-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Splitter - acts as the visual border between editor and results */
.splitter {
  height: var(--border-width-thin);
  background: var(--border-primary);
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
  isolation: isolate;
}

/* Larger hit area for easier dragging */
.splitter::before {
  content: '';
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: 0;
  right: 0;
  z-index: 10;
}
</style>
