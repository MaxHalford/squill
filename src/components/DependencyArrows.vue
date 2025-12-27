<script setup>
import { computed } from 'vue'

const props = defineProps({
  boxes: { type: Array, required: true }
})

// Calculate arrows between boxes based on dependencies
const arrows = computed(() => {
  const result = []

  props.boxes.forEach(box => {
    if (!box.dependencies || box.dependencies.length === 0) return

    box.dependencies.forEach(sourceBoxId => {
      const sourceBox = props.boxes.find(b => b.id === sourceBoxId)
      if (!sourceBox) return

      // Calculate arrow positions
      // Arrow goes from source box (right side) to target box (left side)
      const sourceX = sourceBox.x + sourceBox.width
      const sourceY = sourceBox.y + sourceBox.height / 2

      const targetX = box.x
      const targetY = box.y + box.height / 2

      result.push({
        id: `${sourceBoxId}-${box.id}`,
        sourceBoxId,
        targetBoxId: box.id,
        sourceX,
        sourceY,
        targetX,
        targetY
      })
    })
  })

  return result
})

// Generate SVG path for curved arrow
const getArrowPath = (arrow) => {
  const { sourceX, sourceY, targetX, targetY } = arrow

  // Calculate control points for bezier curve
  const dx = targetX - sourceX
  const controlPointOffset = Math.min(Math.abs(dx) / 2, 100)

  const cp1x = sourceX + controlPointOffset
  const cp1y = sourceY
  const cp2x = targetX - controlPointOffset
  const cp2y = targetY

  return `M ${sourceX} ${sourceY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${targetX} ${targetY}`
}

</script>

<template>
  <svg
    class="dependency-arrows"
    :style="{ pointerEvents: 'none' }"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker
        id="arrowhead"
        markerWidth="10"
        markerHeight="10"
        refX="8"
        refY="5"
        orient="auto"
        markerUnits="strokeWidth"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-dependency)" />
      </marker>
    </defs>

    <g v-for="arrow in arrows" :key="arrow.id">
      <!-- Arrow line with marker -->
      <path
        :d="getArrowPath(arrow)"
        fill="none"
        stroke="var(--color-dependency)"
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
  z-index: 0; /* Behind boxes */
  overflow: visible;
}

.arrow-path {
  opacity: 0.7;
  transition: opacity 0.2s, stroke-width 0.2s;
}

.arrow-path:hover {
  opacity: 1;
  stroke-width: 3;
}

/* CSS variable for arrow color - can be customized */
:root {
  --color-dependency: #4285f4;
}
</style>
