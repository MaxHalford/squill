<script setup lang="ts">
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import SqlBox from '../components/SqlBox.vue'
import SchemaBox from '../components/SchemaBox.vue'
import StickyNoteBox from '../components/StickyNoteBox.vue'
import RowDetailBox from '../components/RowDetailBox.vue'
import MenuBar from '../components/MenuBar.vue'
import DependencyArrows from '../components/DependencyArrows.vue'
import OnboardingModal from '../components/OnboardingModal.vue'
import UploadProgress from '../components/UploadProgress.vue'
import { ref, onMounted, onUnmounted, nextTick, provide, computed } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'
import { useConnectionsStore } from '../stores/connections'
import { useAuthStore } from '../stores/auth'
import { generateSelectQuery, generateQueryBoxName } from '../utils/queryGenerator'

const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const connectionsStore = useConnectionsStore()
const authStore = useAuthStore()
const canvasRef = ref(null)
const copiedBoxId = ref(null)
const copiedBoxIds = ref<number[]>([])
const csvFileInputRef = ref<HTMLInputElement | null>(null)
const isStoresReady = ref(false)
const onboardingDismissed = ref(false)

// CSV upload progress state
const uploadingFiles = ref<string[]>([])
const uploadCurrentIndex = ref(0)

// Registry for box query executors
const boxExecutors = ref(new Map())

// Register a box's run method
const registerBoxExecutor = (boxId, runFn) => {
  boxExecutors.value.set(boxId, runFn)
}

// Unregister a box's run method
const unregisterBoxExecutor = (boxId) => {
  boxExecutors.value.delete(boxId)
}

// Execute a query for a specific box
const executeBoxQuery = async (boxId) => {
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

// Handle BigQuery selection from onboarding
const handleSelectBigquery = async () => {
  try {
    await authStore.signInWithGoogle()
    // Modal will auto-close when connection is added
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
  } catch (error) {
    console.error('DuckDB initialization failed:', error)
    alert('Failed to initialize DuckDB. Please try again.')
  }
}

// Handle CSV selection from onboarding - open file picker
const handleSelectCsv = () => {
  csvFileInputRef.value?.click()
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

const selectBox = (id, eventData) => {
  canvasStore.selectBox(id)
  // Smoothly pan viewport to the selected box (if enabled in settings and event allows it)
  if (settingsStore.panToBoxOnSelect && eventData?.shouldPan && canvasRef.value) {
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

const handleUpdatePosition = (id, position) => {
  canvasStore.updateBoxPosition(id, position)
}

const handleUpdateSize = (id, size) => {
  canvasStore.updateBoxSize(id, size)
}

const handleUpdateMultiPosition = (data) => {
  canvasStore.updateBoxPosition(data.id, { x: data.x, y: data.y })
}

const handleDelete = (id) => {
  const previousBoxId = canvasStore.removeBox(id)
  // If there was a previous box, select it and pan to it
  if (previousBoxId !== null) {
    selectBox(previousBoxId, { shouldPan: true })
  }
}

const handleMaximize = (id) => {
  // Get the viewport center in canvas coordinates
  const center = canvasRef.value?.getViewportCenter()
  if (!center) return

  // Calculate viewport size in canvas coordinates
  const zoom = canvasRef.value?.zoom || 1
  const viewportWidth = window.innerWidth / zoom
  const viewportHeight = window.innerHeight / zoom

  // Use 80% of viewport for the box size
  const targetWidth = viewportWidth * 0.8
  const targetHeight = viewportHeight * 0.8

  // Position box centered horizontally, with 10% margin at top (and 10% at bottom)
  const newX = center.x - targetWidth / 2
  const newY = center.y - viewportHeight * 0.4

  canvasStore.updateBoxPosition(id, { x: newX, y: newY })
  canvasStore.updateBoxSize(id, { width: targetWidth, height: targetHeight })
}

const handleUpdateName = (id, name) => {
  canvasStore.updateBoxName(id, name)
}

const handleUpdateQuery = (id, query) => {
  canvasStore.updateBoxQuery(id, query)
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

      // Create SqlBox with correct query and name (CSV always uses DuckDB)
      // DuckDB is local so no project context needed
      const duckdbConnectionId = 'duckdb-local'
      const boxId = canvasStore.addBox('sql', currentPosition, 'duckdb', duckdbConnectionId, undefined)
      const displayName = file.name.replace('.csv', '') + '_query'
      canvasStore.updateBoxName(boxId, displayName)
      canvasStore.updateBoxQuery(boxId, `SELECT *\nFROM ${tableName}\nLIMIT 100`)

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
  engine: 'bigquery' | 'duckdb'
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

    // Generate query and box name
    const query = generateSelectQuery(data.tableName, data.engine)
    const boxName = generateQueryBoxName(data.tableName)

    // Get connection ID and project ID based on engine
    const connectionId = data.engine === 'duckdb'
      ? 'duckdb-local'
      : connectionsStore.getConnectionsByType('bigquery')[0]?.id

    // For BigQuery, include the active project; DuckDB doesn't need project
    const projectId = data.engine === 'duckdb'
      ? undefined
      : canvasStore.activeProjectId || undefined

    // Create box with appropriate engine, connection, and project
    const boxId = canvasStore.addBox('sql', position, data.engine, connectionId, projectId)

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
    alert(`Failed to query table: ${error.message}`)
  }
}

const handleShowRowDetail = (data: {
  rowData: Record<string, any>,
  rowIndex: number,
  globalRowIndex: number
}) => {
  try {
    // Find SQL box to position detail box nearby
    const sqlBox = canvasStore.boxes.find(box => box.type === 'sql')

    let position = null
    if (sqlBox) {
      position = {
        x: sqlBox.x + sqlBox.width + 30,
        y: sqlBox.y
      }
    } else {
      position = canvasRef.value?.getViewportCenter() || { x: 400, y: 300 }
    }

    // Create detail box
    const boxId = canvasStore.addBox('detail', position)

    // Set name and data
    const boxName = `Row ${data.globalRowIndex + 1} Detail`
    canvasStore.updateBoxName(boxId, boxName)
    canvasStore.updateBoxQuery(boxId, JSON.stringify(data.rowData))

    // Select and pan to box
    selectBox(boxId, { shouldPan: true })

  } catch (error) {
    console.error('Failed to create detail box:', error)
    alert(`Failed to show row details: ${error.message}`)
  }
}

const handleKeyDown = (e) => {
  // Don't handle shortcuts if user is typing in an input/textarea or CodeMirror editor
  const activeElement = document.activeElement
  const isTyping = activeElement.tagName === 'INPUT' ||
                   activeElement.tagName === 'TEXTAREA' ||
                   activeElement.classList.contains('cm-content')

  // Delete/Backspace to remove selected box(es)
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
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

  // Ctrl+A / Cmd+A to select all boxes
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isTyping) {
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isTyping) {
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isTyping) {
    // Check if there are multiple boxes to paste
    if (copiedBoxIds.value.length > 0) {
      e.preventDefault()
      const newBoxIds = canvasStore.copyMultipleBoxes(copiedBoxIds.value)
      console.log('Boxes pasted:', newBoxIds)
      if (newBoxIds.length > 0) {
        canvasStore.selectMultipleBoxes(newBoxIds)
      }
    }
    // Or single box to paste
    else if (copiedBoxId.value !== null) {
      e.preventDefault()
      const newBoxId = canvasStore.copyBox(copiedBoxId.value)
      console.log('Box pasted:', newBoxId)
      if (newBoxId) {
        canvasStore.selectBox(newBoxId)
      }
    }
  }

  // Ctrl+Z / Cmd+Z to undo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    if (!isTyping) {
      e.preventDefault()
      console.log('Undo triggered')
      canvasStore.undo()
    } else {
      console.log('Undo blocked - typing detected')
    }
  }

  // Ctrl+Shift+Z / Cmd+Shift+Z to redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
    if (!isTyping) {
      e.preventDefault()
      console.log('Redo triggered')
      canvasStore.redo()
    } else {
      console.log('Redo blocked - typing detected')
    }
  }
}

onMounted(async () => {
  // Load saved canvas state
  canvasStore.loadState()

  // Ensure connections store is loaded
  connectionsStore.loadState()

  // Mark stores as ready (prevents flash)
  await nextTick()
  isStoresReady.value = true

  window.addEventListener('keydown', handleKeyDown)

  // Set canvas ref in store so it can be used when adding boxes
  if (canvasRef.value) {
    canvasStore.setCanvasRef(canvasRef.value)
  }

  // Wait for boxes to render, then fit to view
  await nextTick()
  if (canvasRef.value) {
    canvasRef.value.fitToView()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="page">
    <MenuBar />

    <!-- Onboarding Modal -->
    <OnboardingModal
      :show="showOnboarding"
      @close="handleCloseOnboarding"
      @select-bigquery="handleSelectBigquery"
      @select-duckdb="handleSelectDuckdb"
      @select-csv="handleSelectCsv"
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

      <template v-for="box in canvasStore.boxes" :key="box.id">
        <!-- SQL Editor Box -->
        <SqlBox
          v-if="box.type === 'sql'"
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
        />

        <!-- Schema Browser Box -->
        <SchemaBox
          v-else-if="box.type === 'schema'"
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
      </template>
    </InfiniteCanvas>

    <UploadProgress
      :files="uploadingFiles"
      :current-index="uploadCurrentIndex"
    />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100vh;
  padding-top: 32px; /* Height of macOS-style menu bar */
}
</style>
