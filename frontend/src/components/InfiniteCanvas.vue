<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import type { Box } from '../types/canvas'
import { useCanvasStore } from '../stores/canvas'

interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Point {
  x: number
  y: number
}

const emit = defineEmits<{
  'canvas-click': []
  'csv-drop': [payload: { csvFiles: File[]; nonCsvFiles: File[]; position: Point }]
}>()

const canvasStore = useCanvasStore()

const props = defineProps<{
  boxes: Box[]
}>()

const canvasRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)

// Canvas state
const pan = ref<Point>({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const isActuallyPanning = ref(false)
const panStart = ref<Point>({ x: 0, y: 0 })

// Rectangle selection state
const isRectangleSelecting = ref(false)
const rectangleStart = ref<Point>({ x: 0, y: 0 })
const rectangleCurrent = ref<Point>({ x: 0, y: 0 })

// Space key panning state
const isSpaceHeld = ref(false)

// CSV drag state
const isDraggingFile = ref(false)
const dragCounter = ref(0)

// Hybrid zoom: use pure transform during active zooming (fast), CSS zoom when idle (crisp)
const isActivelyZooming = ref(false)
let zoomIdleTimer: ReturnType<typeof setTimeout> | null = null
const ZOOM_IDLE_DELAY = 150 // ms to wait before switching to crisp mode

// Computed style for viewport - hybrid zoom/scale approach
// Fast mode: pure transform (GPU-accelerated, no layout recalc)
// Crisp mode: CSS zoom (triggers layout but gives sharp text)
const viewportStyle = computed(() => {
  if (isActivelyZooming.value) {
    // Fast mode: use only transform, no CSS zoom
    // transform: translate(pan) scale(zoom) - applied right-to-left
    // Result: point at (cx, cy) appears at (cx * zoom + pan.x, cy * zoom + pan.y)
    return {
      transform: `translate3d(${pan.value.x}px, ${pan.value.y}px, 0) scale(${zoom.value})`
    }
  } else {
    // Crisp mode: use CSS zoom for sharp text
    // CSS zoom scales everything including the transform
    // So we divide pan by zoom to compensate
    return {
      zoom: zoom.value,
      transform: `translate3d(${pan.value.x / zoom.value}px, ${pan.value.y / zoom.value}px, 0)`
    }
  }
})

provide('canvasZoom', zoom)

const PADDING = 100

const calculateBoundingBox = (boxes: Box[]): BoundingBox => {
  if (!boxes?.length) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600 }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }

  return { minX, minY, maxX, maxY }
}

const fitToView = () => {
  if (!canvasRef.value || !props.boxes?.length) return

  const rect = canvasRef.value.getBoundingClientRect()
  const { minX, minY, maxX, maxY } = calculateBoundingBox(props.boxes)

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  const zoomX = (rect.width - PADDING * 2) / contentWidth
  const zoomY = (rect.height - PADDING * 2) / contentHeight
  const targetZoom = Math.min(Math.max(Math.min(zoomX, zoomY, 1), 0.1), 5)

  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  const targetPan = {
    x: rect.width / 2 - contentCenterX * targetZoom,
    y: rect.height / 2 - contentCenterY * targetZoom
  }

  // Cancel any existing animation
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)

  // Clear any pending crisp commit
  if (zoomIdleTimer) {
    clearTimeout(zoomIdleTimer)
    zoomIdleTimer = null
  }

  // Use pure transform during animation for smooth performance
  isActivelyZooming.value = true

  const startPan = { ...pan.value }
  const startZoom = zoom.value
  const startTime = performance.now()
  const duration = 400

  const animate = (currentTime: number) => {
    const progress = Math.min((currentTime - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)

    pan.value = {
      x: startPan.x + (targetPan.x - startPan.x) * eased,
      y: startPan.y + (targetPan.y - startPan.y) * eased
    }
    zoom.value = startZoom + (targetZoom - startZoom) * eased

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate)
    } else {
      animationFrameId = null
      // Animation complete - switch to crisp mode
      isActivelyZooming.value = false
    }
  }

  animationFrameId = requestAnimationFrame(animate)
}

const getViewportCenter = (): Point => {
  if (!canvasRef.value) return { x: 400, y: 300 }

  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (rect.width / 2 - pan.value.x) / zoom.value,
    y: (rect.height / 2 - pan.value.y) / zoom.value
  }
}

let animationFrameId: number | null = null

const panToBox = (boxId: number) => {
  const box = props.boxes.find(b => b.id === boxId)
  if (!box || !canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  const targetPan = {
    x: rect.width / 2 - (box.x + box.width / 2) * zoom.value,
    y: rect.height / 2 - (box.y + box.height / 2) * zoom.value
  }

  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)

  const startPan = { ...pan.value }
  const startTime = performance.now()
  const duration = 400

  const animate = (currentTime: number) => {
    const progress = Math.min((currentTime - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)

    pan.value = {
      x: startPan.x + (targetPan.x - startPan.x) * eased,
      y: startPan.y + (targetPan.y - startPan.y) * eased
    }

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate)
    } else {
      animationFrameId = null
    }
  }

  animationFrameId = requestAnimationFrame(animate)
}

const screenToCanvas = (screenX: number, screenY: number): Point => {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (screenX - rect.left - pan.value.x) / zoom.value,
    y: (screenY - rect.top - pan.value.y) / zoom.value
  }
}

defineExpose({ fitToView, getViewportCenter, panToBox, screenToCanvas })

const isOverBox = (element: HTMLElement | null): boolean => {
  let current = element
  while (current && current !== canvasRef.value) {
    if (current.classList?.contains('resizable-box')) return true
    if (current.classList?.contains('box-creation-buttons')) return true
    current = current.parentElement
  }
  return false
}

const isOverScrollableArea = (element: HTMLElement | null): boolean => {
  const scrollableClasses = ['table-container', 'sql-editor', 'query-editor', 'datasets-list', 'schema-browser', 'detail-content', 'search-results', 'history-list', 'preview-panel']
  let current = element
  while (current && current !== canvasRef.value) {
    if (scrollableClasses.some(cls => current!.classList?.contains(cls))) return true
    current = current.parentElement
  }
  return false
}

const boxIntersectsRectangle = (box: Box, startX: number, startY: number, endX: number, endY: number): boolean => {
  const rectLeft = Math.min(startX, endX)
  const rectRight = Math.max(startX, endX)
  const rectTop = Math.min(startY, endY)
  const rectBottom = Math.max(startY, endY)

  return !(box.x + box.width < rectLeft || box.x > rectRight || box.y + box.height < rectTop || box.y > rectBottom)
}

const handleWheel = (e: WheelEvent) => {
  if (isOverScrollableArea(e.target as HTMLElement) && !(e.ctrlKey || e.metaKey)) return

  e.preventDefault()
  if (!canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  const mouseXInCanvas = (mouseX - pan.value.x) / zoom.value
  const mouseYInCanvas = (mouseY - pan.value.y) / zoom.value

  const newZoom = Math.min(Math.max(zoom.value * (1 - e.deltaY * 0.001), 0.1), 5)

  // Enter fast zoom mode (pure transform, no CSS zoom)
  isActivelyZooming.value = true

  // Clear any pending crisp commit
  if (zoomIdleTimer) {
    clearTimeout(zoomIdleTimer)
  }

  // Schedule switch to crisp mode after zooming stops
  zoomIdleTimer = setTimeout(() => {
    isActivelyZooming.value = false
  }, ZOOM_IDLE_DELAY)

  pan.value = {
    x: mouseX - mouseXInCanvas * newZoom,
    y: mouseY - mouseYInCanvas * newZoom
  }
  zoom.value = newZoom
}

const handleMouseDown = (e: MouseEvent) => {
  if (e.button !== 0 || !canvasRef.value) return

  const target = e.target as HTMLElement

  // Space + drag panning (works anywhere, even over boxes)
  if (isSpaceHeld.value) {
    e.preventDefault()
    e.stopPropagation()
    isPanning.value = true
    isActuallyPanning.value = false
    panStart.value = {
      x: e.clientX - pan.value.x,
      y: e.clientY - pan.value.y
    }
    canvasRef.value.style.cursor = 'grabbing'
    return
  }

  // Rectangle selection with Cmd/Ctrl
  if ((e.ctrlKey || e.metaKey) && !isOverBox(target)) {
    e.preventDefault()
    isRectangleSelecting.value = true
    rectangleStart.value = screenToCanvas(e.clientX, e.clientY)
    rectangleCurrent.value = { ...rectangleStart.value }
    canvasRef.value.style.cursor = 'crosshair'
    return
  }

  if (isOverBox(target)) return

  e.preventDefault()
  isPanning.value = true
  isActuallyPanning.value = false
  panStart.value = {
    x: e.clientX - pan.value.x,
    y: e.clientY - pan.value.y
  }
  canvasRef.value.style.cursor = 'grabbing'
}

const handleMouseMove = (e: MouseEvent) => {
  if (isRectangleSelecting.value) {
    rectangleCurrent.value = screenToCanvas(e.clientX, e.clientY)
    canvasStore.setRectangleSelection({
      startX: rectangleStart.value.x,
      startY: rectangleStart.value.y,
      endX: rectangleCurrent.value.x,
      endY: rectangleCurrent.value.y
    })
    return
  }

  if (isPanning.value) {
    isActuallyPanning.value = true
    pan.value = {
      x: e.clientX - panStart.value.x,
      y: e.clientY - panStart.value.y
    }
  }
}

const handleMouseUp = () => {
  if (!canvasRef.value) return

  if (isRectangleSelecting.value) {
    const selectedIds = props.boxes
      .filter(box => boxIntersectsRectangle(box, rectangleStart.value.x, rectangleStart.value.y, rectangleCurrent.value.x, rectangleCurrent.value.y))
      .map(box => box.id)

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    if (selectedIds.length > 0) {
      canvasStore.selectMultipleBoxes(selectedIds)
    } else {
      canvasStore.clearSelection()
    }

    canvasStore.setRectangleSelection(null)
    isRectangleSelecting.value = false
    canvasRef.value.style.cursor = isSpaceHeld.value ? 'grab' : 'grab'
    return
  }

  if (isPanning.value) {
    if (!isActuallyPanning.value && !isSpaceHeld.value) emit('canvas-click')
    isPanning.value = false
    isActuallyPanning.value = false
    canvasRef.value.style.cursor = isSpaceHeld.value ? 'grab' : 'grab'
  }
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.code === 'Space' && !isSpaceHeld.value) {
    // Don't activate space-pan if focus is in an input/textarea
    const activeEl = document.activeElement
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
      return
    }
    e.preventDefault()
    isSpaceHeld.value = true
    if (canvasRef.value && !isPanning.value) {
      canvasRef.value.style.cursor = 'grab'
    }
  }
}

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    isSpaceHeld.value = false
    if (canvasRef.value && !isPanning.value) {
      canvasRef.value.style.cursor = 'grab'
    }
  }
}

const handleWindowBlur = () => {
  // Reset space state when window loses focus to prevent stuck state
  isSpaceHeld.value = false
}

// File drag and drop
const handleDragEnter = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    dragCounter.value++
    isDraggingFile.value = true
  }
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  if (--dragCounter.value === 0) isDraggingFile.value = false
}

const handleDragOver = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  isDraggingFile.value = false
  dragCounter.value = 0

  const files = e.dataTransfer?.files
  if (!files?.length) return

  const allFiles = Array.from(files)
  const csvFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv')
  const nonCsvFiles = allFiles.filter(f => !f.name.toLowerCase().endsWith('.csv') && f.type !== 'text/csv')

  emit('csv-drop', {
    csvFiles,
    nonCsvFiles,
    position: screenToCanvas(e.clientX, e.clientY)
  })
}

onMounted(() => {
  canvasRef.value?.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  canvasRef.value?.removeEventListener('wheel', handleWheel)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', handleWindowBlur)

  // Clean up animation frames
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  // Clean up zoom idle timer
  if (zoomIdleTimer) {
    clearTimeout(zoomIdleTimer)
    zoomIdleTimer = null
  }
})
</script>

<template>
  <div
    ref="canvasRef"
    class="infinite-canvas"
    :class="{ 'dragging-file': isDraggingFile }"
    @mousedown="handleMouseDown"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div
      ref="viewportRef"
      class="viewport"
      :class="{ 'is-moving': isPanning || isRectangleSelecting }"
      :style="viewportStyle"
    >
      <slot />

      <!-- Teleport target for box creation buttons -->
      <div id="box-creation-buttons-container"></div>

      <div
        v-if="canvasStore.rectangleSelection"
        class="selection-rectangle"
        :style="{
          left: `${Math.min(canvasStore.rectangleSelection.startX, canvasStore.rectangleSelection.endX)}px`,
          top: `${Math.min(canvasStore.rectangleSelection.startY, canvasStore.rectangleSelection.endY)}px`,
          width: `${Math.abs(canvasStore.rectangleSelection.endX - canvasStore.rectangleSelection.startX)}px`,
          height: `${Math.abs(canvasStore.rectangleSelection.endY - canvasStore.rectangleSelection.startY)}px`
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.infinite-canvas {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(circle, var(--canvas-dot-color) var(--canvas-dot-size), transparent var(--canvas-dot-size));
  background-size: var(--canvas-dot-spacing) var(--canvas-dot-spacing);
  cursor: grab;
  /* CSS containment for performance */
  contain: layout size style;
}

.viewport {
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  position: relative;
  /* GPU acceleration for smooth transforms */
  will-change: transform;
  /* Contain layout recalcs to this element */
  contain: layout style;
  /* Fix blurry text at scaled sizes */
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

/* Disable pointer events during pan to prevent accidental interactions */
.viewport.is-moving {
  pointer-events: none;
}

.selection-rectangle {
  position: absolute;
  border: 2px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
  background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  pointer-events: none;
  z-index: 9999;
}

/* File drag overlay */
.infinite-canvas.dragging-file::before {
  content: 'Drop CSV file to import';
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  border: 3px dashed color-mix(in srgb, var(--color-accent) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 600;
  color: color-mix(in srgb, var(--color-accent) 90%, transparent);
  pointer-events: none;
  z-index: 10000;
}
</style>
