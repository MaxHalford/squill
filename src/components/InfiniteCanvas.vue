<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['canvas-click'])

const canvasRef = ref(null)
const viewportRef = ref(null)

// Canvas state
const pan = ref({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const isActuallyPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

// Check if element is or is inside a SQL box
const isOverSqlBox = (element) => {
  let current = element
  while (current && current !== canvasRef.value) {
    if (current.classList && current.classList.contains('sql-box')) {
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
      current.classList.contains('sql-editor')
    )) {
      return true
    }
    current = current.parentElement
  }
  return false
}

// Handle mouse wheel for zoom - zoom to cursor position
const handleWheel = (e) => {
  // If Shift is pressed, always zoom regardless of what we're hovering over
  if (!e.shiftKey) {
    // Allow native scrolling if over a scrollable area and not holding Shift
    if (isOverScrollableArea(e.target)) {
      return
    }
  }

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

// Handle panning - allow by default unless over SQL box
const handleMouseDown = (e) => {
  // Left mouse button
  if (e.button === 0) {
    // Don't pan if we're over a SQL box
    if (isOverSqlBox(e.target)) {
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
  canvas.addEventListener('wheel', handleWheel, { passive: false })
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
  background:
    linear-gradient(90deg, rgba(200, 200, 200, 0.1) 1px, transparent 1px),
    linear-gradient(rgba(200, 200, 200, 0.1) 1px, transparent 1px);
  background-size: 50px 50px;
  background-position: 0 0;
  cursor: grab;
}

.viewport {
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
