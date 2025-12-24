<script setup>
import { ref } from 'vue'
import ResizableBox from './ResizableBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialQuery: { type: String, default: 'SELECT * FROM `project.dataset.table` LIMIT 10;' }
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
    const results = await authStore.runQuery(query)
    queryResults.value = results
    if (resultsRef.value) {
      resultsRef.value.resetPagination()
    }
  } catch (err) {
    error.value = err.message || 'Query execution failed'
    queryResults.value = null
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
    const deltaY = e.clientY - dragStart.value.y
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
      <div class="header-actions">
        <button
          @click.stop="runQuery"
          :disabled="isRunning || !authStore.isAuthenticated"
          class="run-button"
          :title="authStore.isAuthenticated ? 'Run query (Ctrl + Enter)' : 'Upload credentials in sidebar first'"
        >
          {{ isRunning ? '...' : '▶' }}
        </button>
        <div class="drag-indicator">⋮⋮</div>
      </div>
    </template>

    <QueryEditor
      ref="editorRef"
      v-model="queryText"
      :height="editorHeight"
      @run="runQuery"
    />

    <!-- Splitter -->
    <div
      class="splitter"
      @mousedown="handleSplitterMouseDown"
    >
      <div class="splitter-line"></div>
    </div>

    <ResultsTable
      ref="resultsRef"
      :results="queryResults"
      :error="error"
    />
  </ResizableBox>
</template>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-button {
  background: #42b883;
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
}

.run-button:hover:not(:disabled) {
  background: #35a372;
  transform: scale(1.05);
}

.run-button:disabled {
  background: #4a5568;
  cursor: not-allowed;
  opacity: 0.5;
}

.drag-indicator {
  color: #5c6370;
  font-size: 12px;
  letter-spacing: -2px;
}

/* Splitter */
.splitter {
  height: 8px;
  background: #21252b;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.splitter:hover {
  background: #2c313a;
}

.splitter-line {
  width: 40px;
  height: 2px;
  background: #5c6370;
  border-radius: 1px;
}
</style>
