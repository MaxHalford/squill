<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, provide, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import MenuBar from '../components/MenuBar.vue'
import DependencyArrows from '../components/DependencyArrows.vue'
import OnboardingModal from '../components/OnboardingModal.vue'
import UploadProgress from '../components/UploadProgress.vue'
import BoxCreationButtons from '../components/BoxCreationButtons.vue'
import DebugPanel from '../components/DebugPanel.vue'

// Lazy-load box components - only loaded when needed
const SqlBox = defineAsyncComponent(() => import('../components/SqlBox.vue'))
const SchemaBox = defineAsyncComponent(() => import('../components/SchemaBox.vue'))
const StickyNoteBox = defineAsyncComponent(() => import('../components/StickyNoteBox.vue'))
const RowDetailBox = defineAsyncComponent(() => import('../components/RowDetailBox.vue'))
const PivotBox = defineAsyncComponent(() => import('../components/PivotBox.vue'))
const HistoryBox = defineAsyncComponent(() => import('../components/HistoryBox.vue'))
const ChatBox = defineAsyncComponent(() => import('../components/ChatBox.vue'))
const ExplainBox = defineAsyncComponent(() => import('../components/ExplainBox.vue'))

// Lazy-load modals - only loaded when opened
const PostgresConnectionModal = defineAsyncComponent(() => import('../components/PostgresConnectionModal.vue'))
const SnowflakeConnectionModal = defineAsyncComponent(() => import('../components/SnowflakeConnectionModal.vue'))
const ClickHouseConnectionModal = defineAsyncComponent(() => import('../components/ClickHouseConnectionModal.vue'))
const MysqlConnectionModal = defineAsyncComponent(() => import('../components/MysqlConnectionModal.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('../components/KeyboardShortcutsModal.vue'))
const WhatsNewModal = defineAsyncComponent(() => import('../components/WhatsNewModal.vue'))
import { useCanvasStore } from '../stores/canvas'
import { useUserStore } from '../stores/user'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'
import { useConnectionsStore } from '../stores/connections'
import { useBigQueryStore } from '../stores/bigquery'
import { useSqlGlotStore } from '../stores/sqlglot'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
import { generateSelectQuery, generateQueryBoxName } from '../utils/queryGenerator'
import { sanitizeFileName } from '../utils/sqlSanitize'
import { DEFAULT_NOTE_CONTENT, DEFAULT_ADD_HINT_CONTENT } from '../constants/defaultQueries'
import { changelog, type ChangelogEntry } from '../data/changelog'
import { loadItem, saveItem } from '../utils/storage'

const route = useRoute()
const router = useRouter()

const canvasStore = useCanvasStore()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const connectionsStore = useConnectionsStore()
const bigqueryStore = useBigQueryStore()
const sqlglotStore = useSqlGlotStore()
const canvasRef = ref<InstanceType<typeof InfiniteCanvas> | null>(null)
const copiedBoxId = ref<number | null>(null)
const copiedBoxIds = ref<number[]>([])
const csvFileInputRef = ref<HTMLInputElement | null>(null)
const isStoresReady = ref(false)
const onboardingDismissed = ref(false)
const showPostgresModal = ref(false)
const showSnowflakeModal = ref(false)
const showClickHouseModal = ref(false)
const showMysqlModal = ref(false)
const showShortcutsModal = ref(false)
const showWhatsNewModal = ref(false)
const whatsNewEntries = ref<ChangelogEntry[]>([])
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

// CSV upload progress state
const uploadingFiles = ref<string[]>([])
const uploadCurrentIndex = ref(0)

// Registry for box query executors
const boxExecutors = ref(new Map())

// Registry for SqlBox component refs (to focus editor on Enter)
const sqlBoxRefs = ref(new Map<number, { focusEditor: () => void }>())

// Registry for SchemaBox component refs (to navigate to tables)
const schemaBoxRefs = ref(new Map<number, { navigateToTable: (info: { connectionType: string; connectionId?: string; tableName: string; projectId?: string; datasetId?: string; databaseName?: string; schemaName?: string }) => Promise<void> }>())

// Register a box's run method
const registerBoxExecutor = (boxId: number, runFn: () => Promise<void>) => {
  boxExecutors.value.set(boxId, runFn)
}

// Unregister a box's run method
const unregisterBoxExecutor = (boxId: number) => {
  boxExecutors.value.delete(boxId)
}

// Execute a query for a specific box
const executeBoxQuery = async (boxId: number) => {
  const executor = boxExecutors.value.get(boxId)
  if (executor) {
    await executor()
  } else {
    console.warn(`No executor found for box ${boxId}`)
  }
}

// Auto-run downstream dependents after a box completes execution
const runDownstream = async (boxId: number, visited?: Set<number>) => {
  if (!settingsStore.autoRunDownstream) return
  const tracking = visited ?? new Set([boxId])
  const downstreamIds = canvasStore.getDownstreamBoxIds(boxId)
    .filter(id => !tracking.has(id) && boxExecutors.value.has(id))
  for (const id of downstreamIds) tracking.add(id)
  await Promise.all(downstreamIds.map(async (id) => {
    await executeBoxQuery(id)
    await runDownstream(id, tracking)
  }))
}

// Provide the registry methods to all descendants
provide('registerBoxExecutor', registerBoxExecutor)
provide('unregisterBoxExecutor', unregisterBoxExecutor)
provide('executeBoxQuery', executeBoxQuery)
provide('runDownstream', runDownstream)

// Stable DOM order: sort by ID so DOM nodes never move (z-index handles visual stacking)
const sortedBoxes = computed(() => [...canvasStore.boxes].sort((a, b) => a.id - b.id))

// Computed: show onboarding when there are no connections, no boxes, and not dismissed
const showOnboarding = computed(() => {
  return isStoresReady.value && connectionsStore.connections.length === 0 && canvasStore.boxes.length === 0 && !onboardingDismissed.value
})

// Computed: get the currently selected SQL box for creation buttons
// Only returns the box if it's actually mounted (ref exists)
const selectedSqlBox = computed(() => {
  if (canvasStore.selectedBoxId === null) return null
  const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
  if (!box || box.type !== 'sql') return null
  // Only return the box if it's actually mounted
  return sqlBoxRefs.value.has(box.id) ? box : null
})

// Handle BigQuery selection from onboarding
const handleSelectBigquery = async () => {
  try {
    await bigqueryStore.signInWithGoogle()
    // Note: signInWithGoogle() redirects to Google OAuth, code below never runs
  } catch (error) {
    console.error('BigQuery connection failed:', error)
    alert('Failed to connect to BigQuery. Please try again.')
  }
}

// Handle DuckDB selection from onboarding
const handleSelectDuckdb = async () => {
  try {
    // Initialize DuckDB
    await duckdbStore.initialize()
    // Create DuckDB connection entry so modal won't reappear
    connectionsStore.addDuckDBConnection()

    // Create default boxes if canvas is empty
    if (canvasStore.boxes.length === 0) {
      createDefaultBoxes()
    }
  } catch (error) {
    console.error('DuckDB initialization failed:', error)
    alert('Failed to initialize DuckDB. Please try again.')
  }
}

// Handle CSV selection from onboarding - open file picker
const handleSelectCsv = () => {
  csvFileInputRef.value?.click()
}

// Handle PostgreSQL selection from onboarding - show credentials modal
const handleSelectPostgres = () => {
  showPostgresModal.value = true
}

// Handle Snowflake selection from onboarding - show credentials modal
const handleSelectSnowflake = () => {
  showSnowflakeModal.value = true
}

// Handle ClickHouse selection from onboarding - show credentials modal
const handleSelectClickHouse = () => {
  showClickHouseModal.value = true
}

// Handle MySQL selection from onboarding - show credentials modal
const handleSelectMysql = () => {
  showMysqlModal.value = true
}

// Handle successful ClickHouse connection
const handleClickHouseConnected = (connectionId: string) => {
  console.log('ClickHouse connected:', connectionId)

  // Create default boxes if canvas is empty
  if (canvasStore.boxes.length === 0) {
    createDefaultBoxes()
  }
}

// Handle successful MySQL connection
const handleMysqlConnected = (connectionId: string) => {
  console.log('MySQL connected:', connectionId)

  // Create default boxes if canvas is empty
  if (canvasStore.boxes.length === 0) {
    createDefaultBoxes()
  }
}

// Handle successful Snowflake connection from onboarding
const handleSnowflakeConnected = (connectionId: string) => {
  console.log('Snowflake connected:', connectionId)

  // Create default boxes if canvas is empty
  if (canvasStore.boxes.length === 0) {
    createDefaultBoxes()
  }
}

// Handle successful PostgreSQL connection
const handlePostgresConnected = (connectionId: string) => {
  // Modal auto-closes, connection is added to store
  console.log('PostgreSQL connected:', connectionId)

  // Create default boxes if canvas is empty
  if (canvasStore.boxes.length === 0) {
    createDefaultBoxes()
  }
}

// Create welcome post-it notes when a connection is added on an empty canvas
const createDefaultBoxes = () => {
  const center = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }

  // Two post-its side by side
  const gap = 80
  const noteWidth = 400

  // Welcome note on the left
  const welcomeX = center.x - gap / 2 - noteWidth / 2
  const welcomeId = canvasStore.addBox('note', { x: welcomeX, y: center.y })
  canvasStore.updateBoxQuery(welcomeId, DEFAULT_NOTE_CONTENT)
  canvasStore.updateBoxName(welcomeId, 'welcome')

  // Add button hint on the right
  const hintX = center.x + gap / 2 + noteWidth / 2
  const hintId = canvasStore.addBox('note', { x: hintX, y: center.y })
  canvasStore.updateBoxQuery(hintId, DEFAULT_ADD_HINT_CONTENT)
  canvasStore.updateBoxName(hintId, 'getting-started')
}

// Handle box created from MenuBar
const handleBoxCreated = (boxId: number) => {
  selectBox(boxId, { shouldPan: true })
  setTimeout(() => {
    sqlBoxRefs.value.get(boxId)?.focusEditor()
  }, 300)
}

// Handle connection added from MenuBar
const handleConnectionAdded = () => {
  // Create default boxes if canvas is empty
  if (canvasStore.boxes.length === 0) {
    createDefaultBoxes()
  }
}

// Handle showing keyboard shortcuts modal
const handleShowShortcuts = () => {
  showShortcutsModal.value = true
}

const handleShowWhatsNew = (sinceDate: string) => {
  const entries = changelog.filter(e => e.date > sinceDate)
  if (entries.length > 0) {
    whatsNewEntries.value = entries
    showWhatsNewModal.value = true
  }
}

// Handle CSV file input from file picker
const handleCsvFileInput = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  const csvFiles = Array.from(files).filter(
    f => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv'
  )

  if (csvFiles.length === 0) {
    alert('Please select CSV files only')
    return
  }

  // Initialize DuckDB if needed (CSV files use DuckDB)
  await duckdbStore.initialize()

  // Get viewport center for positioning
  const center = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }

  // Process CSV files using existing handler
  await handleFileDrop({
    csvFiles,
    nonCsvFiles: [],
    position: center
  })

  // Create DuckDB connection entry so modal closes
  connectionsStore.addDuckDBConnection()

  // Clear input for next use
  input.value = ''
}

// Handle modal close (skip)
const handleCloseOnboarding = () => {
  // User chose to skip - they can use CSV drag-drop later
  onboardingDismissed.value = true
  console.log('Onboarding skipped')
}

const selectBox = (id: number, eventData?: { shouldPan?: boolean }) => {
  const wasAlreadySelected = canvasStore.selectedBoxId === id
  canvasStore.selectBox(id)
  // Smoothly pan viewport to the selected box (if enabled in settings, event allows it, and box wasn't already selected)
  if (settingsStore.panToBoxOnSelect && eventData?.shouldPan && !wasAlreadySelected && canvasRef.value) {
    canvasRef.value.panToBox(id)
  }
}

const deselectBox = () => {
  // Blur active element to stop editing
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  canvasStore.deselectBox()
}

const handleUpdatePosition = (id: number, position: { x: number; y: number }) => {
  canvasStore.updateBoxPosition(id, position)
}

const handleUpdateSize = (id: number, size: { width: number; height: number }) => {
  canvasStore.updateBoxSize(id, size)
}

const handleUpdateMultiPosition = (data: { id: number; x: number; y: number }) => {
  canvasStore.updateBoxPosition(data.id, { x: data.x, y: data.y })
}

const runGarbageCollect = () => {
  const liveBoxIds = new Set(canvasStore.boxes.map(b => b.id))
  duckdbStore.garbageCollect(liveBoxIds)
}

const handleDelete = (id: number) => {
  // Find the box element and add deleting class for animation
  const boxEl = document.querySelector(`[data-box-id="${id}"]`)
  if (boxEl) {
    boxEl.classList.add('deleting')
    // Wait for animation to complete before removing
    setTimeout(() => {
      const previousBoxId = canvasStore.removeBox(id)
      runGarbageCollect()
      // If there was a previous box, select it and pan to it
      if (previousBoxId !== null) {
        selectBox(previousBoxId, { shouldPan: true })
      }
    }, 120) // Match the animation duration
  } else {
    // Fallback: remove immediately if element not found
    const previousBoxId = canvasStore.removeBox(id)
    runGarbageCollect()
    if (previousBoxId !== null) {
      selectBox(previousBoxId, { shouldPan: true })
    }
  }
}

const handleMaximize = (id: number) => {
  // Get the viewport center in canvas coordinates
  const center = canvasRef.value?.getViewportCenter()
  if (!center) return

  // Calculate viewport size in canvas coordinates
  const currentZoom = canvasRef.value?.zoom ?? 1
  const viewportWidth = window.innerWidth / currentZoom
  const viewportHeight = window.innerHeight / currentZoom

  // Use 90% of viewport for the box size (5% padding on each side)
  const targetWidth = viewportWidth * 0.9
  const targetHeight = viewportHeight * 0.9

  // Position box centered in the viewport
  const newX = center.x - targetWidth / 2
  const newY = center.y - targetHeight / 2

  canvasStore.updateBoxPosition(id, { x: newX, y: newY })
  canvasStore.updateBoxSize(id, { width: targetWidth, height: targetHeight })
}

const handleUpdateName = (id: number, name: string) => {
  canvasStore.updateBoxName(id, name)
}

const handleUpdateQuery = (id: number, query: string) => {
  canvasStore.updateBoxQuery(id, query)
}

const handleUpdateEditorHeight = (id: number, height: number) => {
  canvasStore.updateBoxEditorHeight(id, height)
}

const handleDragStart = () => {
  canvasStore.setDraggingBox(true)
}

const handleDragEnd = () => {
  canvasStore.setDraggingBox(false)
}

// Handle restoring a query from history
const handleRestoreQuery = async (data: { query: string; connectionId: string; connectionType: string }) => {
  // Find the history box position to place new box nearby
  const historyBox = canvasStore.boxes.find(box => box.type === 'history')
  let position = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }

  if (historyBox) {
    // Place new box to the right of history box
    position = {
      x: historyBox.x + historyBox.width + 100,
      y: historyBox.y + historyBox.height / 2
    }
  }

  // Create new SQL box with the query
  const engine = data.connectionType as 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'
  const boxId = canvasStore.addBox('sql', position, engine, data.connectionId)
  canvasStore.updateBoxQuery(boxId, data.query)

  selectBox(boxId, { shouldPan: true })

  // Focus the editor after component loads
  setTimeout(() => {
    sqlBoxRefs.value.get(boxId)?.focusEditor()
  }, 300)
}

const handleFileDrop = async ({ csvFiles, duckdbFiles, nonCsvFiles, position }: {
  csvFiles: File[],
  duckdbFiles?: File[],
  nonCsvFiles: File[],
  position: { x: number, y: number }
}) => {
  // Handle DuckDB files
  if (duckdbFiles && duckdbFiles.length > 0) {
    await handleImportDuckDBFiles(duckdbFiles)
  }

  // Show error for unsupported files
  if (nonCsvFiles.length > 0) {
    const fileNames = nonCsvFiles.map(f => f.name).join(', ')
    alert(`Only CSV and DuckDB files are supported. Skipped: ${fileNames}`)
  }

  // If no CSV files, exit early
  if (csvFiles.length === 0) {
    return
  }

  // Filter valid files first
  const MAX_SIZE = 50 * 1024 * 1024
  const validFiles = csvFiles.filter(file => {
    if (file.size > MAX_SIZE) {
      alert(`File ${file.name} is too large (max 50MB)`)
      return false
    }
    if (file.size === 0) {
      alert(`File ${file.name} is empty`)
      return false
    }
    return true
  })

  if (validFiles.length === 0) return

  // Start upload progress
  uploadingFiles.value = validFiles.map(f => f.name)
  uploadCurrentIndex.value = 0

  let currentPosition = { ...position }

  // Process files asynchronously
  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i]
    uploadCurrentIndex.value = i

    try {
      // Load CSV into DuckDB (this is the slow part)
      const tableName = await duckdbStore.loadCsvFile(file, null)

      if (!tableName) {
        console.error('Failed to load CSV')
        continue
      }

      // Ensure DuckDB connection is registered (CSV always uses DuckDB)
      const duckdbConnectionId = connectionsStore.addDuckDBConnection()

      // Create SqlBox with correct query and name
      const boxId = canvasStore.addBox('sql', currentPosition, 'duckdb', duckdbConnectionId)
      const displayName = file.name.replace('.csv', '') + '_query'
      canvasStore.updateBoxName(boxId, displayName)
      canvasStore.updateBoxQuery(boxId, `SELECT *\nFROM ${tableName}`)

      // Associate table with box
      duckdbStore.updateTableBoxId(tableName, boxId)

      // Select the newly created box
      canvasStore.selectBox(boxId)

      // Auto-execute the query
      await nextTick()
      executeBoxQuery(boxId)

      // Offset position for next file
      currentPosition = {
        x: currentPosition.x + 30,
        y: currentPosition.y + 30
      }

    } catch (err: unknown) {
      console.error(`Failed to load CSV ${file.name}:`, err)
      alert(`Failed to load ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Clear upload progress
  uploadingFiles.value = []
  uploadCurrentIndex.value = 0
}

// Import DuckDB files: attach, register connection, create query box
const handleImportDuckDBFiles = async (duckdbFiles: File[]) => {
  for (const file of duckdbFiles) {
    try {
      const { alias, tables } = await duckdbStore.attachDuckDBFile(file)

      // Register as a new connection
      const connectionId = `duckdb-${alias}`
      connectionsStore.upsertConnection({
        id: connectionId,
        type: 'duckdb',
        name: file.name.replace(/\.duckdb$/i, ''),
        database: sanitizeFileName(file.name),
        createdAt: Date.now(),
      })

      // Activate the new connection
      connectionsStore.setActiveConnection(connectionId)

      // Create a query box for the first table (like CSV import)
      if (tables.length > 0) {
        const firstTable = tables[0]
        const tableName = `"${alias}"."main"."${firstTable}"`
        const position = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }
        const boxId = canvasStore.addBox('sql', position, 'duckdb', connectionId)
        canvasStore.updateBoxName(boxId, `${alias}.${firstTable}`)
        canvasStore.updateBoxQuery(boxId, `SELECT *\nFROM ${tableName}`)
        selectBox(boxId, { shouldPan: true })

        await nextTick()
        setTimeout(async () => {
          await executeBoxQuery(boxId)
        }, 100)
      }

      console.log(`Imported DuckDB: ${alias} with tables: ${tables.join(', ')}`)
    } catch (err: unknown) {
      console.error(`Failed to import DuckDB file ${file.name}:`, err)
      alert(`Failed to import ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// Handle import from MenuBar: routes CSV and DuckDB files to their handlers
const handleImportFiles = async (files: File[]) => {
  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'))
  const duckdbFiles = files.filter(f => f.name.toLowerCase().endsWith('.duckdb'))

  if (csvFiles.length > 0) {
    await duckdbStore.initialize()
    const position = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }
    await handleFileDrop({ csvFiles, nonCsvFiles: [], position })
    connectionsStore.addDuckDBConnection()
  }

  if (duckdbFiles.length > 0) {
    await handleImportDuckDBFiles(duckdbFiles)
  }
}

const handleQueryTableFromSchema = async (data: {
  tableName: string,
  boxName?: string,
  engine: 'bigquery' | 'clickhouse' | 'duckdb' | 'mysql' | 'postgres' | 'snowflake',
  connectionId?: string
}) => {
  try {
    // Find schema box to position new box relative to it
    const schemaBox = canvasStore.boxes.find(box => box.type === 'schema')

    let position = null
    if (schemaBox) {
      // Position to the right and slightly below schema box
      position = {
        x: schemaBox.x + schemaBox.width + 30,
        y: schemaBox.y + 50
      }
    } else {
      // Fallback to viewport center if no schema box found
      position = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }
    }

    // Generate query and box name (use provided boxName if available, e.g., for Snowflake without quotes)
    const query = generateSelectQuery(data.tableName)
    const boxName = generateQueryBoxName(data.boxName || data.tableName)

    // Get connection ID based on engine
    let connectionId: string | undefined
    if (data.connectionId) {
      // Use provided connection ID (for postgres)
      connectionId = data.connectionId
    } else if (data.engine === 'duckdb') {
      connectionId = 'duckdb-local'
    } else if (data.engine === 'postgres') {
      connectionId = connectionsStore.getConnectionsByType('postgres')[0]?.id
    } else {
      connectionId = connectionsStore.getConnectionsByType('bigquery')[0]?.id
    }

    // Create box with appropriate engine and connection
    const boxId = canvasStore.addBox('sql', position, data.engine, connectionId)

    // Configure box
    canvasStore.updateBoxName(boxId, boxName)
    canvasStore.updateBoxQuery(boxId, query)

    // Select the newly created box and pan to it
    selectBox(boxId, { shouldPan: true })

    // Auto-execute the query after rendering (same pattern as CSV)
    await nextTick()
    setTimeout(async () => {
      await executeBoxQuery(boxId)
    }, 100)

  } catch (error) {
    console.error('Failed to create query box:', error)
    alert(`Failed to query table: ${(error as Error).message}`)
  }
}

const handleShowRowDetail = (data: {
  rowData: Record<string, unknown>,
  columnTypes: Record<string, string>,
  rowIndex: number,
  globalRowIndex: number,
  clickX: number,
  clickY: number
}) => {
  try {
    // Convert click position to canvas coordinates
    const position = canvasRef.value?.screenToCanvas(data.clickX, data.clickY) || { x: 400, y: 300 }

    // Create detail box
    const boxId = canvasStore.addBox('detail', position)

    // Set name and data (include column types in the stored data)
    const boxName = `Row ${data.globalRowIndex + 1} Detail`
    canvasStore.updateBoxName(boxId, boxName)
    canvasStore.updateBoxQuery(boxId, JSON.stringify({ rowData: data.rowData, columnTypes: data.columnTypes }))

    // Select the box and pan to it
    selectBox(boxId, { shouldPan: true })

  } catch (error) {
    console.error('Failed to create detail box:', error)
    alert(`Failed to show row details: ${(error as Error).message}`)
  }
}

const handleShowColumnAnalytics = (data: {
  columnName: string
  columnType: string
  typeCategory: string
  tableName: string
  clickX: number
  clickY: number
  // Source engine info for running analytics against the source database
  sourceEngine?: string
  originalQuery?: string
  connectionId?: string
  availableColumns?: string[]
}) => {
  try {
    // Convert click position to canvas coordinates
    const position = canvasRef.value?.screenToCanvas(data.clickX, data.clickY) || { x: 400, y: 300 }

    // Create analytics box
    const boxId = canvasStore.addBox('analytics', position)

    // Set name and data - include table and column for context
    const boxName = `${data.tableName}.${data.columnName}`
    canvasStore.updateBoxName(boxId, boxName)

    // Store analytics config as JSON in the query field
    // Include source engine info so analytics can run against the source database
    const analyticsConfig = {
      tableName: data.tableName,
      columnName: data.columnName,
      columnType: data.columnType,
      typeCategory: data.typeCategory,
      autoRun: true,  // Run immediately when newly created
      // Source-based analytics fields
      sourceEngine: data.sourceEngine,
      originalQuery: data.originalQuery,
      connectionId: data.connectionId,
      // Available columns for GROUP BY (from parent ResultsTable)
      availableColumns: data.availableColumns
    }
    canvasStore.updateBoxQuery(boxId, JSON.stringify(analyticsConfig))

    // Set dependency to source table's box for arrow visualization
    const sourceBoxId = duckdbStore.getTableBoxId(data.tableName)
    if (sourceBoxId !== null) {
      canvasStore.updateBoxDependencies(boxId, [sourceBoxId])
    }

    // Select the box and pan to it
    selectBox(boxId, { shouldPan: true })

  } catch (error) {
    console.error('Failed to create analytics box:', error)
    alert(`Failed to show column analytics: ${(error as Error).message}`)
  }
}

const handleShowExplain = (data: {
  planData: unknown
  engine: string
  query: string
  clickX: number
  clickY: number
}, sourceBoxId: number, sourceBoxName: string) => {
  try {
    const position = canvasRef.value?.screenToCanvas(data.clickX, data.clickY) || { x: 400, y: 300 }
    const boxId = canvasStore.addBox('explain', position)

    canvasStore.updateBoxName(boxId, `${sourceBoxName}.plan`)
    canvasStore.updateBoxQuery(boxId, JSON.stringify({
      engine: data.engine,
      query: data.query,
      plan: data.planData,
    }))

    canvasStore.updateBoxDependencies(boxId, [sourceBoxId])
    selectBox(boxId, { shouldPan: true })
  } catch (error) {
    console.error('Failed to create explain box:', error)
  }
}

// Handle Cmd+click navigation from SQL query to table in Schema browser
const handleNavigateToTable = async (info: {
  connectionType: string
  connectionId?: string
  tableName: string
  projectId?: string
  datasetId?: string
  databaseName?: string
  schemaName?: string
}) => {
  try {
    // Find existing schema box or create one
    let schemaBox = canvasStore.boxes.find(box => box.type === 'schema')

    if (!schemaBox) {
      // Create schema box near the center of the viewport
      const center = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }
      const schemaBoxId = canvasStore.addBox('schema', center)
      schemaBox = canvasStore.boxes.find(box => box.id === schemaBoxId)

      // Wait for the box to mount
      await nextTick()
      // Give async component time to load
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (!schemaBox) {
      console.error('Failed to find or create schema box')
      return
    }

    // Select and pan to the schema box
    selectBox(schemaBox.id, { shouldPan: true })

    // Wait for selection and potential async component loading
    await nextTick()

    // Navigate within the schema box
    const schemaBoxRef = schemaBoxRefs.value.get(schemaBox.id)
    if (schemaBoxRef) {
      await schemaBoxRef.navigateToTable(info)
    } else {
      // If ref not available yet (async component still loading), retry after a short delay
      setTimeout(async () => {
        const retryRef = schemaBoxRefs.value.get(schemaBox!.id)
        if (retryRef) {
          await retryRef.navigateToTable(info)
        }
      }, 200)
    }

  } catch (error) {
    console.error('Failed to navigate to table:', error)
  }
}

// Handle creating a new SQL box that queries from an existing box
const handleCreateQueryBox = async (
  sourceBox: { id: number; name: string; x: number; y: number; width: number; height: number; connectionId?: string },
  direction: 'below' | 'right',
) => {
  const GAP = 80
  const position = direction === 'below'
    ? { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height + GAP + 500 / 2 }
    : { x: sourceBox.x + sourceBox.width + GAP + 600 / 2, y: sourceBox.y + sourceBox.height / 2 }

  const connectionId = sourceBox.connectionId || 'duckdb-local'
  const sourceConnection = connectionsStore.connections.find(c => c.id === connectionId)
  const engine = sourceConnection?.type || 'duckdb'
  const boxId = canvasStore.addBox('sql', position, engine, connectionId)
  const tableName = duckdbStore.sanitizeTableName(sourceBox.name)
  canvasStore.updateBoxQuery(boxId, `SELECT *\nFROM ${tableName}`)
  canvasStore.updateBoxDependencies(boxId, [sourceBox.id])
  selectBox(boxId, { shouldPan: true })
  await nextTick()
  setTimeout(() => executeBoxQuery(boxId), 100)
}

const handleKeyDown = (e: KeyboardEvent) => {
  // Don't handle shortcuts if user is typing in an input/textarea or CodeMirror editor
  const activeElement = document.activeElement
  const isInTextInput = activeElement?.tagName === 'INPUT' ||
                        activeElement?.tagName === 'TEXTAREA' ||
                        activeElement?.classList.contains('cm-content')

  // Cmd+J to create new SQL box
  if ((e.ctrlKey || e.metaKey) && e.key === 'j' && !isInTextInput) {
    e.preventDefault()
    e.stopPropagation()
    const boxId = canvasStore.addBox('sql')
    selectBox(boxId, { shouldPan: true })
    setTimeout(() => {
      sqlBoxRefs.value.get(boxId)?.focusEditor()
    }, 300)
    return
  }

  // Delete/Backspace to remove selected box(es)
  // Allow delete even if focus is inside the selected box (but not in a text input)
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInTextInput) {
    // Check if there are multiple boxes selected
    if (canvasStore.selectedBoxIds.size > 0) {
      e.preventDefault()
      canvasStore.removeMultipleBoxes(Array.from(canvasStore.selectedBoxIds))
    }
    // Or single box selected
    else if (canvasStore.selectedBoxId !== null) {
      e.preventDefault()
      handleDelete(canvasStore.selectedBoxId)
    }
  }

  // Cmd+Enter to execute query in selected SQL box(es) (when not focused in editor)
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isInTextInput) {
    if (canvasStore.selectedBoxIds.size > 0) {
      const sqlBoxIds = canvasStore.boxes
        .filter(b => canvasStore.selectedBoxIds.has(b.id) && b.type === 'sql')
        .map(b => b.id)
      if (sqlBoxIds.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        sqlBoxIds.forEach(id => executeBoxQuery(id))
      }
    } else if (canvasStore.selectedBoxId !== null) {
      const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
      if (box?.type === 'sql') {
        e.preventDefault()
        e.stopPropagation()
        executeBoxQuery(box.id)
      }
    }
  }

  // Enter (without modifier) to focus the query editor in selected SQL box
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !isInTextInput && canvasStore.selectedBoxId !== null) {
    const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
    if (box?.type === 'sql') {
      const sqlBoxRef = sqlBoxRefs.value.get(box.id)
      if (sqlBoxRef) {
        e.preventDefault()
        sqlBoxRef.focusEditor()
      }
    }
  }

  // Ctrl+A / Cmd+A to select all boxes
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isInTextInput) {
    e.preventDefault()
    const allBoxIds = canvasStore.boxes.map(box => box.id)
    if (allBoxIds.length > 0) {
      // Blur active element so keyboard shortcuts work on boxes
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      canvasStore.selectMultipleBoxes(allBoxIds)
    }
  }

  // Ctrl+C / Cmd+C to copy selected box(es)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isInTextInput) {
    // Don't intercept if user has text selected (let browser handle text copy)
    const selection = window.getSelection()
    const hasTextSelection = selection && selection.toString().length > 0

    if (!hasTextSelection) {
      // Check if there are multiple boxes selected
      if (canvasStore.selectedBoxIds.size > 0) {
        e.preventDefault()
        copiedBoxIds.value = Array.from(canvasStore.selectedBoxIds)
        copiedBoxId.value = null // Clear single copy
        console.log('Boxes copied:', copiedBoxIds.value)
      }
      // Or single box selected
      else if (canvasStore.selectedBoxId !== null) {
        e.preventDefault()
        copiedBoxId.value = canvasStore.selectedBoxId
        copiedBoxIds.value = [] // Clear multi copy
        console.log('Box copied:', copiedBoxId.value)
      }
    }
  }

  // Ctrl+V / Cmd+V to paste copied box(es)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isInTextInput) {
    // Check if there are multiple boxes to paste
    if (copiedBoxIds.value.length > 0) {
      e.preventDefault()
      const newBoxIds = canvasStore.copyMultipleBoxes(copiedBoxIds.value)
      if (newBoxIds.length > 0) {
        canvasStore.selectMultipleBoxes(newBoxIds)
      }
    }
    // Or single box to paste
    else if (copiedBoxId.value !== null) {
      e.preventDefault()
      const newBoxId = canvasStore.copyBox(copiedBoxId.value)
      if (newBoxId) {
        canvasStore.selectBox(newBoxId)
      }
    }
  }

  // Ctrl+Z / Cmd+Z to undo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    if (!isInTextInput) {
      e.preventDefault()
      console.log('Undo triggered')
      canvasStore.undo()
    } else {
      console.log('Undo blocked - typing detected')
    }
  }

  // Ctrl+Shift+Z / Cmd+Shift+Z to redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
    if (!isInTextInput) {
      e.preventDefault()
      console.log('Redo triggered')
      canvasStore.redo()
    } else {
      console.log('Redo blocked - typing detected')
    }
  }

  // Arrow keys to move or resize selected box
  const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
  if (arrowKeys.includes(e.key) && !isInTextInput && canvasStore.selectedBoxId !== null) {
    e.preventDefault()
    const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
    if (!box) return

    const step = 50

    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl + Arrow: resize box in that direction
      let newWidth = box.width
      let newHeight = box.height
      let newX = box.x
      let newY = box.y

      switch (e.key) {
        case 'ArrowUp':
          newHeight += step
          newY -= step // Extend upward
          break
        case 'ArrowDown':
          newHeight += step // Extend downward
          break
        case 'ArrowLeft':
          newWidth += step
          newX -= step // Extend leftward
          break
        case 'ArrowRight':
          newWidth += step // Extend rightward
          break
      }

      canvasStore.updateBoxSize(canvasStore.selectedBoxId, { width: newWidth, height: newHeight })
      canvasStore.updateBoxPosition(canvasStore.selectedBoxId, { x: newX, y: newY })
    } else {
      // Arrow only: move box
      let newX = box.x
      let newY = box.y

      switch (e.key) {
        case 'ArrowUp':
          newY -= step
          break
        case 'ArrowDown':
          newY += step
          break
        case 'ArrowLeft':
          newX -= step
          break
        case 'ArrowRight':
          newX += step
          break
      }

      canvasStore.updateBoxPosition(canvasStore.selectedBoxId, { x: newX, y: newY })
    }
  }
}

/**
 * Enable Yjs collaboration for Pro users, or handle share links.
 *
 * Called after all stores are ready:
 * - If URL has ?share=TOKEN: validate token, connect as viewer/editor
 * - Else if user is Pro: connect own active canvas
 */
const shareError = ref<string | null>(null)

// Cursor awareness — must match --palette-* vars in style.css
const CURSOR_COLORS = ['#9333ea', '#f87171', '#81d4fa', '#aed581', '#ffcc80']
const guestColorIndex = Math.floor(Math.random() * CURSOR_COLORS.length)
const cursorColor = computed(() => {
  const seed = userStore.user?.id
  if (seed) {
    const hash = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    return CURSOR_COLORS[hash % CURSOR_COLORS.length]
  }
  return CURSOR_COLORS[guestColorIndex]
})
const handleCursorMove = (x: number, y: number) => {
  if (canvasStore.persistenceMode !== 'synced') return
  const name = userStore.user?.firstName ?? userStore.user?.email?.split('@')[0] ?? 'Guest'
  canvasStore.setLocalCursor(x, y, name, cursorColor.value)
}
const handleCursorLeave = () => {
  canvasStore.clearLocalCursor()
}

/**
 * Returns true if the current user should connect as the canvas owner
 * (Pro user with session token who set up the share themselves).
 * Recipients — even Pro users visiting someone else's share — have meta.isShared undefined
 * because that flag is only set when the local user creates a share.
 */
const treatAsOwner = (meta: { isShared?: boolean } | undefined) =>
  !!(userStore.isPro && userStore.sessionToken && meta?.isShared)

/**
 * Re-register the canvas on the server then enable collaboration as the owner.
 */
const enableAsOwner = async (canvasId: string, meta: { name: string }) => {
  try {
    await fetch(`${BACKEND_URL}/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userStore.sessionToken}` },
      body: JSON.stringify({ id: canvasId, name: meta.name }),
    })
  } catch (err) {
    console.warn('[collab] Failed to register canvas on server:', err)
  }
  canvasStore.enableSync(canvasId)
}

const initCollaboration = async () => {
  const shareToken = route.query.share as string | undefined

  // ── Path A: share token in URL (first visit via share link) ──────────────────
  if (shareToken) {
    try {
      const res = await fetch(`${BACKEND_URL}/share/${shareToken}`)
      if (!res.ok) {
        shareError.value = res.status === 410 ? 'This share link has expired.' : 'Invalid share link.'
        return
      }
      const { canvas_id, permission } = await res.json()

      if (permission === 'write' && !userStore.isLoggedIn) {
        sessionStorage.setItem('pending-share-token', shareToken)
      }

      // Load or create a local meta entry for this canvas
      const existingMeta = canvasStore.canvasIndex.find(c => c.id === canvas_id)
      if (!existingMeta) {
        canvasStore.canvasIndex.push({ id: canvas_id, name: 'Shared canvas', createdAt: Date.now(), updatedAt: Date.now() })
        canvasStore.activeCanvasId = canvas_id
      } else if (canvasStore.activeCanvasId !== canvas_id) {
        await canvasStore.switchCanvas(canvas_id)
      }

      const asOwner = treatAsOwner(existingMeta)
      if (asOwner) {
        // Owner visiting their own share link — use owner path, don't overwrite meta
        await enableAsOwner(canvas_id, existingMeta ?? { name: 'Canvas' })
      } else {
        // Recipient: persist token so future navigations auto-reconnect
        canvasStore.setShareToken(canvas_id, shareToken, permission)
        canvasStore.isReadOnly = permission === 'read'
        canvasStore.enableSync(canvas_id)
        // Keep ?share= in URL so it's easy to re-copy; also triggers auto-reconnect logic
        router.replace({ path: '/app', query: { share: shareToken } })
      }
    } catch (err) {
      console.error('[collab] Failed to load shared canvas:', err)
      shareError.value = 'Failed to load the shared canvas.'
    }
    return
  }

  // ── Path B: returning recipient (share token stored in IDB, no URL param) ────
  const activeId = canvasStore.activeCanvasId
  if (activeId) {
    const meta = canvasStore.canvasIndex.find(c => c.id === activeId)
    if (meta?.shareToken && !treatAsOwner(meta)) {
      canvasStore.isReadOnly = meta.sharePermission === 'read'
      canvasStore.enableSync(activeId)
      router.replace({ path: '/app', query: { share: meta.shareToken } })
      return
    }

    // ── Path C: owner with shared canvas ───────────────────────────────────────
    if (meta?.isShared && userStore.isPro && userStore.sessionToken) {
      await enableAsOwner(activeId, meta)
    }
  }
}

// Re-enable collaboration and sync URL whenever the active canvas changes.
// initCollaboration() handles the very first canvas on mount; this watcher
// handles all subsequent canvas switches (menu bar, new canvas, etc.).
watch(() => canvasStore.activeCanvasId, async (newId, oldId) => {
  // Skip the initial load — initCollaboration() owns that case
  if (!oldId || !newId) return

  const meta = canvasStore.canvasIndex.find(c => c.id === newId)
  const asOwner = treatAsOwner(meta)

  // ── URL sync ──────────────────────────────────────────────────────────────────
  // Recipients: surface the share token so the URL is always shareable / copy-able.
  // Owners and non-shared canvases: clean URL (no ?share=).
  if (meta?.shareToken && !asOwner) {
    router.replace({ path: '/app', query: { share: meta.shareToken } })
  } else if (route.query.share) {
    router.replace({ path: '/app', query: {} })
  }

  // ── Collaboration re-init ──────────────────────────────────────────────────────
  // Recipient: has a stored share token (and is not the owner of this canvas)
  if (meta?.shareToken && !asOwner) {
    canvasStore.isReadOnly = meta.sharePermission === 'read'
    canvasStore.enableSync(newId)
    return
  }

  // Owner: their shared canvas
  if (meta?.isShared && userStore.isPro && userStore.sessionToken) {
    await enableAsOwner(newId, meta)
  }
})

onMounted(async () => {
  // Await all stores that need hydration before rendering.
  // DuckDB is included because it hosts the _schemas table (persisted via IDB).
  await Promise.all([
    canvasStore.loadState(),
    connectionsStore.ready,
    settingsStore.ready,
    duckdbStore.initialize(),
  ])

  // Ensure DuckDB local connection always exists in the selector
  connectionsStore.addDuckDBConnection()

  // Re-attach any imported DuckDB files from previous sessions (parallel)
  await Promise.all(
    connectionsStore.connections
      .filter(conn => conn.type === 'duckdb' && conn.database)
      .map(conn => duckdbStore.reattachDuckDBFile(conn.database!, conn.id.replace(/^duckdb-/, '')).catch(() => {}))
  )

  // Clean up orphaned tables/views from previous sessions
  runGarbageCollect()

  // Initialize SQLGlot (Pyodide WASM) — non-blocking, runs in background
  sqlglotStore.initialize().catch(err => {
    console.warn('SQLGlot initialization failed:', err)
  })

  await nextTick()
  isStoresReady.value = true

  // Check for new changelog entries since last visit
  const lastVisit = await loadItem<string>('lastCanvasVisit')
  const newEntries = changelog.filter(e => !lastVisit || e.date > lastVisit)
  if (newEntries.length > 0) {
    whatsNewEntries.value = newEntries
    showWhatsNewModal.value = true
  }
  const today = new Date().toISOString().slice(0, 10)
  await saveItem('lastCanvasVisit', today)

  // Enable collaboration for Pro users, or handle incoming share links
  await initCollaboration()

  window.addEventListener('keydown', handleKeyDown)

  // Set canvas ref in store so it can be used when adding boxes
  if (canvasRef.value) {
    canvasStore.setCanvasRef(canvasRef.value)
  }

  if (canvasStore.persistenceMode === 'synced') {
    // Boxes arrive asynchronously from Yjs — fit to view once the first batch lands
    const stopWatch = watch(
      () => canvasStore.boxes.length,
      async (len) => {
        if (len > 0) {
          stopWatch()
          await nextTick()
          canvasRef.value?.fitToView()
        }
      },
    )
    // Give up after 15s (empty canvas or connection failure)
    setTimeout(stopWatch, 15_000)
  } else {
    // Local mode: boxes are already loaded from IDB
    await nextTick()
    canvasRef.value?.fitToView()
  }

  // Restore BigQuery session (refresh access token from backend)
  bigqueryStore.restoreSession()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="page">
    <MenuBar
      @box-created="handleBoxCreated"
      @connection-added="handleConnectionAdded"
      @show-shortcuts="handleShowShortcuts"
      @import-files="handleImportFiles"
    />

    <!-- Keyboard Shortcuts Modal -->
    <KeyboardShortcutsModal
      :show="showShortcutsModal"
      @close="showShortcutsModal = false"
    />

    <!-- What's New Modal -->
    <WhatsNewModal
      :show="showWhatsNewModal"
      :entries="whatsNewEntries"
      @close="showWhatsNewModal = false"
    />

    <!-- Onboarding Modal -->
    <OnboardingModal
      :show="showOnboarding"
      @close="handleCloseOnboarding"
      @select-bigquery="handleSelectBigquery"
      @select-duckdb="handleSelectDuckdb"
      @select-csv="handleSelectCsv"
      @select-postgres="handleSelectPostgres"
      @select-snowflake="handleSelectSnowflake"
      @select-clickhouse="handleSelectClickHouse"
      @select-mysql="handleSelectMysql"
    />

    <!-- PostgreSQL Connection Modal -->
    <PostgresConnectionModal
      :show="showPostgresModal"
      @close="showPostgresModal = false"
      @connected="handlePostgresConnected"
    />

    <!-- Snowflake Connection Modal -->
    <SnowflakeConnectionModal
      :show="showSnowflakeModal"
      @close="showSnowflakeModal = false"
      @connected="handleSnowflakeConnected"
    />

    <!-- ClickHouse Connection Modal -->
    <ClickHouseConnectionModal
      :show="showClickHouseModal"
      @close="showClickHouseModal = false"
      @connected="handleClickHouseConnected"
    />

    <!-- MySQL Connection Modal -->
    <MysqlConnectionModal
      :show="showMysqlModal"
      @close="showMysqlModal = false"
      @connected="handleMysqlConnected"
    />

    <!-- Hidden file input for CSV picker -->
    <input
      ref="csvFileInputRef"
      type="file"
      accept=".csv,text/csv"
      multiple
      style="display: none"
      @change="handleCsvFileInput"
    >

    <InfiniteCanvas
      ref="canvasRef"
      :boxes="canvasStore.boxes"
      @canvas-click="deselectBox"
      @file-drop="handleFileDrop"
      @cursor-move="handleCursorMove"
      @cursor-leave="handleCursorLeave"
    >
      <!-- Dependency arrows (rendered behind boxes) -->
      <DependencyArrows :boxes="canvasStore.boxes" />

      <!-- Box creation buttons (floating near selected SQL box) -->
      <BoxCreationButtons
        :selected-box="selectedSqlBox"
        @create-box-below="(sb) => handleCreateQueryBox(sb, 'below')"
        @create-box-right="(sb) => handleCreateQueryBox(sb, 'right')"
      />

      <template
        v-for="box in sortedBoxes"
        :key="box.id"
      >
        <!-- SQL Editor Box -->
        <SqlBox
          v-if="box.type === 'sql'"
          :ref="(el: any) => { if (el) sqlBoxRefs.set(box.id, el); else sqlBoxRefs.delete(box.id) }"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-query="box.query"
          :initial-name="box.name"
          :connection-id="box.connectionId"
          :initial-editor-height="box.editorHeight"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:query="handleUpdateQuery(box.id, $event)"
          @update:editor-height="handleUpdateEditorHeight(box.id, $event)"
          @update:multi-position="handleUpdateMultiPosition"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @show-row-detail="handleShowRowDetail"
          @show-column-analytics="handleShowColumnAnalytics"
          @show-explain="(e: any) => handleShowExplain(e, box.id, box.name)"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
          @navigate-to-table="handleNavigateToTable"
        />

        <!-- Schema Browser Box -->
        <SchemaBox
          v-else-if="box.type === 'schema'"
          :ref="(el: any) => { if (el) schemaBoxRefs.set(box.id, el); else schemaBoxRefs.delete(box.id) }"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:multi-position="handleUpdateMultiPosition"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @query-table="handleQueryTableFromSchema"
          @show-column-analytics="handleShowColumnAnalytics"
        />

        <!-- Sticky Note Box -->
        <StickyNoteBox
          v-else-if="box.type === 'note'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-content="box.query"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:content="handleUpdateQuery(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
        />

        <!-- Row Detail Box -->
        <RowDetailBox
          v-else-if="box.type === 'detail'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-row-data="box.query"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
        />

        <!-- Pivot Table Box -->
        <PivotBox
          v-else-if="box.type === 'analytics'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-data="box.query"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:data="handleUpdateQuery(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
        />

        <!-- Query history Box -->
        <HistoryBox
          v-else-if="box.type === 'history'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @restore-query="handleRestoreQuery"
        />

        <!-- AI Chat Box -->
        <ChatBox
          v-else-if="box.type === 'chat'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-name="box.name"
          :initial-query="box.query"
          :connection-id="box.connectionId"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:query="handleUpdateQuery(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
        />

        <!-- Explain Plan Box -->
        <ExplainBox
          v-else-if="box.type === 'explain'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-data="box.query"
          :initial-name="box.name"
          :is-selected="canvasStore.boxSelectionMap.has(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
        />
      </template>
    </InfiniteCanvas>

    <UploadProgress
      :files="uploadingFiles"
      :current-index="uploadCurrentIndex"
    />

    <DebugPanel
      v-if="isLocalhost && canvasRef"
      :zoom="canvasRef.zoom"
      @show-whats-new="handleShowWhatsNew"
    />

    <!-- Bottom progress bar for DuckDB init and schema refresh -->
    <Transition name="slide">
      <div
        v-if="duckdbStore.isInitializing || duckdbStore.schemaRefreshMessage || sqlglotStore.isLoading"
        class="bottom-progress"
      >
        <div class="progress-bar">
          <div class="progress-bar-indeterminate" />
        </div>
        <div class="progress-info">
          <span class="progress-text">{{ duckdbStore.schemaRefreshMessage || (duckdbStore.isInitializing ? 'Initializing DuckDB...' : 'Loading SQL tools...') }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100vh;
  padding-top: 32px; /* Height of macOS-style menu bar */
  overflow: hidden;
}

.page-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.9);
  border-top: var(--border-width-thin) solid var(--border-secondary);
  font-size: 12px;
  color: #666;
  z-index: 100;
}

.footer-description {
  color: #888;
}

.footer-links {
  display: flex;
  gap: 16px;
}

.footer-links a {
  color: #666;
  text-decoration: none;
}

.footer-links a:hover {
  color: #333;
  text-decoration: underline;
}

/* Bottom progress bar (DuckDB init + schema refresh) */
.bottom-progress {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--surface-primary);
  border-top: var(--border-width-thin) solid var(--border-primary);
  z-index: 10000;
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.bottom-progress .progress-bar {
  height: 4px;
  background: var(--surface-secondary);
  overflow: hidden;
}

.bottom-progress .progress-bar-indeterminate {
  height: 100%;
  width: 30%;
  background: var(--text-primary);
  animation: indeterminate 1.5s ease-in-out infinite;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

.bottom-progress .progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bottom-progress .progress-text {
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
