<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue'
import { getShortcutsByCategory, CATEGORY_ORDER } from '../constants/keyboardShortcuts'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const shortcutsByCategory = getShortcutsByCategory()

// Prevent body scroll when modal is open
watch(() => props.show, (isShowing) => {
  if (isShowing) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

// Close on Escape key
const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        @click.self="emit('close')"
      >
        <div class="shortcuts-modal">
          <!-- Header -->
          <div class="modal-header">
            <h1 id="shortcuts-title">Keyboard shortcuts</h1>
            <button
              class="close-button"
              aria-label="Close"
              @click="emit('close')"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <!-- Shortcuts List -->
          <div class="shortcuts-content">
            <div
              v-for="category in CATEGORY_ORDER"
              :key="category"
              class="shortcut-category"
            >
              <h2 class="category-title">{{ category }}</h2>
              <div class="shortcuts-list">
                <div
                  v-for="shortcut in shortcutsByCategory.get(category)"
                  :key="shortcut.id"
                  class="shortcut-row"
                >
                  <span class="shortcut-name">{{ shortcut.name }}</span>
                  <span class="shortcut-keys">
                    <kbd v-for="(key, idx) in shortcut.keys" :key="idx">{{ key }}</kbd>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Uses global .modal-overlay from style.css */

.shortcuts-modal {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: var(--border-radius-md);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.modal-header h1 {
  font-size: var(--font-size-body-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.close-button:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.shortcuts-content {
  padding: var(--space-4) var(--space-5);
}

.shortcut-category {
  margin-bottom: var(--space-5);
}

.shortcut-category:last-child {
  margin-bottom: 0;
}

.category-title {
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--space-3) 0;
}

.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) 0;
}

.shortcut-name {
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
}

.shortcut-keys {
  display: flex;
  gap: var(--space-1);
}

.shortcut-keys kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 var(--space-2);
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-primary);
  border-radius: var(--border-radius-sm);
  font-family: var(--font-family-ui);
  font-size: var(--font-size-caption);
  font-weight: 500;
  color: var(--text-primary);
  box-shadow: 0 1px 0 var(--border-primary);
}

/* Transition animations */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-active .shortcuts-modal,
.modal-fade-leave-active .shortcuts-modal {
  transition: transform 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .shortcuts-modal {
  transform: scale(0.95);
}

.modal-fade-leave-to .shortcuts-modal {
  transform: scale(0.95);
}
</style>
