<script setup lang="ts">
import { ref, inject, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useBigQueryStore } from '../stores/bigquery'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useCanvasStore } from '../stores/canvas'
import { useSchemaStore } from '../stores/bigquerySchema'
import { useConnectionsStore } from '../stores/connections'
import { useSettingsStore } from '../stores/settings'
import { useUserStore } from '../stores/user'
import { useQueryResultsStore } from '../stores/queryResults'
import { getEffectiveEngine, extractTableReferences, isLocalConnectionType, type TableReferenceWithPosition } from '../utils/queryAnalyzer'
import { cleanQueryForExecution } from '../utils/sqlSanitize'
import { buildDuckDBSchema, buildBigQuerySchema, buildPostgresSchema, buildSnowflakeSchema, combineSchemas } from '../utils/schemaBuilder'
import { suggestFix, type LineSuggestion, type FixContext } from '../services/ai'
import { useQueryHistoryStore } from '../stores/queryHistory'
import { isFixableError } from '../utils/errorClassifier'
import { getConnectionDisplayName } from '../utils/connectionHelpers'
import { DATABASE_INFO } from '../types/database'

const bigqueryStore = useBigQueryStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const canvasStore = useCanvasStore()
const schemaStore = useSchemaStore()
const connectionsStore = useConnectionsStore()
const settingsStore = useSettingsStore()
const userStore = useUserStore()
const queryHistoryStore = useQueryHistoryStore()
const queryResultsStore = useQueryResultsStore()

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
  initialQuery: { type: String, default: 'SELECT *\nFROM bigquery-public-data.chicago_taxi_trips.taxi_trips' },
  initialName: { type: String, default: 'SQL Query' },
  connectionId: { type: String, default: undefined }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'update:query', 'show-row-detail', 'show-column-analytics', 'drag-start', 'drag-end', 'navigate-to-table'])

// Reference to BaseBox to access boxName
const baseBoxRef = ref<any>(null)

const MIN_EDITOR_HEIGHT = 100
// Minimum results height as a fraction of content area (10%)
const MIN_RESULTS_FRACTION = 0.1
// Header height: 8px padding top + ~14px content + 8px padding bottom + 2px border
const HEADER_HEIGHT = 32
// Splitter visual height is minimal, but we account for flex gap
const SPLITTER_HEIGHT = 4

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
let backgroundLoadController: AbortController | null = null

// Fix suggestion state
const suggestion = ref<LineSuggestion | null>(null)
const isFetchingFix = ref(false)

const editorRef = ref<any>(null)

// Get the connection object for this box
const boxConnection = computed(() => {
  if (!props.connectionId) return null
  return connectionsStore.connections.find(c => c.id === props.connectionId) || null
})

// Get the display name for the connection (shown on hover over engine badge)
// For BigQuery, includes the project ID to match menu bar format
const connectionDisplayName = computed(() => {
  const baseName = getConnectionDisplayName(boxConnection.value)
  if (boxConnection.value?.type === 'bigquery' && boxConnection.value?.projectId) {
    return `${baseName} / ${boxConnection.value.projectId}`
  }
  return baseName
})

// Check if the box has a connectionId but the connection no longer exists
const isConnectionMissing = computed(() => {
  // If no connectionId, box is not tied to a specific connection (uses active connection)
  if (!props.connectionId) return false
  // If connectionId exists but connection is not found, it's missing
  return !boxConnection.value
})

// Get the connection type for display purposes (extract from connectionId format)
const missingConnectionType = computed((): string | undefined => {
  if (!props.connectionId) return undefined
  // connectionId format is typically "type-identifier-timestamp" e.g. "postgres-abc123" or "bigquery-email-123"
  if (props.connectionId.startsWith('postgres')) return DATABASE_INFO.postgres.name
  if (props.connectionId.startsWith('bigquery')) return DATABASE_INFO.bigquery.name
  if (props.connectionId.startsWith('snowflake')) return DATABASE_INFO.snowflake.name
  return 'database'
})

// Get the effective engine based on connection and query content
// Connection type is the default, but DuckDB table references override to DuckDB
const currentEngine = computed(() => {
  const tables = duckdbStore.tables
  const connectionType = boxConnection.value?.type
  return getEffectiveEngine(connectionType, queryText.value, Object.keys(tables))
})

// Get the SQL dialect for CodeMirror syntax highlighting
// Snowflake uses PostgreSQL dialect since they're largely compatible
const currentDialect = computed((): 'bigquery' | 'duckdb' | 'postgres' => {
  const engine = currentEngine.value
  if (engine === 'snowflake') return 'postgres'
  return engine
})

// Disable query execution while DuckDB is initializing, failed, or connection is missing
const isEngineLoading = computed(() => {
  // Check if DuckDB is still initializing - all SQL boxes depend on DuckDB
  // since even remote queries store results in DuckDB for cross-query analysis
  if (duckdbStore.isInitializing) return true
  // Also disable if DuckDB initialization failed
  if (!duckdbStore.isInitialized && duckdbStore.initError) return true
  // Also disable if the connection is missing
  if (isConnectionMissing.value) return true
  return false
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

  // Build PostgreSQL schema if this is a postgres connection
  let postgresSchema = {}
  if (boxConnection.value?.type === 'postgres' && boxConnection.value?.id) {
    // Access schemaVersion to trigger reactivity when schema updates
    void postgresStore.schemaVersion
    postgresSchema = buildPostgresSchema(
      postgresStore.tablesCache,
      postgresStore.columnsCache,
      boxConnection.value.id
    )
  }

  // Build Snowflake schema if this is a snowflake connection
  let snowflakeSchema = {}
  if (boxConnection.value?.type === 'snowflake' && boxConnection.value?.id) {
    // Access schemaVersion to trigger reactivity when schema updates
    void snowflakeStore.schemaVersion
    snowflakeSchema = buildSnowflakeSchema(
      snowflakeStore.tablesCache,
      snowflakeStore.columnsCache,
      boxConnection.value.id
    )
  }

  return combineSchemas(duckdbSchema, bigquerySchema, postgresSchema, snowflakeSchema)
})

// Fetch PostgreSQL or Snowflake schema when connection is used
watch(
  () => boxConnection.value,
  async (conn) => {
    if (conn?.type === 'postgres' && conn?.id) {
      // Fetch all columns for autocomplete (tables are fetched as part of this)
      await postgresStore.fetchAllColumns(conn.id)
    } else if (conn?.type === 'snowflake' && conn?.id) {
      // Fetch all columns for autocomplete (tables are fetched as part of this)
      await snowflakeStore.fetchAllColumns(conn.id)
    }
  },
  { immediate: true }
)

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

// Lazy loading: fetch one batch of data when user navigates beyond loaded data
const fetchNextBatch = async (
  engine: string,
  query: string,
  tableName: string,
  schema: { name: string; type: string }[],
  pageTokenOrOffset: string | number | undefined
) => {
  if (!settingsStore.fetchPaginationEnabled) return

  // Cancel any existing fetch
  if (backgroundLoadController) {
    backgroundLoadController.abort()
  }

  backgroundLoadController = new AbortController()
  queryResultsStore.setBackgroundLoading(props.boxId, true)

  const batchSize = settingsStore.fetchBatchSize

  try {
    if (engine === 'bigquery') {
      const pageToken = pageTokenOrOffset as string | undefined
      if (!pageToken) return

      const result = await bigqueryStore.runQueryPaginated(
        query,
        batchSize,
        pageToken,
        backgroundLoadController.signal,
        boxConnection.value?.id
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        const newFetchedRows = fetchState.fetchedRows + result.rows.length
        queryResultsStore.updateFetchProgress(
          props.boxId,
          newFetchedRows,
          result.hasMore,
          result.pageToken
        )
      }
    } else if (engine === 'postgres') {
      const offset = pageTokenOrOffset as number

      const result = await postgresStore.runQueryPaginated(
        boxConnection.value?.id || '',
        query,
        batchSize,
        offset,
        false, // Don't need count again
        backgroundLoadController.signal
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        const newFetchedRows = fetchState.fetchedRows + result.rows.length
        queryResultsStore.updateFetchProgress(
          props.boxId,
          newFetchedRows,
          result.hasMore,
          undefined,
          result.nextOffset
        )
      }
    } else if (engine === 'snowflake') {
      const offset = pageTokenOrOffset as number

      const result = await snowflakeStore.runQueryPaginated(
        boxConnection.value?.id || '',
        query,
        batchSize,
        offset,
        false, // Don't need count again
        backgroundLoadController.signal
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const fetchState = queryResultsStore.getFetchState(props.boxId)
      if (fetchState) {
        const newFetchedRows = fetchState.fetchedRows + result.rows.length
        queryResultsStore.updateFetchProgress(
          props.boxId,
          newFetchedRows,
          result.hasMore,
          undefined,
          result.nextOffset
        )
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Lazy loading failed:', err)
    }
  } finally {
    queryResultsStore.setBackgroundLoading(props.boxId, false)
    backgroundLoadController = null
  }
}

// Handle request for more data from ResultsTable (lazy loading)
const handleRequestMoreData = async (_neededRows: number) => {
  const fetchState = queryResultsStore.getFetchState(props.boxId)
  if (!fetchState || !fetchState.hasMoreRows || fetchState.isFetching || fetchState.isBackgroundLoading) {
    return // Already loading or no more data
  }

  const engine = fetchState.sourceEngine
  const query = fetchState.originalQuery
  const tableName = resultTableName.value
  const schema = fetchState.schema

  if (!query || !tableName || !schema) return

  // Determine where to continue fetching from
  const pageTokenOrOffset = engine === 'bigquery' ? fetchState.pageToken : fetchState.nextOffset

  // Fetch one batch of data (await to prevent race conditions)
  await fetchNextBatch(engine, query, tableName, schema, pageTokenOrOffset)
}

// Run query
const runQuery = async () => {
  isRunning.value = true
  error.value = null
  detectedEngine.value = null
  abortController = new AbortController()

  // Cancel any existing background loading
  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
  }

  try {
    // Get query and clean it for execution (removes trailing semicolons, trims whitespace)
    const query = cleanQueryForExecution(editorRef.value.getQuery())

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
    const boxName = baseBoxRef.value?.boxName || props.initialName
    const tableName = duckdbStore.sanitizeTableName(boxName)

    // Execute query based on effective engine
    if (isLocalConnectionType(engine)) {
      // Execute in local DuckDB with CTAS for efficient storage
      // This avoids the Arrow → JS → SQL INSERT roundtrip
      result = await duckdbStore.runQueryWithStorage(
        query,
        boxName,
        props.boxId
      )

      // For DuckDB queries, all rows are fetched immediately
      queryResultsStore.initQueryResult(props.boxId, 'duckdb', {
        totalRows: result.stats.rowCount,
        fetchedRows: result.stats.rowCount,
        hasMoreRows: false
      })
    } else {
      // Execute in remote database based on connection type
      // Supports: BigQuery, PostgreSQL
      const usePagination = settingsStore.fetchPaginationEnabled
      const batchSize = settingsStore.fetchBatchSize

      if (engine === 'bigquery') {
        const connectionId = boxConnection.value?.id
        if (!connectionId) {
          throw new Error('Please connect to BigQuery first')
        }
        // Token refresh is handled automatically by bigqueryStore.runQuery/runQueryPaginated

        if (usePagination) {
          // Use paginated query for BigQuery
          const paginatedResult = await bigqueryStore.runQueryPaginated(
            query,
            batchSize,
            undefined, // No page token for first request
            abortController.signal,
            connectionId
          )

          result = {
            rows: paginatedResult.rows,
            schema: paginatedResult.columns,
            stats: paginatedResult.stats
          }

          // Store first batch in DuckDB (BigQuery needs explicit type casts)
          await duckdbStore.storeResults(boxName, paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns, 'bigquery')

          // Initialize fetch state
          // Note: Background loading is disabled - we use lazy loading only
          // (fetch more data when user navigates to pages beyond what's loaded)
          const sourceEngine = 'bigquery' as const
          queryResultsStore.initQueryResult(props.boxId, sourceEngine, {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            pageToken: paginatedResult.pageToken,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns
          })
        } else {
          // Non-paginated flow (original behavior)
          result = await bigqueryStore.runQuery(query, abortController.signal, connectionId)
          await duckdbStore.storeResults(boxName, result.rows as Record<string, unknown>[], props.boxId, result.schema, 'bigquery')
          queryResultsStore.initQueryResult(props.boxId, 'bigquery', {
            totalRows: result.rows.length,
            fetchedRows: result.rows.length,
            hasMoreRows: false
          })
        }
      } else if (engine === 'postgres') {
        const connectionId = boxConnection.value?.id
        if (!connectionId) {
          throw new Error('No PostgreSQL connection selected')
        }

        if (usePagination) {
          // Use paginated query for Postgres
          const paginatedResult = await postgresStore.runQueryPaginated(
            connectionId,
            query,
            batchSize,
            0, // Start at offset 0
            true, // Include count on first request
            abortController.signal
          )

          result = {
            rows: paginatedResult.rows,
            schema: paginatedResult.columns,
            stats: paginatedResult.stats
          }

          // Store first batch in DuckDB
          await duckdbStore.storeResults(boxName, paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns)

          // Initialize fetch state
          // Note: Background loading is disabled - we use lazy loading only
          // (fetch more data when user navigates to pages beyond what's loaded)
          const sourceEngine = 'postgres' as const
          queryResultsStore.initQueryResult(props.boxId, sourceEngine, {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            nextOffset: paginatedResult.nextOffset,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns
          })
        } else {
          // Non-paginated flow (original behavior)
          result = await postgresStore.runQuery(connectionId, query, abortController.signal)
          await duckdbStore.storeResults(boxName, result.rows as Record<string, unknown>[], props.boxId, result.schema)
          queryResultsStore.initQueryResult(props.boxId, 'postgres', {
            totalRows: result.rows.length,
            fetchedRows: result.rows.length,
            hasMoreRows: false
          })
        }
      } else if (engine === 'snowflake') {
        const connectionId = boxConnection.value?.id
        if (!connectionId) {
          throw new Error('No Snowflake connection selected')
        }

        if (usePagination) {
          // Use paginated query for Snowflake
          const paginatedResult = await snowflakeStore.runQueryPaginated(
            connectionId,
            query,
            batchSize,
            0, // Start at offset 0
            true, // Include count on first request
            abortController.signal
          )

          result = {
            rows: paginatedResult.rows,
            schema: paginatedResult.columns,
            stats: paginatedResult.stats
          }

          // Store first batch in DuckDB
          await duckdbStore.storeResults(boxName, paginatedResult.rows as Record<string, unknown>[], props.boxId, paginatedResult.columns)

          // Initialize fetch state
          // Note: Background loading is disabled - we use lazy loading only
          // (fetch more data when user navigates to pages beyond what's loaded)
          const sourceEngine = 'snowflake' as const
          queryResultsStore.initQueryResult(props.boxId, sourceEngine, {
            totalRows: paginatedResult.totalRows,
            fetchedRows: paginatedResult.rows.length,
            hasMoreRows: paginatedResult.hasMore,
            nextOffset: paginatedResult.nextOffset,
            originalQuery: query,
            connectionId,
            schema: paginatedResult.columns
          })
        } else {
          // Non-paginated flow (original behavior)
          result = await snowflakeStore.runQuery(connectionId, query, abortController.signal)
          await duckdbStore.storeResults(boxName, result.rows as Record<string, unknown>[], props.boxId, result.schema)
          queryResultsStore.initQueryResult(props.boxId, 'snowflake', {
            totalRows: result.rows.length,
            fetchedRows: result.rows.length,
            hasMoreRows: false
          })
        }
      } else {
        // Placeholder for future database types
        throw new Error(`Database type "${engine}" is not yet supported`)
      }
    }

    const endTime = performance.now()

    // Calculate execution time
    const executionTimeMs = endTime - startTime

    // Clear any previous suggestion on successful run
    suggestion.value = null

    // Clear first to trigger watch even if table name is unchanged
    resultTableName.value = null
    await nextTick()

    // Set the table name for ResultsTable to query from DuckDB
    resultTableName.value = tableName

    queryStats.value = {
      ...result.stats,
      executionTimeMs: Math.round(executionTimeMs),
      engine: engine
    }

    // Update dependencies after query execution
    updateDependenciesFromQuery(query)

    // Record successful query in history
    if (props.connectionId) {
      queryHistoryStore.recordQuery({
        query,
        connectionId: props.connectionId,
        connectionType: engine,
        success: true,
        boxName: baseBoxRef.value?.boxName || props.initialName,
        executionTimeMs: Math.round(executionTimeMs),
        rowCount: (result.stats as { rowCount?: number })?.rowCount
      })
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      error.value = 'Query cancelled'
    } else {
      // Extract the actual error message
      // DuckDB errors might have the message in different properties
      const errorMessage = err.message || err.toString() || 'Query execution failed'
      error.value = errorMessage
      console.error('Query error:', err)

      // Record failed query in history
      if (props.connectionId) {
        const failedQuery = editorRef.value?.getQuery() || queryText.value
        queryHistoryStore.recordQuery({
          query: failedQuery,
          connectionId: props.connectionId,
          connectionType: currentEngine.value,
          success: false,
          boxName: baseBoxRef.value?.boxName || props.initialName,
          errorMessage
        })
      }

      // Request AI fix suggestion (only for Pro users with autofix enabled, and only for fixable errors)
      suggestion.value = null
      // Map snowflake to postgres for AI autofix since syntax is similar
      const engine = currentEngine.value
      const databaseFlavor: 'bigquery' | 'postgres' | 'duckdb' = engine === 'snowflake' ? 'postgres' : engine
      if (settingsStore.autofixEnabled && userStore.isPro && userStore.sessionToken && isFixableError(errorMessage, databaseFlavor)) {
        isFetchingFix.value = true
        try {
          const query = editorRef.value?.getQuery() || queryText.value

          // Build context for schema and sample queries
          const fixContext: FixContext = {
            connectionId: props.connectionId,
            connectionType: engine,
            projectId: boxConnection.value?.projectId,
          }

          const fix = await suggestFix({
            query,
            error_message: errorMessage,
            database_flavor: databaseFlavor,
          }, userStore.sessionToken, fixContext)
          suggestion.value = fix
        } catch (fixErr) {
          console.warn('Failed to get fix suggestion:', fixErr)
        } finally {
          isFetchingFix.value = false
        }
      }
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
  // Also cancel background loading
  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
    queryResultsStore.setBackgroundLoading(props.boxId, false)
  }
}

// Accept the current fix suggestion
const handleAcceptSuggestion = () => {
  if (editorRef.value && suggestion.value) {
    editorRef.value.acceptSuggestion()
    suggestion.value = null
    error.value = null
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
    // Available content height = box height - header - borders
    const contentHeight = boxHeight.value - HEADER_HEIGHT
    // Minimum results height is relative to content area
    const minResultsHeight = contentHeight * MIN_RESULTS_FRACTION
    // Max editor height leaves room for splitter and minimum results
    const maxEditorHeight = contentHeight - SPLITTER_HEIGHT - minResultsHeight

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
  // Clamp editor height if box was resized smaller
  const contentHeight = newSize.height - HEADER_HEIGHT
  const minResultsHeight = contentHeight * MIN_RESULTS_FRACTION
  const maxEditorHeight = contentHeight - SPLITTER_HEIGHT - minResultsHeight
  if (editorHeight.value > maxEditorHeight) {
    editorHeight.value = Math.max(MIN_EDITOR_HEIGHT, maxEditorHeight)
  }
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

// Handle Cmd+click navigation to table in schema explorer
const handleNavigateToTable = (ref: TableReferenceWithPosition) => {
  const connectionType = boxConnection.value?.type || 'duckdb'
  const connectionId = boxConnection.value?.id

  // Build navigation info based on connection type and table reference parts
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
    tableName: ref.rawName
  }

  // Parse parts based on connection type
  if (connectionType === 'bigquery' && ref.parts.length === 3) {
    // BigQuery: project.dataset.table
    navigationInfo.projectId = ref.parts[0]
    navigationInfo.datasetId = ref.parts[1]
    navigationInfo.tableName = ref.parts[2]
  } else if (connectionType === 'snowflake' && ref.parts.length === 3) {
    // Snowflake: database.schema.table
    navigationInfo.databaseName = ref.parts[0]
    navigationInfo.schemaName = ref.parts[1]
    navigationInfo.tableName = ref.parts[2]
  } else if ((connectionType === 'postgres' || connectionType === 'snowflake') && ref.parts.length === 2) {
    // PostgreSQL or Snowflake: schema.table
    navigationInfo.schemaName = ref.parts[0]
    navigationInfo.tableName = ref.parts[1]
  }

  emit('navigate-to-table', navigationInfo)
}

// Handle keyboard shortcuts when box is selected but editor is not focused
const handleKeydown = (event: KeyboardEvent) => {
  if (!props.isSelected) return

  // Skip if focus is inside the editor - let QueryEditor handle it
  const editorEl = editorRef.value?.$el
  if (editorEl && editorEl.contains(document.activeElement)) return

  // Note: Cmd+Enter is handled by Home.vue when editor is not focused
  // to avoid duplicate handlers (both use window.addEventListener)

  if (event.key === 'Escape' && suggestion.value) {
    event.preventDefault()
    suggestion.value = null
  }
}

// Called when QueryEditor signals it's ready (currently unused, but kept for potential future use)
const handleEditorReady = () => {
  // Focus is now handled by parent via focusEditor()
}

// Add global mouse listeners for splitter and register executor
onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('keydown', handleKeydown)

  // Register this box's runQuery method for dependency execution
  if (registerBoxExecutor) {
    registerBoxExecutor(props.boxId, runQuery)
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('keydown', handleKeydown)

  // Clean up pending timeouts
  if (queryTimeout) {
    clearTimeout(queryTimeout)
    queryTimeout = null
  }

  // Clean up background loading
  if (backgroundLoadController) {
    backgroundLoadController.abort()
    backgroundLoadController = null
  }

  // Clean up fetch state
  queryResultsStore.cleanup(props.boxId)

  // Unregister this box's executor
  if (unregisterBoxExecutor) {
    unregisterBoxExecutor(props.boxId)
  }
})

defineExpose({
  focusEditor: () => editorRef.value?.focus()
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
      :disabled="isEngineLoading"
      :dialect="currentDialect"
      :schema="editorSchema"
      :suggestion="suggestion"
      :connection-type="boxConnection?.type"
      :connection-id="boxConnection?.id"
      @run="runQuery"
      @stop="stopQuery"
      @accept-suggestion="handleAcceptSuggestion"
      @dismiss-suggestion="suggestion = null"
      @navigate-to-table="handleNavigateToTable"
      @ready="handleEditorReady"
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
      :is-fetching-fix="isFetchingFix"
      :no-relevant-fix="suggestion?.noRelevantFix"
      :box-name="baseBoxRef?.boxName || initialName"
      :box-id="boxId"
      :connection-name="connectionDisplayName"
      @show-row-detail="emit('show-row-detail', $event)"
      @show-column-analytics="emit('show-column-analytics', $event)"
      @request-more-data="handleRequestMoreData"
    />
  </BaseBox>
</template>

<style scoped>
/* Splitter - acts as the visual border between editor and results */
.splitter {
  height: var(--border-width-thin);
  background: var(--border-primary);
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
  /* Higher z-index to be above CodeMirror editor content */
  z-index: 10;
  /* Create own stacking context to ensure we're painted on top */
  isolation: isolate;
}

/* Larger hit area for easier dragging - matches resize handle hit area */
.splitter::before {
  content: '';
  position: absolute;
  /* 12px hit area centered on the splitter line */
  top: -6px;
  bottom: -6px;
  left: 0;
  right: 0;
  /* Ensure it captures pointer events */
  z-index: 10;
}
</style>
