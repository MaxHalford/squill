<script setup>
import InfiniteCanvas from '../components/InfiniteCanvas.vue'
import SqlBox from '../components/SqlBox.vue'
import Sidebar from '../components/Sidebar.vue'
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useCanvasStore } from '../stores/canvas'

const canvasStore = useCanvasStore()
const canvasRef = ref(null)

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
  // Don't delete if user is typing in an input/textarea or CodeMirror editor
  const activeElement = document.activeElement
  const isTyping = activeElement.tagName === 'INPUT' ||
                   activeElement.tagName === 'TEXTAREA' ||
                   activeElement.classList.contains('cm-content')

  if ((e.key === 'Delete' || e.key === 'Backspace') && canvasStore.selectedBoxId !== null && !isTyping) {
    // Prevent backspace from navigating back in browser
    e.preventDefault()
    canvasStore.removeBox(canvasStore.selectedBoxId)
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
      <div class="instructions">
        <span>Drag to pan</span>
        <span>Scroll to zoom (Shift to override)</span>
        <span>Delete to remove</span>
        <span>Drag splitter to resize</span>
      </div>
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
  background: #42b883;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(66, 184, 131, 0.3);
  transition: all 0.2s;
}

.add-button:hover {
  background: #35a372;
  box-shadow: 0 4px 12px rgba(66, 184, 131, 0.4);
}

.add-button:active {
  transform: translateY(1px);
}

.instructions {
  display: flex;
  gap: 15px;
  background: rgba(255, 255, 255, 0.9);
  padding: 8px 16px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.instructions span {
  font-size: 12px;
  color: #666;
  font-family: monospace;
}
</style>
