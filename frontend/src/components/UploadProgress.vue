<script setup lang="ts">
defineProps<{
  files: string[]
  currentIndex: number
}>()
</script>

<template>
  <Transition name="slide">
    <div
      v-if="files.length > 0"
      class="upload-progress"
    >
      <div class="progress-bar">
        <div class="progress-bar-indeterminate" />
      </div>
      <div class="progress-info">
        <span class="progress-text">
          Importing {{ files[currentIndex] }}
          <span
            v-if="files.length > 1"
            class="progress-count"
          >
            ({{ currentIndex + 1 }}/{{ files.length }})
          </span>
        </span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.upload-progress {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--surface-primary);
  border-top: var(--border-width-thin) solid var(--border-primary);
  z-index: 10000;
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.progress-bar {
  height: 4px;
  background: var(--surface-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-indeterminate {
  height: 100%;
  width: 30%;
  background: var(--color-accent);
  border-radius: 2px;
  animation: indeterminate 1.5s ease-in-out infinite;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-text {
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
}

.progress-count {
  color: var(--text-secondary);
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
