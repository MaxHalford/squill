<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import ResizableBox from './ResizableBox.vue'

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const props = defineProps<{
  boxId: number
  initialX?: number
  initialY?: number
  initialWidth?: number
  initialHeight?: number
  initialZIndex?: number
  isSelected?: boolean
  initialName?: string
  showHeaderName?: boolean
  connectionMissing?: boolean
  connectionType?: string
}>()

const emit = defineEmits<{
  'select': [payload: { shouldPan: boolean }]
  'update:position': [position: Position]
  'update:size': [size: Size]
  'delete': []
  'maximize': []
  'update:name': [name: string]
  'drag-start': []
  'drag-end': []
}>()

const isEditingName = ref(false)
const boxName = ref(props.initialName || 'Box')
const nameInputRef = ref<HTMLInputElement | null>(null)

watch(() => props.initialName, (newName) => {
  if (newName) boxName.value = newName
})

const startEditingName = (e: MouseEvent) => {
  e.stopPropagation()
  isEditingName.value = true
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

const finishEditingName = () => {
  isEditingName.value = false
  const newName = boxName.value.trim()

  if (newName && newName !== props.initialName) {
    emit('update:name', newName)
  } else if (!newName) {
    boxName.value = props.initialName || 'Box'
  }
}

const handleNameKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishEditingName()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    boxName.value = props.initialName || 'Box'
    isEditingName.value = false
  }
}

const handleMaximize = (e: MouseEvent) => {
  e.stopPropagation()
  emit('maximize')
}

const handleDelete = (e: MouseEvent) => {
  e.stopPropagation()
  emit('delete')
}

defineExpose({ boxName })
</script>

<template>
  <ResizableBox
    :box-id="boxId"
    :initial-x="initialX ?? 100"
    :initial-y="initialY ?? 100"
    :initial-width="initialWidth ?? 600"
    :initial-height="initialHeight ?? 500"
    :initial-z-index="initialZIndex ?? 1"
    :is-selected="isSelected ?? false"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <template #header>
      <div v-if="showHeaderName" class="box-name-container">
        <input
          v-if="isEditingName"
          ref="nameInputRef"
          v-model="boxName"
          type="text"
          class="name-input"
          @blur="finishEditingName"
          @keydown="handleNameKeydown"
          @click.stop
        />
        <span
          v-else
          class="box-name"
          v-tooltip="'Double-click to edit'"
          @dblclick="startEditingName"
        >{{ boxName }}</span>
      </div>

      <div class="header-buttons" :class="{ 'no-name': !showHeaderName }">
        <button
          class="header-btn"
          v-tooltip="'Fit to view'"
          aria-label="Fit to view"
          @click="handleMaximize"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <button
          class="header-btn delete-btn"
          v-tooltip="'Close (Delete)'"
          aria-label="Close"
          @click="handleDelete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 5L5 19M5 5l14 14"/>
          </svg>
        </button>
      </div>
    </template>

    <div v-if="connectionMissing" class="connection-missing-overlay">
      <div class="connection-missing-message">
        <span>Connection unavailable</span>
        <span class="connection-missing-hint">
          The {{ connectionType || 'database' }} connection for this box no longer exists
        </span>
      </div>
    </div>
    <slot />
  </ResizableBox>
</template>

<style scoped>
.box-name-container {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-right: auto;
  min-width: 0;
}

.box-name {
  cursor: pointer;
  user-select: none;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: bold;
}

.box-name:hover {
  cursor: text;
}

.name-input {
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  padding: 0;
  margin: 0;
  font-weight: bold;
  min-width: 100px;
  max-width: 400px;
  line-height: 1.2;
}

.header-buttons {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}

.header-buttons.no-name {
  margin-left: auto;
}

.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.header-btn:hover {
  background: var(--text-secondary);
  color: var(--surface-primary);
}

.delete-btn:hover {
  background: var(--color-error);
  color: white;
}

/* Connection missing overlay */
.connection-missing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(128, 128, 128, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none; /* Allow clicks to pass through to content */
}

.connection-missing-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-md);
  text-align: center;
  max-width: 280px;
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  pointer-events: auto; /* Message box itself captures clicks */
}

.connection-missing-message svg {
  color: var(--color-warning, #f59e0b);
}

.connection-missing-hint {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  font-weight: normal;
}
</style>
