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
}>()

const emit = defineEmits<{
  'select': [payload: { shouldPan: boolean }]
  'update:position': [position: Position]
  'update:size': [size: Size]
  'delete': []
  'maximize': []
  'update:name': [name: string]
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
          title="Double-click to edit"
          @dblclick="startEditingName"
        >{{ boxName }}</span>
      </div>

      <div class="header-buttons" :class="{ 'no-name': !showHeaderName }">
        <button
          class="header-btn"
          title="Maximize"
          aria-label="Maximize"
          @click="handleMaximize"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <button
          class="header-btn delete-btn"
          title="Delete"
          aria-label="Delete"
          @click="handleDelete"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </template>

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
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.box-name:hover {
  opacity: 0.7;
}

.name-input {
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  padding: 0;
  margin: 0;
  min-width: 100px;
  max-width: 400px;
  line-height: 1;
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
  color: var(--text-inverse);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.header-btn:hover {
  background: var(--text-inverse);
  color: var(--surface-inverse);
}

.delete-btn:hover {
  background: var(--color-error);
  color: var(--text-inverse);
}
</style>
