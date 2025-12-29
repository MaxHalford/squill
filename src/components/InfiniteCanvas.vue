<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide, computed } from 'vue'
import type { Box } from '../types/canvas'
import { useCanvasStore } from '../stores/canvas'

const emit = defineEmits(['canvas-click', 'csv-drop'])
const canvasStore = useCanvasStore()

const props = defineProps<{
  boxes: Box[]
}>()

const canvasRef = ref(null)
const viewportRef = ref(null)

// Canvas state
const pan = ref({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const isActuallyPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

// Rectangle selection state
const isRectangleSelecting = ref(false)
const rectangleStart = ref({ x: 0, y: 0 })
const rectangleCurrent = ref({ x: 0, y: 0 })

// CSV drag state
const isDraggingFile = ref(false)
const dragCounter = ref(0) // Properly track nested drag enter/leave

// Provide zoom to child components
provide('canvasZoom', zoom)

const PADDING = 100 // Padding around boxes in pixels

// Calculate bounding box of all boxes
const calculateBoundingBox = (boxes) => {
  if (!boxes || boxes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  boxes.forEach(box => {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  })

  return { minX, minY, maxX, maxY }
}

// Fit all boxes into view
const fitToView = () => {
  if (!canvasRef.value || !props.boxes || props.boxes.length === 0) {
    return
  }

  const rect = canvasRef.value.getBoundingClientRect()
  const viewportWidth = rect.width
  const viewportHeight = rect.height

  const { minX, minY, maxX, maxY } = calculateBoundingBox(props.boxes)

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  // Calculate zoom to fit (with padding)
  const zoomX = (viewportWidth - PADDING * 2) / contentWidth
  const zoomY = (viewportHeight - PADDING * 2) / contentHeight
  const newZoom = Math.min(zoomX, zoomY, 1) // Don't zoom in beyond 1x

  // Clamp zoom to limits
  const clampedZoom = Math.min(Math.max(newZoom, 0.1), 5)

  // Calculate center of content
  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  // Calculate pan to center content in viewport
  const newPan = {
    x: viewportWidth / 2 - contentCenterX * clampedZoom,
    y: viewportHeight / 2 - contentCenterY * clampedZoom
  }

  zoom.value = clampedZoom
  pan.value = newPan
}

// Get viewport center in canvas coordinates
const getViewportCenter = () => {
  if (!canvasRef.value) return { x: 400, y: 300 }

  const rect = canvasRef.value.getBoundingClientRect()
  const viewportCenterX = rect.width / 2
  const viewportCenterY = rect.height / 2

  // Convert viewport coordinates to canvas coordinates
  const canvasX = (viewportCenterX - pan.value.x) / zoom.value
  const canvasY = (viewportCenterY - pan.value.y) / zoom.value

  return { x: canvasX, y: canvasY }
}

// Smooth pan animation
let animationFrameId: number | null = null
const panToBox = (boxId: number) => {
  const box = props.boxes.find((b) => b.id === boxId)
  if (!box || !canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  const viewportCenterX = rect.width / 2
  const viewportCenterY = rect.height / 2

  // Calculate box center in canvas coordinates
  const boxCenterX = box.x + box.width / 2
  const boxCenterY = box.y + box.height / 2

  // Calculate target pan to center the box
  const targetPan = {
    x: viewportCenterX - boxCenterX * zoom.value,
    y: viewportCenterY - boxCenterY * zoom.value
  }

  // Cancel any ongoing animation
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
  }

  // Smooth animation using easing
  const startPan = { ...pan.value }
  const startTime = performance.now()
  const duration = 400 // milliseconds

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)

    // Ease-out cubic easing for smooth deceleration
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

// Expose methods
defineExpose({
  fitToView,
  getViewportCenter,
  panToBox
})

// Check if element is or is inside a box
const isOverBox = (element) => {
  let current = element
  while (current && current !== canvasRef.value) {
    if (current.classList && current.classList.contains('resizable-box')) {
      return true
    }
    current = current.parentElement
  }
  return false
}

// Check if element is in a scrollable area
const isOverScrollableArea = (element) => {
  let current = element
  while (current && current !== canvasRef.value) {
    if (current.classList && (
      current.classList.contains('table-container') ||
      current.classList.contains('sql-editor') ||
      current.classList.contains('query-editor') ||
      current.classList.contains('datasets-list') ||
      current.classList.contains('schema-browser')
    )) {
      return true
    }
    current = current.parentElement
  }
  return false
}

// Convert screen coordinates to canvas coordinates
const screenToCanvas = (screenX: number, screenY: number) => {
  if (!canvasRef.value) return { x: 0, y: 0 }

  const rect = canvasRef.value.getBoundingClientRect()
  const canvasX = (screenX - rect.left - pan.value.x) / zoom.value
  const canvasY = (screenY - rect.top - pan.value.y) / zoom.value

  return { x: canvasX, y: canvasY }
}

// Check if a box intersects with a rectangle
const boxIntersectsRectangle = (box: Box, rectStartX: number, rectStartY: number, rectEndX: number, rectEndY: number): boolean => {
  // Calculate rectangle bounds (normalize in case dragged right-to-left or bottom-to-top)
  const rectLeft = Math.min(rectStartX, rectEndX)
  const rectRight = Math.max(rectStartX, rectEndX)
  const rectTop = Math.min(rectStartY, rectEndY)
  const rectBottom = Math.max(rectStartY, rectEndY)

  // Check if box intersects with rectangle
  const boxLeft = box.x
  const boxRight = box.x + box.width
  const boxTop = box.y
  const boxBottom = box.y + box.height

  return !(boxRight < rectLeft || boxLeft > rectRight || boxBottom < rectTop || boxTop > rectBottom)
}

// Handle mouse wheel for zoom - zoom to cursor position
const handleWheel = (e) => {
  // Allow native scrolling in scrollable areas when Ctrl/Cmd is NOT pressed
  if (isOverScrollableArea(e.target) && !(e.ctrlKey || e.metaKey)) {
    return
  }

  // Otherwise, zoom (either not over scrollable area, or Ctrl/Cmd is pressed to override)
  e.preventDefault()

  const rect = canvasRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  // Calculate mouse position in canvas space (before zoom)
  const mouseXInCanvas = (mouseX - pan.value.x) / zoom.value
  const mouseYInCanvas = (mouseY - pan.value.y) / zoom.value

  const delta = e.deltaY
  const zoomFactor = 0.001
  const newZoom = zoom.value * (1 - delta * zoomFactor)

  // Limit zoom between 0.1x and 5x
  const clampedZoom = Math.min(Math.max(newZoom, 0.1), 5)

  // Adjust pan so the point under the cursor stays in the same place
  pan.value = {
    x: mouseX - mouseXInCanvas * clampedZoom,
    y: mouseY - mouseYInCanvas * clampedZoom
  }

  zoom.value = clampedZoom
}

// Handle panning - allow by default unless over a box
const handleMouseDown = (e) => {
  // Left mouse button
  if (e.button === 0) {
    // Check if Cmd/Ctrl is pressed for rectangle selection
    if ((e.ctrlKey || e.metaKey) && !isOverBox(e.target)) {
      e.preventDefault()
      isRectangleSelecting.value = true

      // Convert screen coordinates to canvas coordinates
      const canvasCoords = screenToCanvas(e.clientX, e.clientY)
      rectangleStart.value = canvasCoords
      rectangleCurrent.value = canvasCoords

      canvasRef.value.style.cursor = 'crosshair'
      return
    }

    // Don't pan if we're over a box
    if (isOverBox(e.target)) {
      return
    }

    e.preventDefault()
    isPanning.value = true
    isActuallyPanning.value = false
    panStart.value = {
      x: e.clientX - pan.value.x,
      y: e.clientY - pan.value.y
    }
    canvasRef.value.style.cursor = 'grabbing'
  }
}

const handleMouseMove = (e) => {
  if (isRectangleSelecting.value) {
    // Update rectangle current position in canvas coordinates
    const canvasCoords = screenToCanvas(e.clientX, e.clientY)
    rectangleCurrent.value = canvasCoords

    // Update store for visual rendering
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

const handleMouseUp = (e) => {
  if (isRectangleSelecting.value) {
    // Find all boxes that intersect with the selection rectangle
    const selectedIds: number[] = []

    props.boxes.forEach(box => {
      if (boxIntersectsRectangle(box, rectangleStart.value.x, rectangleStart.value.y, rectangleCurrent.value.x, rectangleCurrent.value.y)) {
        selectedIds.push(box.id)
      }
    })

    // Blur active element so keyboard shortcuts work on boxes
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    // Update selection in store
    if (selectedIds.length > 0) {
      canvasStore.selectMultipleBoxes(selectedIds)
    } else {
      canvasStore.clearSelection()
    }

    // Clear rectangle selection visual
    canvasStore.setRectangleSelection(null)
    isRectangleSelecting.value = false
    canvasRef.value.style.cursor = 'grab'
    return
  }

  if (isPanning.value) {
    // If we didn't actually pan (just clicked), emit canvas click
    if (!isActuallyPanning.value) {
      emit('canvas-click')
    }

    isPanning.value = false
    isActuallyPanning.value = false
    canvasRef.value.style.cursor = 'grab'
  }
}

// CSV drag and drop handlers
const handleDragEnter = (e: DragEvent) => {
  // Only handle file drags
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    dragCounter.value++
    isDraggingFile.value = true
  }
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  dragCounter.value--
  if (dragCounter.value === 0) {
    isDraggingFile.value = false
  }
}

const handleDragOver = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  isDraggingFile.value = false
  dragCounter.value = 0

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  // Separate CSV and non-CSV files
  const allFiles = Array.from(files)
  const csvFiles = allFiles.filter(
    f => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv'
  )
  const nonCsvFiles = allFiles.filter(
    f => !f.name.toLowerCase().endsWith('.csv') && f.type !== 'text/csv'
  )

  // Convert drop position to canvas coordinates
  const dropPos = screenToCanvas(e.clientX, e.clientY)

  // Emit to parent for orchestration (include both CSV and non-CSV for error handling)
  emit('csv-drop', { csvFiles, nonCsvFiles, position: dropPos })
}

onMounted(() => {
  const canvas = canvasRef.value
  canvas.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  const canvas = canvasRef.value
  if (canvas) {
    canvas.removeEventListener('wheel', handleWheel)
  }
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
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
      :style="{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
      }"
    >
      <slot />

      <!-- Rectangle selection overlay -->
      <div
        v-if="canvasStore.rectangleSelection"
        class="selection-rectangle"
        :style="{
          left: `${Math.min(canvasStore.rectangleSelection.startX, canvasStore.rectangleSelection.endX)}px`,
          top: `${Math.min(canvasStore.rectangleSelection.startY, canvasStore.rectangleSelection.endY)}px`,
          width: `${Math.abs(canvasStore.rectangleSelection.endX - canvasStore.rectangleSelection.startX)}px`,
          height: `${Math.abs(canvasStore.rectangleSelection.endY - canvasStore.rectangleSelection.startY)}px`
        }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.infinite-canvas {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  overflow: hidden;
  background-color: #d4d4d4;
  background-image: radial-gradient(circle, #000 1.2px, transparent 1.2px);
  background-size: 7px 7px;
  cursor: grab;
}

.viewport {
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  position: relative;
}

.selection-rectangle {
  position: absolute;
  border: 2px solid color-mix(in srgb, var(--color-purple) 60%, transparent);
  background-color: color-mix(in srgb, var(--color-purple) 15%, transparent);
  pointer-events: none;
  z-index: 9999;
}

/* Purple haze overlay for file drag */
.infinite-canvas.dragging-file::before {
  content: 'Drop CSV file to import';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--color-purple) 15%, transparent);
  border: 3px dashed color-mix(in srgb, var(--color-purple) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 600;
  color: color-mix(in srgb, var(--color-purple) 90%, transparent);
  pointer-events: none;
  z-index: 10000;
}
</style>
