<script setup lang="ts">
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import SqlBox from '../components/SqlBox.vue'
import SchemaBox from '../components/SchemaBox.vue'
import StickyNoteBox from '../components/StickyNoteBox.vue'
import MenuBar from '../components/MenuBar.vue'
import DependencyArrows from '../components/DependencyArrows.vue'
import { ref, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'

const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()
const canvasRef = ref(null)
const copiedBoxId = ref(null)

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

const selectBox = (id, eventData) => {
  canvasStore.selectBox(id)
  // Smoothly pan viewport to the selected box (if enabled in settings and event allows it)
  if (settingsStore.panToBoxOnSelect && eventData?.shouldPan && canvasRef.value) {
    canvasRef.value.panToBox(id)
  }
}

const deselectBox = () => {
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
  canvasStore.removeBox(id)
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
      canvasStore.removeBox(canvasStore.selectedBoxId)
    }
  }

  // Ctrl+C / Cmd+C to copy selected box
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && canvasStore.selectedBoxId !== null && !isTyping) {
    e.preventDefault()
    copiedBoxId.value = canvasStore.selectedBoxId
    console.log('Box copied:', copiedBoxId.value)
  }

  // Ctrl+V / Cmd+V to paste copied box
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && copiedBoxId.value !== null && !isTyping) {
    e.preventDefault()
    const newBoxId = canvasStore.copyBox(copiedBoxId.value)
    console.log('Box pasted:', newBoxId)
    if (newBoxId) {
      canvasStore.selectBox(newBoxId)
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

    <InfiniteCanvas
      ref="canvasRef"
      :boxes="canvasStore.boxes"
      @canvas-click="deselectBox"
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
          :is-selected="canvasStore.isBoxSelected(box.id)"
          @select="selectBox(box.id, $event)"
          @update:position="handleUpdatePosition(box.id, $event)"
          @update:size="handleUpdateSize(box.id, $event)"
          @update:name="handleUpdateName(box.id, $event)"
          @update:query="handleUpdateQuery(box.id, $event)"
          @update:multi-position="handleUpdateMultiPosition"
          @delete="handleDelete(box.id)"
          @maximize="handleMaximize(box.id)"
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
      </template>
    </InfiniteCanvas>
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
