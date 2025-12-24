<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps({
  modelValue: { type: String, default: '' },
  height: { type: Number, default: 150 }
})

const emit = defineEmits(['update:modelValue', 'run'])

const editorRef = ref(null)
let editorView = null

// Opinionated font theme using JetBrains Mono
const fontTheme = EditorView.theme({
  '&': {
    fontFamily: '"JetBrains Mono", monospace',
  },
  '.cm-content, .cm-line': {
    fontFamily: '"JetBrains Mono", monospace',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", monospace',
  },
})

onMounted(() => {
  // Keyboard shortcut for running query
  const runShortcut = EditorView.domEventHandlers({
    keydown(event, view) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        emit('run')
        return true
      }
      return false
    }
  })

  // Initialize CodeMirror
  editorView = new EditorView({
    extensions: [
      basicSetup,
      sql(),
      oneDark,
      fontTheme,
      EditorView.lineWrapping,
      runShortcut,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      })
    ],
    parent: editorRef.value,
    doc: props.modelValue
  })
})

onUnmounted(() => {
  if (editorView) {
    editorView.destroy()
  }
})

// Expose method to get current query text
defineExpose({
  getQuery: () => editorView?.state.doc.toString() || ''
})
</script>

<template>
  <div
    ref="editorRef"
    class="query-editor"
    :style="{ height: `${height}px` }"
  ></div>
</template>

<style scoped>
.query-editor {
  overflow: auto;
  cursor: text;
  flex-shrink: 0;
}

.query-editor :deep(.cm-editor) {
  height: 100%;
  cursor: text;
}

.query-editor :deep(.cm-scroller) {
  overflow: auto;
  cursor: text;
}

.query-editor :deep(.cm-content) {
  cursor: text;
}
</style>
