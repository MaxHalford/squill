<script setup>
import { computed } from 'vue'

const props = defineProps({
  boxes: { type: Array, required: true }
})

// Determine best connection points based on relative box positions
const getConnectionPoints = (sourceBox, targetBox) => {
  const sourceCenterX = sourceBox.x + sourceBox.width / 2
  const sourceCenterY = sourceBox.y + sourceBox.height / 2
  const targetCenterX = targetBox.x + targetBox.width / 2
  const targetCenterY = targetBox.y + targetBox.height / 2

  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY

  let sourcePoint, targetPoint, sourceDir, targetDir

  // Determine connection sides based on relative positions
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal connection is dominant
    if (dx > 0) {
      // Target is to the right of source
      sourcePoint = {
        x: sourceBox.x + sourceBox.width,
        y: sourceCenterY
      }
      targetPoint = {
        x: targetBox.x,
        y: targetCenterY
      }
      sourceDir = 'right'
      targetDir = 'left'
    } else {
      // Target is to the left of source
      sourcePoint = {
        x: sourceBox.x,
        y: sourceCenterY
      }
      targetPoint = {
        x: targetBox.x + targetBox.width,
        y: targetCenterY
      }
      sourceDir = 'left'
      targetDir = 'right'
    }
  } else {
    // Vertical connection is dominant
    if (dy > 0) {
      // Target is below source
      sourcePoint = {
        x: sourceCenterX,
        y: sourceBox.y + sourceBox.height
      }
      targetPoint = {
        x: targetCenterX,
        y: targetBox.y
      }
      sourceDir = 'down'
      targetDir = 'up'
    } else {
      // Target is above source
      sourcePoint = {
        x: sourceCenterX,
        y: sourceBox.y
      }
      targetPoint = {
        x: targetCenterX,
        y: targetBox.y + targetBox.height
      }
      sourceDir = 'up'
      targetDir = 'down'
    }
  }

  return { sourcePoint, targetPoint, sourceDir, targetDir }
}

// Create orthogonal path with right angles (L-shape)
const getOrthogonalPath = (sourcePoint, targetPoint, sourceDir) => {
  const { x: x1, y: y1 } = sourcePoint
  const { x: x2, y: y2 } = targetPoint

  // Offset from box edge
  const offset = 20

  let path

  if (sourceDir === 'right') {
    // Go right, then turn
    const midX = x1 + offset
    path = `M ${x1},${y1} L ${midX},${y1} L ${midX},${y2} L ${x2},${y2}`
  } else if (sourceDir === 'left') {
    // Go left, then turn
    const midX = x1 - offset
    path = `M ${x1},${y1} L ${midX},${y1} L ${midX},${y2} L ${x2},${y2}`
  } else if (sourceDir === 'down') {
    // Go down, then turn
    const midY = y1 + offset
    path = `M ${x1},${y1} L ${x1},${midY} L ${x2},${midY} L ${x2},${y2}`
  } else { // 'up'
    // Go up, then turn
    const midY = y1 - offset
    path = `M ${x1},${y1} L ${x1},${midY} L ${x2},${midY} L ${x2},${y2}`
  }

  return path
}

// Calculate all arrows with smart routing
const arrows = computed(() => {
  const result = []

  props.boxes.forEach(box => {
    if (!box.dependencies || box.dependencies.length === 0) return

    box.dependencies.forEach(sourceBoxId => {
      const sourceBox = props.boxes.find(b => b.id === sourceBoxId)
      if (!sourceBox) return

      // Get smart connection points
      const { sourcePoint, targetPoint, sourceDir, targetDir } = getConnectionPoints(sourceBox, box)

      // Create orthogonal path
      const path = getOrthogonalPath(sourcePoint, targetPoint, sourceDir)

      result.push({
        id: `${sourceBoxId}-${box.id}`,
        sourceBoxId,
        targetBoxId: box.id,
        path,
        targetPoint,
        targetDir
      })
    })
  })

  return result
})

// Get rotation angle for arrowhead based on target direction
const getArrowRotation = (targetDir) => {
  switch (targetDir) {
    case 'right': return 0
    case 'left': return 180
    case 'down': return 90
    case 'up': return 270
    default: return 0
  }
}
</script>

<template>
  <svg
    class="dependency-arrows"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker
        id="arrowhead"
        markerWidth="10"
        markerHeight="10"
        refX="5"
        refY="5"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4285f4" />
      </marker>
    </defs>

    <g v-for="arrow in arrows" :key="arrow.id" class="arrow-group">
      <!-- Orthogonal path with arrowhead -->
      <path
        :d="arrow.path"
        fill="none"
        stroke="#4285f4"
        stroke-width="2"
        marker-end="url(#arrowhead)"
        class="arrow-path"
      />
    </g>
  </svg>
</template>

<style scoped>
.dependency-arrows {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}

.arrow-group {
  pointer-events: none;
}

.arrow-path {
  opacity: 0.7;
  transition: opacity 0.2s, stroke-width 0.2s;
}

.arrow-path:hover {
  opacity: 1;
  stroke-width: 3;
}
</style>
