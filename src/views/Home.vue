<script setup>
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import SqlBox from '../components/SqlBox.vue'
import Sidebar from '../components/Sidebar.vue'
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useCanvasStore } from '../stores/canvas'

const canvasStore = useCanvasStore()
const canvasRef = ref(null)
const copiedBoxId = ref(null)

const addSqlBox = () => {
  canvasStore.addBox()
}

const selectBox = (id) => {
  canvasStore.selectBox(id)
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

const handleKeyDown = (e) => {
  // Don't handle shortcuts if user is typing in an input/textarea or CodeMirror editor
  const activeElement = document.activeElement
  const isTyping = activeElement.tagName === 'INPUT' ||
                   activeElement.tagName === 'TEXTAREA' ||
                   activeElement.classList.contains('cm-content')

  // Delete/Backspace to remove selected box
  if ((e.key === 'Delete' || e.key === 'Backspace') && canvasStore.selectedBoxId !== null && !isTyping) {
    // Prevent backspace from navigating back in browser
    e.preventDefault()
    canvasStore.removeBox(canvasStore.selectedBoxId)
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
    <Sidebar />

    <div class="controls">
      <button @click="addSqlBox" class="add-button">+ Add SQL Box</button>
    </div>

    <InfiniteCanvas
      ref="canvasRef"
      :boxes="canvasStore.boxes"
      @canvas-click="deselectBox"
    >
      <SqlBox
        v-for="box in canvasStore.boxes"
        :key="box.id"
        :box-id="box.id"
        :initial-x="box.x"
        :initial-y="box.y"
        :initial-width="box.width"
        :initial-height="box.height"
        :initial-z-index="box.zIndex"
        :initial-query="box.query"
        :is-selected="canvasStore.selectedBoxId === box.id"
        @select="selectBox(box.id)"
        @update:position="handleUpdatePosition(box.id, $event)"
        @update:size="handleUpdateSize(box.id, $event)"
      />
    </InfiniteCanvas>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100vh;
}

.controls {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 1000;
  display: flex;
  gap: 20px;
  align-items: center;
}

.add-button {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--border-radius);
  padding: var(--spacing-sm) var(--spacing-xl);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: none;
}

.add-button:hover {
  box-shadow: var(--shadow-lg);
}

.add-button:active {
  transform: translate(2px, 2px);
  box-shadow: 4px 4px 0 0 rgba(0, 0, 0, 0.25);
}
</style>
