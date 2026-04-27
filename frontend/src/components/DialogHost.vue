<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useDialog } from '../composables/useDialog'

const { active, respond } = useDialog()

const inputValue = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// Reset input when a new prompt dialog opens
watch(active, async (dialog) => {
  if (dialog?.type === 'prompt') {
    inputValue.value = dialog.defaultValue
    await nextTick()
    inputRef.value?.select()
  }
})

const handleConfirm = () => {
  if (active.value?.type === 'prompt') {
    respond(inputValue.value.trim() || null)
  } else {
    respond(true)
  }
}

const handleCancel = () => {
  if (active.value?.type === 'prompt') {
    respond(null)
  } else {
    respond(false)
  }
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') handleCancel()
  if (e.key === 'Enter' && active.value?.type === 'confirm') handleConfirm()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="active"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        @click.self="handleCancel"
        @keydown="handleKeydown"
      >
        <div class="dialog">
          <p class="dialog-message">{{ active.message }}</p>

          <input
            v-if="active.type === 'prompt'"
            ref="inputRef"
            v-model="inputValue"
            class="dialog-input"
            @keydown.enter="handleConfirm"
          />

          <div class="dialog-actions">
            <button class="dialog-btn dialog-btn-cancel" @click="handleCancel">Cancel</button>
            <button class="dialog-btn dialog-btn-confirm" @click="handleConfirm">OK</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  padding: var(--space-5);
  min-width: 340px;
  max-width: 460px;
}

.dialog-message {
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body);
  line-height: var(--line-height-normal);
  color: var(--text-primary);
  margin-bottom: var(--space-4);
  white-space: pre-line;
}

.dialog-input {
  width: 100%;
  padding: var(--input-padding);
  border: var(--input-border-width) solid var(--border-primary);
  border-radius: var(--input-border-radius);
  font-family: var(--font-family-ui);
  font-size: var(--input-font-size);
  background: var(--surface-primary);
  color: var(--text-primary);
  margin-bottom: var(--space-4);
  outline: none;
}

.dialog-input:focus {
  border-color: var(--color-accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.dialog-btn {
  padding: var(--button-padding);
  border: var(--button-border-width) solid var(--border-primary);
  border-radius: var(--button-border-radius);
  font-family: var(--font-family-ui);
  font-size: var(--button-font-size);
  cursor: pointer;
}

.dialog-btn-cancel {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.dialog-btn-cancel:hover {
  background: var(--surface-tertiary);
}

.dialog-btn-confirm {
  background: var(--surface-inverse);
  color: var(--text-inverse);
}

.dialog-btn-confirm:hover {
  opacity: 0.85;
}

/* Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-active .dialog,
.modal-fade-leave-active .dialog {
  transition: transform 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .dialog {
  transform: scale(0.95);
}

.modal-fade-leave-to .dialog {
  transform: scale(0.95);
}
</style>
