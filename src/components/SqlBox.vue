<script setup>
import { ref, inject } from 'vue'
import ResizableBox from './ResizableBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

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
  initialQuery: { type: String, default: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50' }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete'])

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

const editorRef = ref(null)
const resultsRef = ref(null)

// Run query
const runQuery = async () => {
  if (!authStore.isAuthenticated) {
    error.value = 'Please upload service account credentials in the sidebar'
    return
  }

  isRunning.value = true
  error.value = null

  try {
    const query = editorRef.value.getQuery()
    const startTime = performance.now()
    const result = await authStore.runQuery(query)
    const endTime = performance.now()

    // Calculate execution time
    const executionTimeMs = endTime - startTime

    queryResults.value = result.rows
    queryStats.value = {
      ...result.stats,
      executionTimeMs: Math.round(executionTimeMs)
    }

    if (resultsRef.value) {
      resultsRef.value.resetPagination()
    }
  } catch (err) {
    error.value = err.message || 'Query execution failed'
    queryResults.value = null
    queryStats.value = null
  } finally {
    isRunning.value = false
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

  // Calculate viewport size in canvas coordinates (accounting for zoom)
  const zoom = canvasZoom.value
  const viewportWidth = window.innerWidth / zoom
  const viewportHeight = window.innerHeight / zoom

  // Use 80% of viewport to leave some margin
  const targetWidth = viewportWidth * 0.8
  const targetHeight = viewportHeight * 0.8

  // Get current box center in canvas coordinates
  const currentX = props.initialX
  const currentY = props.initialY
  const currentWidth = props.initialWidth
  const currentHeight = props.initialHeight
  const centerX = currentX + currentWidth / 2
  const centerY = currentY + currentHeight / 2

  // Position the maximized box centered on the current box's center
  const newX = centerX - targetWidth / 2
  const newY = centerY - targetHeight / 2

  emit('update:position', { x: newX, y: newY })
  emit('update:size', { width: targetWidth, height: targetHeight })
}

// Handle delete button
const handleDelete = (e) => {
  e.stopPropagation() // Prevent triggering header drag
  emit('delete')
}

// Add global mouse listeners for splitter
import { onMounted, onUnmounted } from 'vue'

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
      <span>SQL Query</span>
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
  height: var(--border-width);
  background: black;
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
}

/* Invisible larger hit area for easier dragging */
.splitter::before {
  content: '';
  position: absolute;
  top: -4px;
  bottom: -4px;
  left: 0;
  right: 0;
}

/* Header buttons */
.header-buttons {
  display: flex;
  gap: 4px;
}

.header-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--text-color);
  color: var(--text-color);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  transition: all 0.2s;
  outline: none;
}

.header-btn:focus {
  outline: none;
}

.header-btn:hover {
  background: var(--text-color);
  color: var(--bg-color);
}

.delete-btn:hover {
  background: #ff4444;
  border-color: #ff4444;
  color: white;
}
</style>
