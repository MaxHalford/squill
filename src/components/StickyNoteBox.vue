<script setup lang="ts">
import { ref, watch } from 'vue'
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
    <div class="sticky-note-content">
      <textarea
        v-model="noteContent"
        class="note-textarea"
        placeholder="Write your notes here..."
      ></textarea>
    </div>
  </BaseBox>
</template>

<style scoped>
.sticky-note-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--space-3);
  background: var(--surface-primary);
}

.note-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Comic Sans MS', 'Marker Felt', 'Bradley Hand', cursive;
  font-size: 30px;
  line-height: 1.6;
  color: var(--text-primary);
  background: transparent;
  padding: 0;
}

.note-textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.note-textarea:focus {
  outline: none;
}
</style>
