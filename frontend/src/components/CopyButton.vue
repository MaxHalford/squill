<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  text: string
  size?: 'sm' | 'md'
  tooltip?: string
}>()

const copied = ref(false)

async function copy() {
  if (!props.text) return
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const iconSize = props.size === 'sm' ? 12 : 16
</script>

<template>
  <button
    v-tooltip="copied ? 'Copied!' : (tooltip ?? 'Copy to clipboard')"
    class="copy-btn"
    :class="[size ?? 'md', { copied }]"
    @click.stop="copy"
  >
    <!-- Checkmark icon when copied -->
    <svg
      v-if="copied"
      :width="iconSize"
      :height="iconSize"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
    <!-- Copy icon -->
    <svg
      v-else
      :width="iconSize"
      :height="iconSize"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect
        x="9"
        y="9"
        width="13"
        height="13"
        rx="2"
        ry="2"
      />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  </button>
</template>

<style scoped>
.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: var(--border-width-thin) solid transparent;
  border-radius: var(--border-radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

/* Size variants */
.copy-btn.sm {
  width: 20px;
  height: 20px;
}

.copy-btn.md {
  width: 28px;
  height: 28px;
}

.copy-btn:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.copy-btn.copied {
  color: var(--color-success);
  border-color: var(--color-success);
}
</style>
