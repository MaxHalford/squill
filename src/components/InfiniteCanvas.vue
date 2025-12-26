<script setup>
import { ref, onMounted, onUnmounted, provide } from 'vue'

const emit = defineEmits(['canvas-click'])

const props = defineProps({
  boxes: { type: Array, default: () => [] }
})

const canvasRef = ref(null)
const viewportRef = ref(null)

// Canvas state
const pan = ref({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const isActuallyPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

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

// Expose methods
defineExpose({
  fitToView,
  getViewportCenter
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
  if (isPanning.value) {
    isActuallyPanning.value = true
    pan.value = {
      x: e.clientX - panStart.value.x,
      y: e.clientY - panStart.value.y
    }
  }
}

const handleMouseUp = (e) => {
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
    @mousedown="handleMouseDown"
  >
    <div
      ref="viewportRef"
      class="viewport"
      :style="{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
      }"
    >
      <slot />
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
</style>
