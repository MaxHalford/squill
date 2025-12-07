<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps({
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 500 },
  initialHeight: { type: Number, default: 300 }
})

const boxRef = ref(null)
const editorRef = ref(null)
const headerRef = ref(null)

const position = ref({ x: props.initialX, y: props.initialY })
const size = ref({ width: props.initialWidth, height: props.initialHeight })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

let editorView = null

// Handle dragging
const handleHeaderMouseDown = (e) => {
  e.stopPropagation()
  isDragging.value = true
  dragStart.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y
  }
}

const handleMouseMove = (e) => {
  if (isDragging.value) {
    position.value = {
      x: e.clientX - dragStart.value.x,
      y: e.clientY - dragStart.value.y
    }
  }
}

const handleMouseUp = () => {
  isDragging.value = false
}

onMounted(() => {
  // Initialize CodeMirror
  editorView = new EditorView({
    extensions: [
      basicSetup,
      sql(),
      oneDark,
      EditorView.lineWrapping
    ],
    parent: editorRef.value,
    doc: 'SELECT * FROM users;'
  })

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  if (editorView) {
    editorView.destroy()
  }
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div
    ref="boxRef"
    class="sql-box"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${size.width}px`,
      height: `${size.height}px`
    }"
  >
    <div
      ref="headerRef"
      class="sql-box-header"
      @mousedown="handleHeaderMouseDown"
    >
      <span>SQL Query</span>
      <div class="drag-indicator">⋮⋮</div>
    </div>
    <div
      ref="editorRef"
      class="sql-editor"
    ></div>
  </div>
</template>

<style scoped>
.sql-box {
  position: absolute;
  background: #282c34;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sql-box-header {
  background: #21252b;
  padding: 12px 16px;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #181a1f;
}

.sql-box-header:active {
  cursor: grabbing;
}

.sql-box-header span {
  color: #abb2bf;
  font-weight: 500;
  font-size: 14px;
}

.drag-indicator {
  color: #5c6370;
  font-size: 12px;
  letter-spacing: -2px;
}

.sql-editor {
  flex: 1;
  overflow: auto;
}

.sql-editor :deep(.cm-editor) {
  height: 100%;
}

.sql-editor :deep(.cm-scroller) {
  overflow: auto;
}
</style>
