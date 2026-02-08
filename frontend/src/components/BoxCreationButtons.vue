<script setup lang="ts">
import { computed } from 'vue'
import type { Box } from '../types/canvas'
import { useCanvasStore } from '../stores/canvas'

const canvasStore = useCanvasStore()

const props = defineProps<{
  selectedBox: Box | null
}>()

const emit = defineEmits<{
  'create-box-below': [box: Box]
  'create-box-right': [box: Box]
}>()

// Hide buttons during drag
const shouldShow = computed(() => {
  return props.selectedBox &&
         props.selectedBox.type === 'sql' &&
         !canvasStore.isDraggingBox
})

// Button positioning constants
const BUTTON_GAP = 16 // Gap between box edge and button

// Position for button below the box (centered horizontally)
const belowButtonStyle = computed(() => {
  if (!props.selectedBox) return {}
  return {
    left: `${props.selectedBox.x + props.selectedBox.width / 2}px`,
    top: `${props.selectedBox.y + props.selectedBox.height + BUTTON_GAP}px`,
    transform: 'translateX(-50%)'
  }
})

// Position for button to the right of the box (centered vertically)
const rightButtonStyle = computed(() => {
  if (!props.selectedBox) return {}
  return {
    left: `${props.selectedBox.x + props.selectedBox.width + BUTTON_GAP}px`,
    top: `${props.selectedBox.y + props.selectedBox.height / 2}px`,
    transform: 'translateY(-50%)'
  }
})

const handleClickBelow = () => {
  if (props.selectedBox) {
    emit('create-box-below', props.selectedBox)
  }
}

const handleClickRight = () => {
  if (props.selectedBox) {
    emit('create-box-right', props.selectedBox)
  }
}
</script>

<template>
  <div
    v-if="shouldShow"
    class="box-creation-buttons"
  >
    <!-- Button below -->
    <button
      v-tooltip="'Create new query box below'"
      class="creation-button"
      :style="belowButtonStyle"
      @click.stop="handleClickBelow"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line
          x1="12"
          y1="5"
          x2="12"
          y2="19"
        />
        <line
          x1="5"
          y1="12"
          x2="19"
          y2="12"
        />
      </svg>
    </button>

    <!-- Button to the right -->
    <button
      v-tooltip="'Create new query box to the right'"
      class="creation-button"
      :style="rightButtonStyle"
      @click.stop="handleClickRight"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line
          x1="12"
          y1="5"
          x2="12"
          y2="19"
        />
        <line
          x1="5"
          y1="12"
          x2="19"
          y2="12"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.box-creation-buttons {
  pointer-events: none;
}

.creation-button {
  position: absolute;
  pointer-events: auto;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-secondary);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  backdrop-filter: blur(4px);
  opacity: 0.85;
}

.creation-button:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
  border-color: var(--border-primary);
  opacity: 1;
}

.creation-button:active {
  transform: translateX(-50%) scale(0.95);
}

.creation-button:last-child:active {
  transform: translateY(-50%) scale(0.95);
}
</style>
