<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, inject } from 'vue'

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw'

const MIN_WIDTH = 200
const MIN_HEIGHT = 150

const props = defineProps<{
  boxId: number
  initialX?: number
  initialY?: number
  initialWidth?: number
  initialHeight?: number
  initialZIndex?: number
  isSelected?: boolean
}>()

const canvasZoom = inject('canvasZoom', ref(1))

const emit = defineEmits<{
  'select': [payload: { shouldPan: boolean }]
  'update:position': [position: Position]
  'update:size': [size: Size]
  'drag-start': []
  'drag-end': []
}>()

const boxRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)

const position = ref<Position>({ x: props.initialX ?? 100, y: props.initialY ?? 100 })
const size = ref<Size>({ width: props.initialWidth ?? 600, height: props.initialHeight ?? 500 })
const zIndex = ref(props.initialZIndex ?? 1)

const isDragging = ref(false)
const isResizing = ref(false)
const resizeDirection = ref<ResizeDirection | null>(null)
const dragStart = ref<Position>({ x: 0, y: 0 })
const initialSize = ref<Size>({ width: 0, height: 0 })
const initialPosition = ref<Position>({ x: 0, y: 0 })

// Sync with prop changes
watch(() => props.initialZIndex, (v) => { if (v !== undefined) zIndex.value = v })
watch(() => props.initialWidth, (v) => { if (v !== undefined) size.value.width = v })
watch(() => props.initialHeight, (v) => { if (v !== undefined) size.value.height = v })
watch(() => props.initialX, (v) => { if (v !== undefined) position.value.x = v })
watch(() => props.initialY, (v) => { if (v !== undefined) position.value.y = v })

const handleContentClick = (e: MouseEvent) => {
  e.stopPropagation()
  emit('select', { shouldPan: true })
}

const handleHeaderMouseDown = (e: MouseEvent) => {
  if (!headerRef.value?.contains(e.target as Node)) return

  e.stopPropagation()
  emit('select', { shouldPan: false })
  isDragging.value = true
  emit('drag-start')

  const zoom = canvasZoom.value
  dragStart.value = {
    x: e.clientX - position.value.x * zoom,
    y: e.clientY - position.value.y * zoom
  }
}

const handleResizeStart = (e: MouseEvent, direction: ResizeDirection) => {
  e.stopPropagation()
  e.preventDefault()
  emit('select', { shouldPan: false })

  isResizing.value = true
  resizeDirection.value = direction
  emit('drag-start')
  dragStart.value = { x: e.clientX, y: e.clientY }
  initialSize.value = { ...size.value }
  initialPosition.value = { ...position.value }
}

const handleMouseMove = (e: MouseEvent) => {
  const zoom = canvasZoom.value

  if (isDragging.value) {
    const newPosition = {
      x: (e.clientX - dragStart.value.x) / zoom,
      y: (e.clientY - dragStart.value.y) / zoom
    }
    position.value = newPosition
    emit('update:position', newPosition)
    return
  }

  if (!isResizing.value || !resizeDirection.value) return

  const deltaX = (e.clientX - dragStart.value.x) / zoom
  const deltaY = (e.clientY - dragStart.value.y) / zoom
  const dir = resizeDirection.value

  let newWidth = initialSize.value.width
  let newHeight = initialSize.value.height
  let newX = initialPosition.value.x
  let newY = initialPosition.value.y

  // Horizontal resize
  if (dir.includes('e')) {
    newWidth = Math.max(MIN_WIDTH, initialSize.value.width + deltaX)
  } else if (dir.includes('w')) {
    const proposedWidth = initialSize.value.width - deltaX
    if (proposedWidth >= MIN_WIDTH) {
      newWidth = proposedWidth
      newX = initialPosition.value.x + deltaX
    }
  }

  // Vertical resize
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

const handleMouseUp = () => {
  if (isDragging.value || isResizing.value) {
    emit('drag-end')
  }
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
    :class="{ selected: isSelected, dragging: isDragging || isResizing }"
    :data-box-id="boxId"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${size.width}px`,
      height: `${size.height}px`,
      zIndex
    }"
  >
    <header ref="headerRef" class="box-header" @mousedown="handleHeaderMouseDown">
      <slot name="header" />
    </header>

    <div class="box-content" @click="handleContentClick">
      <slot />
    </div>

    <!-- Resize handles (only when selected) -->
    <template v-if="isSelected">
      <div class="resize-handle n" @mousedown="handleResizeStart($event, 'n')" />
      <div class="resize-handle e" @mousedown="handleResizeStart($event, 'e')" />
      <div class="resize-handle s" @mousedown="handleResizeStart($event, 's')" />
      <div class="resize-handle w" @mousedown="handleResizeStart($event, 'w')" />
      <div class="resize-handle ne" @mousedown="handleResizeStart($event, 'ne')" />
      <div class="resize-handle se" @mousedown="handleResizeStart($event, 'se')" />
      <div class="resize-handle sw" @mousedown="handleResizeStart($event, 'sw')" />
      <div class="resize-handle nw" @mousedown="handleResizeStart($event, 'nw')" />
    </template>
  </div>
</template>

<style scoped>
.resizable-box {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--surface-primary);
  border: var(--box-border-width) solid var(--box-border-color);
  border-radius: var(--box-border-radius);
  box-shadow: var(--box-shadow);
  isolation: isolate;
  /* Improve rendering performance and crisp edges */
  contain: style;
  will-change: left, top, width, height;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform: translateZ(0);
  /* Entry animation */
  animation: box-enter 0.12s ease-out;
  /* Smooth arrow key movement */
  transition: left 0.12s ease-out, top 0.12s ease-out;
}

@keyframes box-enter {
  from {
    opacity: 0;
    transform: scale(0.95) translateZ(0);
  }
  to {
    opacity: 1;
    transform: scale(1) translateZ(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .resizable-box {
    animation: none;
    transition: none;
  }
  .resizable-box.deleting {
    animation: none;
    opacity: 0;
  }
}

.resizable-box.deleting {
  animation: box-leave 0.12s ease-in forwards;
  pointer-events: none;
}

@keyframes box-leave {
  from {
    opacity: 1;
    transform: scale(1) translateZ(0);
  }
  to {
    opacity: 0;
    transform: scale(0.95) translateZ(0);
  }
}

.resizable-box.selected {
  z-index: 10;
  border-color: var(--color-accent);
}

.resizable-box.dragging {
  z-index: 100;
  /* Simplified shadow during drag for smooth movement */
  box-shadow: var(--shadow-sm) !important;
  outline: none !important;
  transition: none !important;
}

.box-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--box-header-padding);
  background: var(--box-header-bg);
  color: var(--box-header-text);
  font-size: var(--font-size-body);
  cursor: grab;
  user-select: none;
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
  cursor: auto;
  /* Clip content while allowing resize handles to extend outside box */
  contain: layout;
}

/* Resize Handles */
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
}

.resize-handle.e,
.resize-handle.w {
  width: var(--handle-size);
  top: 0;
  bottom: 0;
}

.resize-handle.n { top: calc(var(--handle-size) / -2); cursor: ns-resize; }
.resize-handle.s { bottom: calc(var(--handle-size) / -2); cursor: ns-resize; }
.resize-handle.e { right: calc(var(--handle-size) / -2); cursor: ew-resize; }
.resize-handle.w { left: calc(var(--handle-size) / -2); cursor: ew-resize; }

/* Larger hit area for edge handles */
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

/* Corner handles */
.resize-handle.ne,
.resize-handle.se,
.resize-handle.sw,
.resize-handle.nw {
  width: var(--handle-size);
  height: var(--handle-size);
}

.resize-handle.ne { top: calc(var(--handle-size) / -2); right: calc(var(--handle-size) / -2); cursor: nesw-resize; }
.resize-handle.se { bottom: calc(var(--handle-size) / -2); right: calc(var(--handle-size) / -2); cursor: nwse-resize; }
.resize-handle.sw { bottom: calc(var(--handle-size) / -2); left: calc(var(--handle-size) / -2); cursor: nesw-resize; }
.resize-handle.nw { top: calc(var(--handle-size) / -2); left: calc(var(--handle-size) / -2); cursor: nwse-resize; }
</style>
