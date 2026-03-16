<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import type { ChangelogEntry } from '../data/changelog'

const props = defineProps<{
  show: boolean
  entries: ChangelogEntry[]
}>()

const emit = defineEmits<{
  close: []
}>()

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const renderMarkdown = (content: string): string => {
  return marked(content) as string
}

watch(() => props.show, (isShowing) => {
  if (isShowing) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

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
        aria-labelledby="whats-new-title"
        @click.self="emit('close')"
      >
        <div class="whats-new-modal">
          <div class="modal-header">
            <h1 id="whats-new-title">
              What's new
            </h1>
            <button
              class="close-button"
              aria-label="Close"
              @click="emit('close')"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="whats-new-content">
            <article
              v-for="entry in entries"
              :key="entry.date"
              class="changelog-entry"
            >
              <time class="entry-date">{{ formatDate(entry.date) }}</time>
              <div
                class="entry-content markdown-content"
                v-html="renderMarkdown(entry.content)"
              />
            </article>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.whats-new-modal {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 520px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  border-radius: var(--border-radius-md);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  position: sticky;
  top: 0;
  background: var(--surface-primary);
  z-index: 1;
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

.whats-new-content {
  padding: var(--space-4) var(--space-5);
}

.changelog-entry {
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.changelog-entry:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.entry-date {
  display: block;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.05em;
  margin-bottom: var(--space-2);
}

.entry-content {
  color: var(--text-primary);
  line-height: 1.6;
}

.markdown-content :deep(p) {
  margin-bottom: var(--space-2);
  color: var(--text-secondary);
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: var(--space-2);
  padding-left: var(--space-5);
  color: var(--text-secondary);
}

.markdown-content :deep(li) {
  margin-bottom: var(--space-1);
}

.markdown-content :deep(a) {
  color: var(--accent-primary);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(code) {
  background: var(--surface-secondary);
  padding: 2px 6px;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

/* Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-active .whats-new-modal,
.modal-fade-leave-active .whats-new-modal {
  transition: transform 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .whats-new-modal {
  transform: scale(0.95);
}

.modal-fade-leave-to .whats-new-modal {
  transform: scale(0.95);
}
</style>
