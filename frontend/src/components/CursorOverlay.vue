<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasStore } from '../stores/canvas'

const canvasStore = useCanvasStore()
const cursors = computed(() => [...canvasStore.remoteCursors.values()])
</script>

<template>
  <div class="cursor-overlay" aria-hidden="true">
    <div
      v-for="cursor in cursors"
      :key="cursor.clientId"
      class="remote-cursor"
      :style="{ left: cursor.x + 'px', top: cursor.y + 'px', '--c': cursor.color }"
    >
      <svg class="cursor-arrow" width="14" height="18" viewBox="0 0 14 18" fill="none">
        <path d="M1 1L1 14L4.5 10.5L7 16L9.5 15L7 9.5L11.5 9.5Z" :fill="cursor.color" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
      <span class="cursor-label">{{ cursor.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.cursor-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50000;
}

.remote-cursor {
  position: absolute;
  pointer-events: none;
  transform: translate(0, 0);
}

.cursor-arrow {
  display: block;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
}

.cursor-label {
  position: absolute;
  left: 14px;
  top: 2px;
  background: var(--c);
  color: white;
  font-family: var(--font-family-ui);
  font-size: var(--font-size-caption);
  font-weight: 600;
  padding: 1px 5px;
  white-space: nowrap;
  border: 1px solid rgba(0,0,0,0.2);
  letter-spacing: 0.02em;
}
</style>
