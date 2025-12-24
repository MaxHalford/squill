<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql } from '@codemirror/lang-sql'

const props = defineProps({
  modelValue: { type: String, default: '' },
  height: { type: Number, default: 150 },
  isRunning: { type: Boolean, default: false },
  isAuthenticated: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'run'])

const editorRef = ref(null)
let editorView = null

// Retro light theme
const retroTheme = EditorView.theme({
  '&': {
    backgroundColor: 'white',
    color: 'black',
    fontFamily: '"JetBrains Mono", monospace',
  },
  '.cm-content': {
    caretColor: 'black',
    fontFamily: '"JetBrains Mono", monospace',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'black',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#d7d7d7',
  },
  '.cm-activeLine': {
    backgroundColor: '#f5f5f5',
  },
  '.cm-gutters': {
    backgroundColor: 'white',
    color: '#999',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#f5f5f5',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", monospace',
  },
  '.cm-line': {
    fontFamily: '"JetBrains Mono", monospace',
  },
}, { dark: false })

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
      retroTheme,
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
    class="query-editor-wrapper"
    :style="{ height: `${height}px` }"
    @mousedown.stop
  >
    <div
      ref="editorRef"
      class="query-editor"
    ></div>
    <button
      @click.stop="emit('run')"
      :disabled="isRunning || !isAuthenticated"
      class="run-button"
      :title="isAuthenticated ? 'Run query (Ctrl + Enter)' : 'Upload credentials in sidebar first'"
    >
      {{ isRunning ? '...' : '▶' }}
    </button>
  </div>
</template>

<style scoped>
.query-editor-wrapper {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.query-editor {
  height: 100%;
  overflow: auto;
  cursor: text;
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

.run-button {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: white;
  color: black;
  border: 1px solid black;
  padding: 4px 10px;
  border-radius: 0;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: none;
  line-height: 1;
  z-index: 10;
}

.run-button:hover:not(:disabled) {
  background: #f0f0f0;
}

.run-button:disabled {
  background: #ccc;
  color: #666;
  border-color: #999;
  cursor: not-allowed;
}
</style>
