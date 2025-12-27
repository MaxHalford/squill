<script setup lang="ts">
import { ref, onMounted, onUnmounted, inject } from 'vue'

const MIN_WIDTH = 300
const MIN_HEIGHT = 400

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false }
})

// Inject canvas zoom to adjust mouse coordinates
const canvasZoom = inject('canvasZoom', ref(1))

const emit = defineEmits(['select', 'update:position', 'update:size'])

const boxRef = ref(null)
const headerRef = ref(null)

const position = ref({ x: props.initialX, y: props.initialY })
const size = ref({ width: props.initialWidth, height: props.initialHeight })
const zIndex = ref(props.initialZIndex)
const isDragging = ref(false)
const isResizing = ref(false)
const resizeDirection = ref(null)
const dragStart = ref({ x: 0, y: 0 })
const initialSize = ref({ width: 0, height: 0 })
const initialPosition = ref({ x: 0, y: 0 })

// Watch for changes from parent
import { watch } from 'vue'
watch(() => props.initialZIndex, (newZIndex) => {
  zIndex.value = newZIndex
})

watch(() => props.initialWidth, (newWidth) => {
  size.value.width = newWidth
})

watch(() => props.initialHeight, (newHeight) => {
  size.value.height = newHeight
})

watch(() => props.initialX, (newX) => {
  position.value.x = newX
})

watch(() => props.initialY, (newY) => {
  position.value.y = newY
})

// Handle selection
const handleBoxClick = () => {
  emit('select')
}

// Handle dragging
const handleHeaderMouseDown = (e) => {
  // Only start dragging if clicking on the header itself
  if (!headerRef.value || !headerRef.value.contains(e.target)) {
    return
  }
  e.stopPropagation()
  emit('select')
  isDragging.value = true
  const zoom = canvasZoom.value
  dragStart.value = {
    x: e.clientX - position.value.x * zoom,
    y: e.clientY - position.value.y * zoom
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
  const zoom = canvasZoom.value

  if (isDragging.value) {
    const newPosition = {
      x: (e.clientX - dragStart.value.x) / zoom,
      y: (e.clientY - dragStart.value.y) / zoom
    }
    position.value = newPosition
    emit('update:position', newPosition)
  } else if (isResizing.value) {
    const deltaX = (e.clientX - dragStart.value.x) / zoom
    const deltaY = (e.clientY - dragStart.value.y) / zoom
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
      height: `${size.height}px`,
      zIndex: zIndex
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

    <div class="box-content" @mousedown.stop>
      <slot></slot>
    </div>

    <!-- Resize handles - only show when selected -->
    <template v-if="isSelected">
      <!-- Edge handles -->
      <div class="resize-handle n" @mousedown="handleResizeStart($event, 'n')"></div>
      <div class="resize-handle e" @mousedown="handleResizeStart($event, 'e')"></div>
      <div class="resize-handle s" @mousedown="handleResizeStart($event, 's')"></div>
      <div class="resize-handle w" @mousedown="handleResizeStart($event, 'w')"></div>
      <!-- Corner handles -->
      <div class="resize-handle ne" @mousedown="handleResizeStart($event, 'ne')"></div>
      <div class="resize-handle se" @mousedown="handleResizeStart($event, 'se')"></div>
      <div class="resize-handle sw" @mousedown="handleResizeStart($event, 'sw')"></div>
      <div class="resize-handle nw" @mousedown="handleResizeStart($event, 'nw')"></div>
    </template>
  </div>
</template>

<style scoped>
.resizable-box {
  position: absolute;
  background: var(--surface-primary);
  border: var(--box-border-width) solid var(--box-border-color);
  border-radius: var(--box-border-radius);
  box-shadow: var(--box-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
  transition: none;
  isolation: isolate;
  z-index: 1;
}

.resizable-box.selected {
  box-shadow: var(--box-shadow-selected);
  z-index: 10;
  position: relative;
}

.resizable-box.selected::before {
  content: '';
  position: absolute;
  top: calc(var(--space-1) * -1);
  left: calc(var(--space-1) * -1);
  right: calc(var(--space-1) * -1);
  bottom: calc(var(--space-1) * -1);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--box-border-radius);
  pointer-events: none;
}

.resizable-box.dragging {
  z-index: 100;
}

.box-header {
  background: var(--box-header-bg);
  color: var(--box-header-text);
  padding: var(--box-header-padding);
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: none;
  flex-shrink: 0;
  font-size: var(--font-size-body);
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
    background: transparent;
    z-index: 10;
}

/* Edge handles */
.resize-handle.n,
.resize-handle.s {
  height: var(--handle-size);
  left: 0;
  right: 0;
  cursor: ns-resize;
}

.resize-handle.e,
.resize-handle.w {
  width: var(--handle-size);
  top: 0;
  bottom: 0;
  cursor: ew-resize;
}

/* Invisible larger hit area for easier resizing */
.resize-handle.n::before,
.resize-handle.s::before {
  content: '';
  position: absolute;
  top: calc(var(--handle-size) / -2);
  bottom: calc(var(--handle-size) / -2);
  left: 0;
  right: 0;
}

.resize-handle.e::before,
.resize-handle.w::before {
  content: '';
  position: absolute;
  left: calc(var(--handle-size) / -2);
  right: calc(var(--handle-size) / -2);
  top: 0;
  bottom: 0;
}

.resize-handle.n {
  top: calc(var(--handle-size) / -2);
}

.resize-handle.s {
  bottom: calc(var(--handle-size) / -2);
}

.resize-handle.e {
  right: calc(var(--handle-size) / -2);
}

.resize-handle.w {
  left: calc(var(--handle-size) / -2);
}

/* Corner handles */
.resize-handle.ne,
.resize-handle.se,
.resize-handle.sw,
.resize-handle.nw {
  width: var(--handle-size);
  height: var(--handle-size);
}

.resize-handle.ne {
  top: calc(var(--handle-size) / -2);
  right: calc(var(--handle-size) / -2);
  cursor: nesw-resize;
}

.resize-handle.se {
  bottom: calc(var(--handle-size) / -2);
  right: calc(var(--handle-size) / -2);
  cursor: nwse-resize;
}

.resize-handle.sw {
  bottom: calc(var(--handle-size) / -2);
  left: calc(var(--handle-size) / -2);
  cursor: nesw-resize;
}

.resize-handle.nw {
  top: calc(var(--handle-size) / -2);
  left: calc(var(--handle-size) / -2);
  cursor: nwse-resize;
}

.resize-handle:hover {
  background: transparent;
}
</style>
