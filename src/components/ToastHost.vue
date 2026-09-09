<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { toasts, dismissToast } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.type}`"
          @click="dismissToast(toast.id)"
        >
          {{ toast.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: var(--space-4);
  right: var(--space-4);
  z-index: 10002;
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-2);
  max-width: 420px;
}

.toast {
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-thick) solid var(--border-primary);
  background: var(--surface-primary);
  color: var(--text-primary);
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  white-space: pre-line;
}

.toast-error {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

/* Transition */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
