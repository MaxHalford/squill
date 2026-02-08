<script setup lang="ts">
import { computed } from 'vue'
import type { Box } from '../types/canvas'

const props = defineProps<{
  boxes: Box[]
}>()

// O(1) box lookup map - only rebuilds when box list changes
const boxMap = computed(() => new Map(props.boxes.map(b => [b.id, b])))

type Direction = 'left' | 'right' | 'up' | 'down'
type Point = { x: number; y: number }

// Determine best connection points based on relative box positions
const getConnectionPoints = (sourceBox: Box, targetBox: Box) => {
  const sourceCenterX = sourceBox.x + sourceBox.width / 2
  const sourceCenterY = sourceBox.y + sourceBox.height / 2
  const targetCenterX = targetBox.x + targetBox.width / 2
  const targetCenterY = targetBox.y + targetBox.height / 2

  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY

  let sourcePoint: Point, targetPoint: Point, sourceDir: Direction, targetDir: Direction

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

// Create orthogonal path with smooth routing
const getOrthogonalPath = (sourcePoint: Point, targetPoint: Point, sourceDir: Direction, _targetDir: Direction) => {
  const { x: x1, y: y1 } = sourcePoint
  const { x: x2, y: y2 } = targetPoint

  // Calculate distance between points
  const dx = Math.abs(x2 - x1)
  const dy = Math.abs(y2 - y1)

  // Use adaptive offset based on distance
  const baseOffset = 40
  const minOffset = 40
  const offset = Math.max(minOffset, Math.min(baseOffset, dx / 4, dy / 4))

  let path

  if (sourceDir === 'right' || sourceDir === 'left') {
    // Horizontal start
    const midX = sourceDir === 'right' ? x1 + offset : x1 - offset

    // Use midpoint for smoother routing
    if (Math.abs(y2 - y1) > 10) {
      const midY = (y1 + y2) / 2
      path = `M ${x1},${y1} L ${midX},${y1} L ${midX},${midY} L ${midX},${y2} L ${x2},${y2}`
    } else {
      path = `M ${x1},${y1} L ${midX},${y1} L ${midX},${y2} L ${x2},${y2}`
    }
  } else {
    // Vertical start
    const midY = sourceDir === 'down' ? y1 + offset : y1 - offset

    // Use midpoint for smoother routing
    if (Math.abs(x2 - x1) > 10) {
      const midX = (x1 + x2) / 2
      path = `M ${x1},${y1} L ${x1},${midY} L ${midX},${midY} L ${x2},${midY} L ${x2},${y2}`
    } else {
      path = `M ${x1},${y1} L ${x1},${midY} L ${x2},${midY} L ${x2},${y2}`
    }
  }

  return path
}

// Get only boxes that have dependencies (as source or target)
const dependencyBoxIds = computed(() => {
  const ids = new Set<number>()
  for (const box of props.boxes) {
    if (box.dependencies?.length) {
      ids.add(box.id)
      for (const depId of box.dependencies) {
        ids.add(depId)
      }
    }
  }
  return ids
})

// Calculate all arrows with smart routing
// Only recalculates when boxes with dependencies change
const arrows = computed(() => {
  const result: Array<{
    id: string
    sourceBoxId: number
    targetBoxId: number
    path: string
    targetPoint: Point
    targetDir: Direction
  }> = []

  const map = boxMap.value
  const relevantIds = dependencyBoxIds.value

  // Early exit if no dependencies
  if (relevantIds.size === 0) return result

  for (const box of props.boxes) {
    if (!box.dependencies || box.dependencies.length === 0) continue

    for (const sourceBoxId of box.dependencies) {
      const sourceBox = map.get(sourceBoxId)
      if (!sourceBox) continue

      // Get smart connection points
      const { sourcePoint, targetPoint, sourceDir, targetDir } = getConnectionPoints(sourceBox, box)

      // Create orthogonal path
      const path = getOrthogonalPath(sourcePoint, targetPoint, sourceDir, targetDir)

      result.push({
        id: `${sourceBoxId}-${box.id}`,
        sourceBoxId,
        targetBoxId: box.id,
        path,
        targetPoint,
        targetDir
      })
    }
  }

  return result
})
</script>

<template>
  <svg
    class="dependency-arrows"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker
        id="arrowhead"
        markerWidth="8"
        markerHeight="8"
        refX="4"
        refY="4"
        orient="auto-start-reverse"
      >
        <path
          d="M 0 0 L 8 4 L 0 8 z"
          fill="#000000"
        />
      </marker>
    </defs>

    <g
      v-for="arrow in arrows"
      :key="arrow.id"
      class="arrow-group"
    >
      <!-- Orthogonal path with arrowhead -->
      <path
        :d="arrow.path"
        fill="none"
        stroke="#000000"
        stroke-width="3"
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
  /* GPU acceleration for SVG */
  will-change: transform;
  shape-rendering: geometricPrecision;
}

.arrow-group {
  pointer-events: none;
}

.arrow-path {
  transition: opacity 0.2s, stroke-width 0.2s;
}

.arrow-path:hover {
  stroke-width: 4;
}
</style>
