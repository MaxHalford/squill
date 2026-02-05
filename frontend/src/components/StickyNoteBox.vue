<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import BaseBox from './BaseBox.vue'

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 400 },
  initialHeight: { type: Number, default: 300 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialContent: { type: String, default: '' },
  initialName: { type: String, default: 'Note' }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'update:content'])

const noteContent = ref(props.initialContent)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

// Watch for prop changes (e.g., when loading from localStorage)
let isUpdatingFromProp = false
watch(() => props.initialContent, (newContent) => {
  isUpdatingFromProp = true
  noteContent.value = newContent
  setTimeout(() => { isUpdatingFromProp = false }, 0)
})

// Emit content changes to parent for persistence (debounced)
let contentTimeout: ReturnType<typeof setTimeout> | null = null
watch(noteContent, (newContent) => {
  if (isUpdatingFromProp) return

  if (contentTimeout) clearTimeout(contentTimeout)
  contentTimeout = setTimeout(() => {
    emit('update:content', newContent)
  }, 500)

  // Check if we need to grow the box
  nextTick(checkOverflow)
})

// Auto-grow box when content overflows
const checkOverflow = () => {
  const textarea = textareaRef.value
  const content = contentRef.value
  if (!textarea || !content) return

  // Check if text is overflowing
  const isOverflowing = textarea.scrollHeight > textarea.clientHeight

  if (isOverflowing) {
    // Calculate how much extra height we need
    const extraHeight = textarea.scrollHeight - textarea.clientHeight
    const newHeight = props.initialHeight + extraHeight + 20 // 20px buffer

    emit('update:size', {
      width: props.initialWidth,
      height: Math.max(props.initialHeight, newHeight)
    })
  }
}

// Set up resize observer to handle external size changes
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (contentRef.value) {
    resizeObserver = new ResizeObserver(() => {
      // Container size changed, font will auto-scale via CSS cqi units
    })
    resizeObserver.observe(contentRef.value)
  }

  // Auto-focus textarea if box is selected on mount (i.e., newly created)
  if (props.isSelected && textareaRef.value) {
    nextTick(() => {
      textareaRef.value?.focus()
    })
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    :show-header-name="false"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div ref="contentRef" class="sticky-note-content">
      <textarea
        ref="textareaRef"
        v-model="noteContent"
        class="note-textarea"
        placeholder="Write your notes here..."
        spellcheck="false"
      ></textarea>
    </div>
  </BaseBox>
</template>

<style scoped>
/* Override header styling for sticky note look */
:deep(.box-header) {
  background: var(--sticky-note-border);
  color: var(--sticky-note-text);
}

:deep(.box-header .header-btn) {
  color: var(--sticky-note-text);
  opacity: 0.7;
}

:deep(.box-header .header-btn:hover) {
  background: var(--sticky-note-bg);
  color: var(--sticky-note-text);
  opacity: 1;
}

:deep(.box-header .header-btn.delete-btn:hover) {
  background: var(--color-error);
  color: white;
}

/* Override box border and background */
:deep(.resizable-box) {
  border-color: var(--sticky-note-border);
  background: var(--sticky-note-bg);
}

.sticky-note-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: var(--space-3);
  background: var(--sticky-note-bg);
  /* Enable container queries for responsive font sizing */
  container-type: size;
}

.note-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Patrick Hand SC', cursive;
  /* Font size scales with container width */
  font-size: clamp(16px, 20cqi, 72px);
  line-height: 1.1;
  color: var(--sticky-note-text);
  background: transparent;
  padding: 0;
  font-variant-ligatures: none;
}

.note-textarea::placeholder {
  color: var(--sticky-note-text);
  opacity: 0.6;
}

.note-textarea:focus {
  outline: none;
}
</style>
