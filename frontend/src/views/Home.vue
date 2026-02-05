<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, provide, computed, defineAsyncComponent } from 'vue'
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import MenuBar from '../components/MenuBar.vue'
import DependencyArrows from '../components/DependencyArrows.vue'
import OnboardingModal from '../components/OnboardingModal.vue'
import UploadProgress from '../components/UploadProgress.vue'
import BoxCreationButtons from '../components/BoxCreationButtons.vue'

// Lazy-load box components - only loaded when needed
const SqlBox = defineAsyncComponent(() => import('../components/SqlBox.vue'))
const SchemaBox = defineAsyncComponent(() => import('../components/SchemaBox.vue'))
const StickyNoteBox = defineAsyncComponent(() => import('../components/StickyNoteBox.vue'))
const RowDetailBox = defineAsyncComponent(() => import('../components/RowDetailBox.vue'))
const ColumnAnalyticsBox = defineAsyncComponent(() => import('../components/ColumnAnalyticsBox.vue'))
const HistoryBox = defineAsyncComponent(() => import('../components/HistoryBox.vue'))

// Lazy-load modals - only loaded when opened
const PostgresConnectionModal = defineAsyncComponent(() => import('../components/PostgresConnectionModal.vue'))
const SnowflakeConnectionModal = defineAsyncComponent(() => import('../components/SnowflakeConnectionModal.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('../components/KeyboardShortcutsModal.vue'))
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'
import { useConnectionsStore } from '../stores/connections'
import { useBigQueryStore } from '../stores/bigquery'
import { usePostgresStore } from '../stores/postgres'
import { generateSelectQuery, generateQueryBoxName } from '../utils/queryGenerator'
import { DEFAULT_NOTE_CONTENT, DEFAULT_ADD_HINT_CONTENT } from '../constants/defaultQueries'

const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const connectionsStore = useConnectionsStore()
const bigqueryStore = useBigQueryStore()
const postgresStore = usePostgresStore()
const canvasRef = ref<any>(null)
const copiedBoxId = ref<number | null>(null)
const copiedBoxIds = ref<number[]>([])
const csvFileInputRef = ref<HTMLInputElement | null>(null)
const isStoresReady = ref(false)
const onboardingDismissed = ref(false)
const showPostgresModal = ref(false)
const showSnowflakeModal = ref(false)
const showShortcutsModal = ref(false)

// CSV upload progress state
const uploadingFiles = ref<string[]>([])
const uploadCurrentIndex = ref(0)

// Registry for box query executors
const boxExecutors = ref(new Map())

// Registry for SqlBox component refs (to focus editor on Enter)
const sqlBoxRefs = ref(new Map<number, { focusEditor: () => void }>())

// Registry for SchemaBox component refs (to navigate to tables)
const schemaBoxRefs = ref(new Map<number, { navigateToTable: (info: any) => Promise<void> }>())

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

// Provide the registry methods to all descendants
provide('registerBoxExecutor', registerBoxExecutor)
provide('unregisterBoxExecutor', unregisterBoxExecutor)
provide('executeBoxQuery', executeBoxQuery)

// Computed: show onboarding when there are no connections and not dismissed
const showOnboarding = computed(() => {
  return isStoresReady.value && connectionsStore.connections.length === 0 && !onboardingDismissed.value
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
  await handleCsvDrop({
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

const handleDelete = (id: number) => {
  // Find the box element and add deleting class for animation
  const boxEl = document.querySelector(`[data-box-id="${id}"]`)
  if (boxEl) {
    boxEl.classList.add('deleting')
    // Wait for animation to complete before removing
    setTimeout(() => {
      const previousBoxId = canvasStore.removeBox(id)
      // If there was a previous box, select it and pan to it
      if (previousBoxId !== null) {
        selectBox(previousBoxId, { shouldPan: true })
      }
    }, 120) // Match the animation duration
  } else {
    // Fallback: remove immediately if element not found
    const previousBoxId = canvasStore.removeBox(id)
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

const handleCsvDrop = async ({ csvFiles, nonCsvFiles, position }: {
  csvFiles: File[],
  nonCsvFiles: File[],
  position: { x: number, y: number }
}) => {
  // Show error for non-CSV files
  if (nonCsvFiles.length > 0) {
    const fileNames = nonCsvFiles.map(f => f.name).join(', ')
    alert(`Only CSV files are supported. Skipped: ${fileNames}`)
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

    } catch (err: any) {
      console.error(`Failed to load CSV ${file.name}:`, err)
      alert(`Failed to load ${file.name}: ${err.message}`)
    }
  }

  // Clear upload progress
  uploadingFiles.value = []
  uploadCurrentIndex.value = 0
}

const handleQueryTableFromSchema = async (data: {
  tableName: string,
  boxName?: string,
  engine: 'bigquery' | 'duckdb' | 'postgres' | 'snowflake',
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
    const query = generateSelectQuery(data.tableName, data.engine)
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
  rowData: Record<string, any>,
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

// Handle Cmd+click navigation from SQL query to table in Schema Explorer
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
const handleCreateQueryBoxBelow = async (sourceBox: { id: number; name: string; x: number; y: number; width: number; height: number; connectionId?: string }) => {
  // Default SQL box dimensions: 600x500
  // addBox centers at position, so we need to add half the new box height
  const NEW_BOX_HEIGHT = 500
  const GAP = 80 // Gap between boxes for arrow visibility
  const position = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height + GAP + NEW_BOX_HEIGHT / 2
  }

  // Use the source box's connection
  const connectionId = sourceBox.connectionId || 'duckdb-local'

  // Create new box
  const boxId = canvasStore.addBox('sql', position, 'duckdb', connectionId)

  // Generate query that references the source box's table
  const tableName = duckdbStore.sanitizeTableName(sourceBox.name)
  const query = `SELECT *\nFROM ${tableName}`

  canvasStore.updateBoxQuery(boxId, query)

  // Select and focus the new box
  selectBox(boxId, { shouldPan: true })

  // Auto-execute after a short delay to let the box render
  await nextTick()
  setTimeout(() => executeBoxQuery(boxId), 100)
}

const handleCreateQueryBoxRight = async (sourceBox: { id: number; name: string; x: number; y: number; width: number; height: number; connectionId?: string }) => {
  // Default SQL box dimensions: 600x500
  // addBox centers at position, so we need to add half the new box width
  const NEW_BOX_WIDTH = 600
  const GAP = 80 // Gap between boxes for arrow visibility
  const position = {
    x: sourceBox.x + sourceBox.width + GAP + NEW_BOX_WIDTH / 2,
    y: sourceBox.y + sourceBox.height / 2
  }

  // Use the source box's connection
  const connectionId = sourceBox.connectionId || 'duckdb-local'

  // Create new box
  const boxId = canvasStore.addBox('sql', position, 'duckdb', connectionId)

  // Generate query that references the source box's table
  const tableName = duckdbStore.sanitizeTableName(sourceBox.name)
  const query = `SELECT *\nFROM ${tableName}`

  canvasStore.updateBoxQuery(boxId, query)

  // Select and focus the new box
  selectBox(boxId, { shouldPan: true })

  // Auto-execute after a short delay to let the box render
  await nextTick()
  setTimeout(() => executeBoxQuery(boxId), 100)
}

const handleKeyDown = (e: KeyboardEvent) => {
  // Don't handle shortcuts if user is typing in an input/textarea or CodeMirror editor
  const activeElement = document.activeElement
  const isInTextInput = activeElement?.tagName === 'INPUT' ||
                        activeElement?.tagName === 'TEXTAREA' ||
                        activeElement?.classList.contains('cm-content')

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

  // Cmd+Enter to execute query in selected SQL box (when not focused in editor)
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isInTextInput && canvasStore.selectedBoxId !== null) {
    const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
    if (box?.type === 'sql') {
      e.preventDefault()
      e.stopPropagation()
      executeBoxQuery?.(box.id)
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

onMounted(async () => {
  // Load saved canvas state
  canvasStore.loadState()

  // Ensure connections store is loaded
  connectionsStore.loadState()

  // Mark stores as ready immediately so UI renders
  await nextTick()
  isStoresReady.value = true

  window.addEventListener('keydown', handleKeyDown)

  // Set canvas ref in store so it can be used when adding boxes
  if (canvasRef.value) {
    canvasStore.setCanvasRef(canvasRef.value)
  }

  // Fit to view immediately after boxes render (before network calls)
  await nextTick()
  if (canvasRef.value) {
    canvasRef.value.fitToView()
  }

  // Background initialization (don't block UI)
  // Start DuckDB initialization early - ensures WASM is ready for first query
  duckdbStore.initialize()

  // Restore BigQuery session (refresh access token from backend)
  bigqueryStore.restoreSession()

  // Restore PostgreSQL schemas for all postgres connections
  const postgresConnections = connectionsStore.connections.filter(c => c.type === 'postgres')
  Promise.all(
    postgresConnections.map(conn => postgresStore.fetchAllColumns(conn.id))
  )
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
    />

    <!-- Keyboard Shortcuts Modal -->
    <KeyboardShortcutsModal
      :show="showShortcutsModal"
      @close="showShortcutsModal = false"
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

    <!-- Hidden file input for CSV picker -->
    <input
      ref="csvFileInputRef"
      type="file"
      accept=".csv,text/csv"
      multiple
      style="display: none"
      @change="handleCsvFileInput"
    />

    <InfiniteCanvas
      ref="canvasRef"
      :boxes="canvasStore.boxes"
      @canvas-click="deselectBox"
      @csv-drop="handleCsvDrop"
    >
      <!-- Dependency arrows (rendered behind boxes) -->
      <DependencyArrows :boxes="canvasStore.boxes" />

      <!-- Box creation buttons (floating near selected SQL box) -->
      <BoxCreationButtons
        :selected-box="selectedSqlBox"
        @create-box-below="handleCreateQueryBoxBelow"
        @create-box-right="handleCreateQueryBoxRight"
      />

      <template v-for="box in canvasStore.visibleBoxes" :key="box.id">
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:query="handleUpdateQuery(box.id, $event)"
          @update:multi-position="handleUpdateMultiPosition"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @show-row-detail="handleShowRowDetail"
          @show-column-analytics="handleShowColumnAnalytics"
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
        />

        <!-- Column Analytics Box -->
        <ColumnAnalyticsBox
          v-else-if="box.type === 'analytics'"
          :box-id="box.id"
          :initial-x="box.x"
          :initial-y="box.y"
          :initial-width="box.width"
          :initial-height="box.height"
          :initial-z-index="box.zIndex"
          :initial-data="box.query"
          :initial-name="box.name"
          :is-selected="canvasStore.isBoxSelected(box.id)"
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
          @restore-query="handleRestoreQuery"
        />
      </template>
    </InfiniteCanvas>

    <UploadProgress
      :files="uploadingFiles"
      :current-index="uploadCurrentIndex"
    />

    <!-- DuckDB initialization loading indicator -->
    <Transition name="slide">
      <div v-if="duckdbStore.isInitializing" class="duckdb-loading">
        <div class="progress-bar">
          <div class="progress-bar-indeterminate" />
        </div>
        <div class="progress-info">
          <span class="progress-text">Initializing DuckDB...</span>
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
  border-top: 1px solid #e0e0e0;
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

/* DuckDB loading indicator */
.duckdb-loading {
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

.duckdb-loading .progress-bar {
  height: 4px;
  background: var(--surface-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.duckdb-loading .progress-bar-indeterminate {
  height: 100%;
  width: 30%;
  background: var(--color-duckdb);
  border-radius: 2px;
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

.duckdb-loading .progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.duckdb-loading .progress-text {
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
