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

const emit = defineEmits(['select', 'update:position', 'update:size'])

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
</style>
