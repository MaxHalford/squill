<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const canvasRef = ref(null)
const viewportRef = ref(null)

// Canvas state
const pan = ref({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

// Handle mouse wheel for zoom
const handleWheel = (e) => {
  e.preventDefault()

  const delta = e.deltaY
  const zoomFactor = 0.001
  const newZoom = zoom.value * (1 - delta * zoomFactor)

  // Limit zoom between 0.1x and 5x
  zoom.value = Math.min(Math.max(newZoom, 0.1), 5)
}

// Handle panning with middle mouse or space + drag
const handleMouseDown = (e) => {
  // Middle mouse button or space + left click
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    e.preventDefault()
    isPanning.value = true
    panStart.value = {
      x: e.clientX - pan.value.x,
      y: e.clientY - pan.value.y
    }
    canvasRef.value.style.cursor = 'grabbing'
  }
}

const handleMouseMove = (e) => {
  if (isPanning.value) {
    pan.value = {
      x: e.clientX - panStart.value.x,
      y: e.clientY - panStart.value.y
    }
  }
}

const handleMouseUp = () => {
  if (isPanning.value) {
    isPanning.value = false
    canvasRef.value.style.cursor = 'default'
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
}

.viewport {
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
