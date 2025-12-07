<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const MIN_WIDTH = 300
const MIN_HEIGHT = 400

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  isSelected: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'update:position', 'update:size'])

const boxRef = ref(null)
const headerRef = ref(null)

const position = ref({ x: props.initialX, y: props.initialY })
const size = ref({ width: props.initialWidth, height: props.initialHeight })
const isDragging = ref(false)
const isResizing = ref(false)
const resizeDirection = ref(null)
const dragStart = ref({ x: 0, y: 0 })
const initialSize = ref({ width: 0, height: 0 })
const initialPosition = ref({ x: 0, y: 0 })

// Handle selection
const handleBoxClick = () => {
  emit('select')
}

// Handle dragging
const handleHeaderMouseDown = (e) => {
  e.stopPropagation()
  emit('select')
  isDragging.value = true
  dragStart.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y
  }
}

// Handle resizing
const handleResizeStart = (e, direction) => {
  e.stopPropagation()
  e.preventDefault()
  emit('select')
  isResizing.value = true
  resizeDirection.value = direction
  dragStart.value = { x: e.clientX, y: e.clientY }
  initialSize.value = { ...size.value }
  initialPosition.value = { ...position.value }
}

const handleMouseMove = (e) => {
  if (isDragging.value) {
    const newPosition = {
      x: e.clientX - dragStart.value.x,
      y: e.clientY - dragStart.value.y
    }
    position.value = newPosition
    emit('update:position', newPosition)
  } else if (isResizing.value) {
    const deltaX = e.clientX - dragStart.value.x
    const deltaY = e.clientY - dragStart.value.y
    const dir = resizeDirection.value

    let newWidth = initialSize.value.width
    let newHeight = initialSize.value.height
    let newX = initialPosition.value.x
    let newY = initialPosition.value.y

    // Handle horizontal resizing
    if (dir.includes('e')) {
      newWidth = Math.max(MIN_WIDTH, initialSize.value.width + deltaX)
    } else if (dir.includes('w')) {
      const proposedWidth = initialSize.value.width - deltaX
      if (proposedWidth >= MIN_WIDTH) {
        newWidth = proposedWidth
        newX = initialPosition.value.x + deltaX
      }
    }

    // Handle vertical resizing
    if (dir.includes('s')) {
      newHeight = Math.max(MIN_HEIGHT, initialSize.value.height + deltaY)
    } else if (dir.includes('n')) {
      const proposedHeight = initialSize.value.height - deltaY
      if (proposedHeight >= MIN_HEIGHT) {
        newHeight = proposedHeight
        newY = initialPosition.value.y + deltaY
      }
    }

    size.value = { width: newWidth, height: newHeight }
    position.value = { x: newX, y: newY }
    emit('update:size', { width: newWidth, height: newHeight })
    emit('update:position', { x: newX, y: newY })
  }
}

const handleMouseUp = () => {
  isDragging.value = false
  isResizing.value = false
  resizeDirection.value = null
}

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
  <div
    ref="boxRef"
    class="resizable-box"
    :class="{
      'selected': isSelected,
      'dragging': isDragging || isResizing
    }"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${size.width}px`,
      height: `${size.height}px`
    }"
    @click="handleBoxClick"
  >
    <div
      ref="headerRef"
      class="box-header"
      @mousedown="handleHeaderMouseDown"
    >
      <slot name="header"></slot>
    </div>

    <div class="box-content">
      <slot></slot>
    </div>

    <!-- Resize handles - only show when selected -->
    <template v-if="isSelected">
      <!-- Corner handles -->
      <div class="resize-handle nw" @mousedown="handleResizeStart($event, 'nw')"></div>
      <div class="resize-handle ne" @mousedown="handleResizeStart($event, 'ne')"></div>
      <div class="resize-handle sw" @mousedown="handleResizeStart($event, 'sw')"></div>
      <div class="resize-handle se" @mousedown="handleResizeStart($event, 'se')"></div>

      <!-- Edge handles -->
      <div class="resize-handle n" @mousedown="handleResizeStart($event, 'n')"></div>
      <div class="resize-handle e" @mousedown="handleResizeStart($event, 'e')"></div>
      <div class="resize-handle s" @mousedown="handleResizeStart($event, 's')"></div>
      <div class="resize-handle w" @mousedown="handleResizeStart($event, 'w')"></div>
    </template>
  </div>
</template>

<style scoped>
.resizable-box {
  position: absolute;
  background: #282c34;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  isolation: isolate;
  z-index: 1;
}

.resizable-box.selected {
  border-color: #42b883;
  box-shadow: 0 4px 16px rgba(66, 184, 131, 0.4);
  z-index: 10;
}

.resizable-box.dragging {
  z-index: 100;
}

.box-header {
  background: #21252b;
  padding: 12px 16px;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #181a1f;
  flex-shrink: 0;
}

.box-header:active {
  cursor: grabbing;
}

.box-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Resize handles */
.resize-handle {
  position: absolute;
  background: #42b883;
  z-index: 10;
}

/* Corner handles */
.resize-handle.nw,
.resize-handle.ne,
.resize-handle.sw,
.resize-handle.se {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.resize-handle.nw {
  top: -4px;
  left: -4px;
  cursor: nw-resize;
}

.resize-handle.ne {
  top: -4px;
  right: -4px;
  cursor: ne-resize;
}

.resize-handle.sw {
  bottom: -4px;
  left: -4px;
  cursor: sw-resize;
}

.resize-handle.se {
  bottom: -4px;
  right: -4px;
  cursor: se-resize;
}

/* Edge handles */
.resize-handle.n,
.resize-handle.s {
  height: 4px;
  left: 8px;
  right: 8px;
  cursor: ns-resize;
}

.resize-handle.e,
.resize-handle.w {
  width: 4px;
  top: 8px;
  bottom: 8px;
  cursor: ew-resize;
}

.resize-handle.n {
  top: -2px;
}

.resize-handle.s {
  bottom: -2px;
}

.resize-handle.e {
  right: -2px;
}

.resize-handle.w {
  left: -2px;
}

.resize-handle:hover {
  background: #35a372;
}
</style>
