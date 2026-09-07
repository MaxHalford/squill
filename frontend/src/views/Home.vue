<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, provide, computed, defineAsyncComponent } from 'vue'
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import MenuBar from '../components/MenuBar.vue'
import DependencyArrows from '../components/DependencyArrows.vue'
import BoxCreationButtons from '../components/BoxCreationButtons.vue'
import DebugPanel from '../components/DebugPanel.vue'
import { getBoxDefinition } from '../boxes'
import type { Box } from '../types/canvas'
import type { DatabaseEngine } from '../types/database'

// Lazy-load modals - only loaded when opened
const KeyboardShortcutsModal = defineAsyncComponent(() => import('../components/KeyboardShortcutsModal.vue'))
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'
import { useConnectionsStore } from '../stores/connections'
import { useBigQueryStore } from '../stores/bigquery'
import { useOpenAIStore } from '../stores/openai'
import { useSqlGlotStore } from '../stores/sqlglot'
import { generateSelectQuery, generateQueryBoxName } from '../utils/queryGenerator'
import { useToast } from '../composables/useToast'

const { showToast } = useToast()

const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const connectionsStore = useConnectionsStore()
const bigqueryStore = useBigQueryStore()
const openAIStore = useOpenAIStore()
const sqlglotStore = useSqlGlotStore()
const canvasRef = ref<InstanceType<typeof InfiniteCanvas> | null>(null)
const copiedBoxId = ref<number | null>(null)
const copiedBoxIds = ref<number[]>([])
const showShortcutsModal = ref(false)
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

const handleStartTutorial = async () => {
  const { startTutorial } = await import('../composables/useTutorial')
  startTutorial()
}

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

// Provide the registry methods to all descendants
provide('registerBoxExecutor', registerBoxExecutor)
provide('unregisterBoxExecutor', unregisterBoxExecutor)
provide('executeBoxQuery', executeBoxQuery)

// Stable DOM order: sort by ID so DOM nodes never move (z-index handles visual stacking)
const sortedBoxes = computed(() => [...canvasStore.boxes].sort((a, b) => a.id - b.id))

// Computed: get the currently selected SQL box for creation buttons
// Only returns the box if it's actually mounted (ref exists)
const selectedSqlBox = computed(() => {
  if (canvasStore.selectedBoxId === null) return null
  const box = canvasStore.boxes.find(b => b.id === canvasStore.selectedBoxId)
  if (!box || box.type !== 'sql') return null
  // Only return the box if it's actually mounted
  return sqlBoxRefs.value.has(box.id) ? box : null
})

// Handle box created from MenuBar
const handleBoxCreated = (boxId: number) => {
  selectBox(boxId, { shouldPan: true })
  setTimeout(() => {
    sqlBoxRefs.value.get(boxId)?.focusEditor()
  }, 300)
}

// Handle showing keyboard shortcuts modal
const handleShowShortcuts = () => {
  showShortcutsModal.value = true
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
  const engine = data.connectionType === 'bigquery' ? 'bigquery' : 'duckdb'
  const boxId = canvasStore.addBox('sql', position, engine, data.connectionId)
  canvasStore.updateBoxQuery(boxId, data.query)

  selectBox(boxId, { shouldPan: true })

  // Focus the editor after component loads
  setTimeout(() => {
    sqlBoxRefs.value.get(boxId)?.focusEditor()
  }, 300)
}

const handleQueryTableFromSchema = async (data: {
  tableName: string,
  boxName?: string,
  engine: 'bigquery',
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

    const connectionId = data.connectionId || connectionsStore.getConnectionsByType('bigquery')[0]?.id

    // Create box with appropriate engine and connection
    const boxId = canvasStore.addBox('sql', position, data.engine, connectionId)

    // Configure box
    canvasStore.updateBoxName(boxId, boxName)
    canvasStore.updateBoxQuery(boxId, query)

    // Select the newly created box and pan to it
    selectBox(boxId, { shouldPan: true })

  } catch (error) {
    console.error('Failed to create query box:', error)
    showToast(`Failed to query table: ${(error as Error).message}`)
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
    showToast(`Failed to show row details: ${(error as Error).message}`)
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
  sourceEngine?: DatabaseEngine
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
    showToast(`Failed to show column analytics: ${(error as Error).message}`)
  }
}

const handleShowExplain = (data: {
  planData: unknown
  engine: DatabaseEngine
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
}

// ============================================
// Dynamic box rendering helpers
// ============================================

const getBoxComponent = (type: Box['type']) => {
  return getBoxDefinition(type)?.component
}

const registerBoxRef = (box: Box, el: unknown) => {
  if (box.type === 'sql') {
    if (el) sqlBoxRefs.value.set(box.id, el as { focusEditor: () => void })
    else sqlBoxRefs.value.delete(box.id)
  } else if (box.type === 'schema') {
    if (el) schemaBoxRefs.value.set(box.id, el as { navigateToTable: (info: { connectionType: string; connectionId?: string; tableName: string; projectId?: string; datasetId?: string; databaseName?: string; schemaName?: string }) => Promise<void> })
    else schemaBoxRefs.value.delete(box.id)
  }
}

const getExtraProps = (box: Box) => {
  const props: Record<string, unknown> = {}
  const def = getBoxDefinition(box.type)
  if (def?.dataProp) {
    props[def.dataProp] = box.query
  }
  if (box.type === 'sql') {
    props.connectionId = box.connectionId
    props.initialEditorHeight = box.editorHeight
  }
  return props
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const getExtraEvents = (box: Box) => {
  const events: Record<string, (...args: any[]) => void> = {}
  switch (box.type) {
    case 'sql':
      events['update:query'] = (q: string) => handleUpdateQuery(box.id, q)
      events['update:editor-height'] = (h: number) => handleUpdateEditorHeight(box.id, h)
      events['update:multi-position'] = handleUpdateMultiPosition
      events['show-row-detail'] = handleShowRowDetail
      events['show-column-analytics'] = handleShowColumnAnalytics
      events['show-explain'] = (e: any) => handleShowExplain(e, box.id, box.name)
      events['navigate-to-table'] = handleNavigateToTable
      break
    case 'schema':
      events['update:multi-position'] = handleUpdateMultiPosition
      events['query-table'] = handleQueryTableFromSchema
      events['show-column-analytics'] = handleShowColumnAnalytics
      break
    case 'note':
      events['update:content'] = (c: string) => handleUpdateQuery(box.id, c)
      break
    case 'analytics':
      events['update:data'] = (d: string) => handleUpdateQuery(box.id, d)
      break
    case 'history':
      events['restore-query'] = handleRestoreQuery
      break
  }
  return events
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
    const connection = connectionsStore.activeConnection
    const boxId = canvasStore.addBox('sql', null, connection?.type || 'duckdb', connection?.id)
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

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown)

  // Set canvas ref in store so it can be used when adding boxes.
  if (canvasRef.value) {
    canvasStore.setCanvasRef(canvasRef.value)
  }

  // Fit as soon as the saved boxes render, without waiting for database startup.
  await Promise.all([
    canvasStore.loadState().then(async () => {
      await nextTick()
      canvasRef.value?.fitToView()
    }),
    connectionsStore.ready,
    settingsStore.ready,
    openAIStore.ready,
    duckdbStore.initialize(),
  ])

  // Clean up orphaned tables/views from previous sessions
  runGarbageCollect()

  // Initialize SQLGlot (Pyodide WASM) — non-blocking, runs in background
  sqlglotStore.initialize().catch(err => {
    console.warn('SQLGlot initialization failed:', err)
  })

  // Preload Google's script without requesting a token or opening a popup.
  bigqueryStore.restoreSession().catch(error => {
    console.warn('Google authorization could not be preloaded:', error)
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="page">
    <MenuBar
      @box-created="handleBoxCreated"
      @show-shortcuts="handleShowShortcuts"
      @start-tutorial="handleStartTutorial"
    />

    <!-- Keyboard Shortcuts Modal -->
    <KeyboardShortcutsModal
      :show="showShortcutsModal"
      @close="showShortcutsModal = false"
    />

    <InfiniteCanvas
      ref="canvasRef"
      :boxes="canvasStore.boxes"
      @canvas-click="deselectBox"
    >
      <!-- Dependency arrows (rendered behind boxes) -->
      <DependencyArrows :boxes="canvasStore.boxes" />

      <!-- Box creation buttons (floating near selected SQL box) -->
      <BoxCreationButtons
        :selected-box="selectedSqlBox"
        @create-box-below="(sb) => handleCreateQueryBox(sb, 'below')"
        @create-box-right="(sb) => handleCreateQueryBox(sb, 'right')"
      />

      <component
        :is="getBoxComponent(box.type)"
        v-for="box in sortedBoxes"
        :key="box.id"
        :ref="(el: any) => registerBoxRef(box, el)"
        :box-id="box.id"
        :initial-x="box.x"
        :initial-y="box.y"
        :initial-width="box.width"
        :initial-height="box.height"
        :initial-z-index="box.zIndex"
        :initial-name="box.name"
        :is-selected="canvasStore.boxSelectionMap.has(box.id)"
        v-bind="getExtraProps(box)"
        @select="selectBox(box.id, $event)"
        @update:position="handleUpdatePosition(box.id, $event)"
        @update:size="handleUpdateSize(box.id, $event)"
        @update:name="handleUpdateName(box.id, $event)"
        @delete="handleDelete(box.id)"
        @maximize="handleMaximize(box.id)"
        @drag-start="handleDragStart"
        @drag-end="handleDragEnd"
        v-on="getExtraEvents(box)"
      />
    </InfiniteCanvas>

    <DebugPanel
      v-if="isLocalhost && canvasRef"
      :zoom="canvasRef.zoom"
      :visible-box-count="sortedBoxes.length"
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
