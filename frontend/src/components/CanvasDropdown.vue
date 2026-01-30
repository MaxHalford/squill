<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import type { CanvasMeta } from '../types/canvas'

defineProps<{
  activeDropdown: string | null
}>()

const emit = defineEmits<{
  'toggle-dropdown': [dropdown: string]
  'close-dropdown': []
}>()

const canvasStore = useCanvasStore()

// Editing state
const editingCanvasId = ref<string | null>(null)
const editInputValue = ref('')
const editInputRefs = ref<Map<string, HTMLInputElement>>(new Map())

// Canvas list sorted by recent
const canvasList = computed(() => canvasStore.getCanvasList())

// Handle canvas selection
const handleCanvasSelect = (canvasId: string) => {
  if (editingCanvasId.value === canvasId) return
  canvasStore.switchCanvas(canvasId)
  emit('close-dropdown')
}

// Handle create new canvas
const handleCreateCanvas = () => {
  canvasStore.createCanvas()
  emit('close-dropdown')
}

// Handle duplicate canvas
const handleDuplicate = (canvasId: string, event: Event) => {
  event.stopPropagation()
  canvasStore.duplicateCanvas(canvasId)
  emit('close-dropdown')
}

// Handle delete canvas
const handleDelete = (canvasId: string, event: Event) => {
  event.stopPropagation()
  if (canvasList.value.length <= 1) return

  const canvas = canvasList.value.find(c => c.id === canvasId)
  if (canvas && confirm(`Delete "${canvas.name}"? This cannot be undone.`)) {
    canvasStore.deleteCanvas(canvasId)
  }
}

// Set input ref for a canvas
const setInputRef = (canvasId: string, el: HTMLInputElement | null) => {
  if (el) {
    editInputRefs.value.set(canvasId, el)
  } else {
    editInputRefs.value.delete(canvasId)
  }
}

// Start editing canvas name
const startEditing = (canvas: CanvasMeta, event: Event) => {
  event.stopPropagation()
  editingCanvasId.value = canvas.id
  editInputValue.value = canvas.name
  nextTick(() => {
    const input = editInputRefs.value.get(canvas.id)
    input?.focus()
    input?.select()
  })
}

// Save canvas name
const saveCanvasName = () => {
  if (editingCanvasId.value && editInputValue.value.trim()) {
    canvasStore.renameCanvas(editingCanvasId.value, editInputValue.value.trim())
  }
  editingCanvasId.value = null
}

// Cancel editing
const cancelEditing = () => {
  editingCanvasId.value = null
}

// Handle key events in edit input
const handleEditKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    saveCanvasName()
  } else if (event.key === 'Escape') {
    cancelEditing()
  }
}

// Toggle dropdown
const toggleDropdown = () => {
  emit('toggle-dropdown', 'canvas')
}
</script>

<template>
  <div class="menu-item" :class="{ active: activeDropdown === 'canvas' }">
    <button class="menu-button" @click.stop="toggleDropdown">
      <span class="menu-text">{{ canvasStore.activeCanvasName }}</span>
      <span class="menu-caret">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </span>
    </button>

    <Transition name="dropdown">
    <div v-if="activeDropdown === 'canvas'" class="dropdown canvas-dropdown">
      <!-- Canvas List Section -->
      <div class="dropdown-section">
        <div class="section-label">Canvases</div>
        <button
          v-for="canvas in canvasList"
          :key="canvas.id"
          class="dropdown-item canvas-item"
          :class="{ selected: canvas.id === canvasStore.activeCanvasId }"
          @click="handleCanvasSelect(canvas.id)"
        >
          <div class="canvas-info">
            <!-- Editable name -->
            <input
              v-if="editingCanvasId === canvas.id"
              :ref="(el) => setInputRef(canvas.id, el as HTMLInputElement)"
              v-model="editInputValue"
              class="canvas-name-input"
              type="text"
              @click.stop
              @keydown="handleEditKeydown"
              @blur="saveCanvasName"
            />
            <span v-else class="canvas-name">
              {{ canvas.name }}
            </span>
          </div>
          <div class="canvas-actions" @click.stop>
            <!-- Rename button -->
            <button
              class="action-btn"
              @click="startEditing(canvas, $event)"
              v-tooltip="'Rename'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <!-- Duplicate button -->
            <button
              class="action-btn"
              @click="handleDuplicate(canvas.id, $event)"
              v-tooltip="'Duplicate'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
            <!-- Delete button -->
            <button
              v-if="canvasList.length > 1"
              class="action-btn delete-btn"
              @click="handleDelete(canvas.id, $event)"
              v-tooltip="'Delete'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </button>
      </div>

      <!-- Add Canvas Section -->
      <div class="dropdown-section add-section">
        <div class="section-divider"></div>
        <button class="dropdown-item add-item" @click="handleCreateCanvas">
          <span class="add-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          New canvas
        </button>
      </div>
    </div>
    </Transition>
  </div>
</template>

<style scoped>
.menu-item {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
}

.menu-item.active .menu-button {
  background: var(--surface-secondary);
}

.menu-button {
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  cursor: pointer;
  outline: none;
  transition: background 0.15s;
}

.menu-button:hover {
  background: var(--surface-secondary);
}

.menu-text {
  font-weight: 500;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
}

.menu-caret svg {
  display: block;
}

/* Dropdown */
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  margin-top: 1px;
  z-index: 2000;
  max-height: 400px;
  overflow-y: auto;
}

.canvas-dropdown {
  min-width: 250px;
  max-width: 350px;
}

.dropdown-section {
  padding: 0;
}

.section-label {
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-3) var(--space-1) var(--space-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--surface-secondary);
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  text-align: left;
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: background 0.1s;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: var(--surface-secondary);
}

.dropdown-item.selected {
  background: var(--surface-secondary);
}

.canvas-item {
  gap: var(--space-2);
}

.canvas-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.canvas-name {
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-name-input {
  width: 100%;
  padding: 2px var(--space-1);
  border: var(--border-width-thin) solid var(--color-accent);
  background: var(--surface-primary);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  outline: none;
  border-radius: 2px;
}

.canvas-actions {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}

.action-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  border-radius: 2px;
  transition: all 0.15s;
}

.action-btn svg {
  display: block;
}

.action-btn:hover {
  background: var(--surface-tertiary, rgba(0, 0, 0, 0.1));
}

.delete-btn:hover {
  background: var(--color-error);
  color: white;
}

.section-divider {
  height: var(--border-width-thin);
  background: var(--border-primary);
}

.add-section {
  background: var(--surface-secondary);
}

.add-item {
  color: var(--color-primary);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.add-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.add-icon svg {
  display: block;
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
