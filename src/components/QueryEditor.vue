<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql, SQLDialect } from '@codemirror/lang-sql'
import { autocompletion } from '@codemirror/autocomplete'

const props = defineProps({
  modelValue: { type: String, default: '' },
  height: { type: Number, default: 150 },
  isRunning: { type: Boolean, default: false },
  isAuthenticated: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'run', 'stop'])

const editorRef = ref(null)
let editorView = null

// Timer for query execution
const elapsedTime = ref(0)
let timerInterval = null

// Watch isRunning to start/stop timer
watch(() => props.isRunning, (running) => {
  if (running) {
    elapsedTime.value = 0
    timerInterval = setInterval(() => {
      elapsedTime.value += 0.1
    }, 100)
  } else {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }
})

// Retro light theme
const retroTheme = EditorView.theme({
  '&': {
    backgroundColor: 'white',
    color: 'black',
    fontFamily: 'var(--font-family-mono)',
    textAlign: 'left',
  },
  '.cm-content': {
    caretColor: 'black',
    fontFamily: 'var(--font-family-mono)',
    textAlign: 'left',
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
    fontFamily: 'var(--font-family-mono)',
    textAlign: 'left',
  },
  '.cm-line': {
    fontFamily: 'var(--font-family-mono)',
    textAlign: 'left',
  },
  '.cm-tooltip-autocomplete': {
    backgroundColor: 'white',
    border: '1px solid black',
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#d7d7d7',
    color: 'black',
  },
}, { dark: false })

// Custom SQL completion source with uppercase keywords
const uppercaseKeywords = (context) => {
  const word = context.matchBefore(/\w*/)
  if (!word) return null
  if (word.from === word.to && !context.explicit) return null

  // Common SQL keywords in uppercase
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS',
    'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL',
    'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER',
    'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'UNION', 'ALL', 'EXCEPT', 'INTERSECT',
    'WITH', 'RECURSIVE', 'CAST', 'EXISTS',
    'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
    'TRUE', 'FALSE', 'ARRAY', 'STRUCT',
    'INT64', 'FLOAT64', 'STRING', 'BOOL', 'DATE', 'TIMESTAMP', 'DATETIME',
    'UNNEST', 'ARRAY_AGG', 'STRING_AGG',
    'PARTITION', 'OVER', 'ROWS', 'RANGE', 'WINDOW',
    'EXTRACT', 'DATE_TRUNC', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'
  ]

  const options = keywords.map(keyword => ({
    label: keyword,
    type: 'keyword',
    apply: keyword + ' ',
    boost: keyword.toLowerCase().startsWith(word.text.toLowerCase()) ? 1 : 0
  }))

  return {
    from: word.from,
    options: options.filter(opt => opt.boost > 0 || context.explicit),
    validFor: /^\w*$/
  }
}

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
      sql({
        upperCaseKeywords: true,
        dialect: SQLDialect.define({})
      }),
      autocompletion({
        override: [uppercaseKeywords],
        activateOnTyping: true,
        maxRenderedOptions: 20,
        closeOnBlur: true
      }),
      retroTheme,
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
  if (timerInterval) {
    clearInterval(timerInterval)
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
  >
    <div
      ref="editorRef"
      class="query-editor"
    ></div>
    <button
      @click.stop="isRunning ? emit('stop') : emit('run')"
      :disabled="!isAuthenticated"
      class="run-button"
      :title="isRunning ? 'Stop query' : (isAuthenticated ? 'Run query (Ctrl + Enter)' : 'Upload credentials in sidebar first')"
    >
      <span v-if="isRunning">■ {{ elapsedTime.toFixed(1) }}s</span>
      <span v-else>▶</span>
    </button>
  </div>
</template>

<style scoped>
.query-editor-wrapper {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  cursor: text;
  user-select: text;
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
  bottom: var(--space-2);
  right: var(--space-2);
  background: var(--surface-primary);
  color: var(--text-primary);
  border: none;
  padding: var(--button-padding);
  border-radius: var(--button-border-radius);
  font-size: var(--button-font-size);
  font-family: var(--font-family-mono);
  cursor: pointer;
  transition: none;
  line-height: 1;
  z-index: 10;
  outline: none;
  text-align: center;
}

.run-button:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.run-button:focus {
  outline: none;
}

.run-button:disabled {
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
