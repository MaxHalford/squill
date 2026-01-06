<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql, PostgreSQL, schemaCompletionSource } from '@codemirror/lang-sql'
import { Compartment } from '@codemirror/state'
import { BigQueryDialect } from '../utils/bigQueryDialect'

interface SchemaTable {
  [tableName: string]: string[]
}

const props = defineProps<{
  modelValue?: string
  height?: number
  isRunning?: boolean
  isAuthenticated?: boolean
  dialect?: 'bigquery' | 'duckdb'
  schema?: SchemaTable
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'run': []
  'stop': []
}>()

const editorRef = ref<HTMLElement | null>(null)
const editorView = ref<EditorView | null>(null)

const languageCompartment = new Compartment()

// Timer for query execution
const elapsedTime = ref(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

watch(() => props.isRunning, (running) => {
  if (running) {
    elapsedTime.value = 0
    timerInterval = setInterval(() => {
      elapsedTime.value += 0.1
    }, 100)
  } else if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
})

// CodeMirror theme - values match CSS variables in style.css
const editorTheme = EditorView.theme({

  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-gutter-color)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-active-line-bg)',
  },
  '&': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-tooltip-autocomplete': {
    fontFamily: 'var(--font-family-mono)',
  },
}, { dark: false })

const buildSQLExtension = (dialect: string, schema: SchemaTable) => {
  const sqlDialect = dialect === 'duckdb' ? PostgreSQL : BigQueryDialect
  return [
    sql({ dialect: sqlDialect, upperCaseKeywords: true }),
    sqlDialect.language.data.of({
      autocomplete: schemaCompletionSource({ schema })
    })
  ]
}

watch([() => props.dialect, () => props.schema], ([newDialect, newSchema]) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: languageCompartment.reconfigure(
        buildSQLExtension(newDialect || 'bigquery', newSchema || {})
      )
    })
  }
}, { deep: true })

onMounted(() => {
  if (!editorRef.value) return

  const runShortcut = EditorView.domEventHandlers({
    keydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        emit('run')
        return true
      }
      return false
    }
  })

  editorView.value = new EditorView({
    extensions: [
      basicSetup,
      languageCompartment.of(buildSQLExtension(props.dialect || 'bigquery', props.schema || {})),
      editorTheme,
      runShortcut,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      })
    ],
    parent: editorRef.value,
    doc: props.modelValue || ''
  })
})

onUnmounted(() => {
  editorView.value?.destroy()
  if (timerInterval) clearInterval(timerInterval)
})

defineExpose({
  getQuery: () => editorView.value?.state.doc.toString() || '',
  focus: () => editorView.value?.focus()
})
</script>

<template>
  <div class="query-editor-wrapper" :style="{ height: `${height || 150}px` }">
    <div ref="editorRef" class="query-editor" />

    <button
      class="run-btn"
      :disabled="!isAuthenticated"
      :title="isRunning ? 'Stop query' : (isAuthenticated ? 'Run query (Ctrl+Enter)' : 'Upload credentials first')"
      @click.stop="isRunning ? emit('stop') : emit('run')"
    >
      <template v-if="isRunning">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
        <span class="elapsed">{{ elapsedTime.toFixed(1) }}s</span>
      </template>
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
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
}

.query-editor :deep(.cm-editor) {
  height: 100%;
}

.query-editor :deep(.cm-scroller) {
  overflow: auto;
}

/* Run Button */
.run-btn {
  position: absolute;
  bottom: var(--space-2);
  right: var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: var(--surface-primary);
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  line-height: 1;
  cursor: pointer;
  z-index: 1;
}

.run-btn:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.run-btn:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.5;
}

.elapsed {
  font-variant-numeric: tabular-nums;
}
</style>
