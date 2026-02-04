<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { EditorView } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { Compartment, StateField, StateEffect, RangeSet } from '@codemirror/state'
import { Decoration, WidgetType, tooltips, lineNumbers, highlightActiveLineGutter, drawSelection, dropCursor, highlightSpecialChars, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, acceptCompletion } from '@codemirror/autocomplete'
import { schemaCompletionSource } from '@codemirror/lang-sql'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { getCodeMirrorDialect, type SqlDialect } from '../utils/sqlDialects'
import { boostedSqlKeywords, filterExactMatches } from '../utils/sqlKeywordCompletions'
import { useSettingsStore } from '../stores/settings'
import { useBigQueryStore, type DryRunResult } from '../stores/bigquery'
import { createTableLinkExtension } from '../utils/tableLinkExtension'
import { attachTooltip } from '../directives/tooltip'
import type { TableReferenceWithPosition } from '../utils/queryAnalyzer'

// Types for error suggestions
interface LineSuggestion {
  line: number // 1-indexed line number
  original: string
  suggestion: string
  action?: 'replace' | 'insert'
  message?: string
}

interface SchemaTable {
  [tableName: string]: string[]
}

const props = defineProps<{
  modelValue?: string
  height?: number
  isRunning?: boolean
  disabled?: boolean
  dialect?: 'bigquery' | 'duckdb' | 'postgres'
  schema?: SchemaTable
  suggestion?: LineSuggestion | null
  connectionType?: 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'
  connectionId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'run': []
  'stop': []
  'accept-suggestion': []
  'dismiss-suggestion': []
  'navigate-to-table': [ref: TableReferenceWithPosition]
  'ready': []
}>()

const settingsStore = useSettingsStore()
const bigqueryStore = useBigQueryStore()

const editorRef = ref<HTMLElement | null>(null)
const editorView = ref<EditorView | null>(null)

// Dry run state for cost estimation
const dryRunResult = ref<DryRunResult | null>(null)
const isDryRunLoading = ref(false)
let dryRunDebounceTimer: ReturnType<typeof setTimeout> | null = null
let lastDryRunQuery = ''

// Trigger dry run on hover (debounced)
const triggerDryRun = () => {
  // Only for BigQuery connections
  if (props.connectionType !== 'bigquery' || !props.connectionId) return

  const query = editorView.value?.state.doc.toString() || ''
  if (!query.trim()) {
    dryRunResult.value = null
    return
  }

  // Skip if query hasn't changed since last dry run
  if (query === lastDryRunQuery && dryRunResult.value) return

  // Clear existing timer
  if (dryRunDebounceTimer) {
    clearTimeout(dryRunDebounceTimer)
  }

  // Debounce the dry run request
  isDryRunLoading.value = true
  dryRunDebounceTimer = setTimeout(async () => {
    try {
      const result = await bigqueryStore.dryRunQuery(query, props.connectionId)
      dryRunResult.value = result
      lastDryRunQuery = query
    } catch {
      dryRunResult.value = null
    } finally {
      isDryRunLoading.value = false
    }
  }, 300)
}

// Computed tooltip for run button
const runButtonTooltip = computed(() => {
  const base = 'Run query (⌘⏎)'

  if (props.disabled) return 'Loading database...'
  if (props.isRunning) return 'Stop query'

  // Only show cost for BigQuery
  if (props.connectionType !== 'bigquery') return base

  if (isDryRunLoading.value) {
    return `${base}\nEstimating cost...`
  }

  if (dryRunResult.value) {
    if (dryRunResult.value.error) {
      return `${base}\n⚠️ Query error`
    }
    return `${base}\n~${dryRunResult.value.totalBytesProcessed} • ${dryRunResult.value.estimatedCost}`
  }

  return base
})

const languageCompartment = new Compartment()
const lineNumbersCompartment = new Compartment()
const autocompleteCompartment = new Compartment()
const fontSizeCompartment = new Compartment()

// Create a dynamic font size extension
const fontSizeExtension = (size: number) => EditorView.theme({
  '&': { fontSize: `${size}px` },
  '.cm-content': { fontSize: `${size}px` },
  '.cm-gutters': { fontSize: `${size}px` },
})

// State effect to set suggestions
const setSuggestions = StateEffect.define<LineSuggestion | null>()

// Widget to display the suggested fix below the error line
class SuggestionWidget extends WidgetType {
  private cleanups: (() => void)[] = []

  constructor(readonly suggestion: LineSuggestion) {
    super()
  }

  toDOM() {
    const wrapper = document.createElement('div')
    const isInsert = this.suggestion.action === 'insert'
    wrapper.className = isInsert ? 'cm-suggestion-line cm-suggestion-insert' : 'cm-suggestion-line'

    // For replace: preserve indentation from original line
    // For insert: use the suggestion as-is
    const displayText = isInsert
      ? this.suggestion.suggestion
      : (this.suggestion.original.match(/^(\s*)/)?.[1] || '') + this.suggestion.suggestion.trimStart()

    const content = document.createElement('span')
    content.className = 'cm-suggestion-content'
    content.textContent = displayText

    const actions = document.createElement('span')
    actions.className = 'cm-suggestion-actions'

    const acceptBtn = document.createElement('button')
    acceptBtn.className = 'cm-suggestion-btn accept'
    acceptBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    acceptBtn.onclick = (e) => {
      e.stopPropagation()
      wrapper.dispatchEvent(new CustomEvent('suggestion-accept', { bubbles: true }))
    }
    this.cleanups.push(attachTooltip(acceptBtn, { text: 'Accept fix (⌘⏎)', position: 'bottom' }))

    const dismissBtn = document.createElement('button')
    dismissBtn.className = 'cm-suggestion-btn dismiss'
    dismissBtn.title = 'Dismiss (Esc)'
    dismissBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    dismissBtn.onclick = (e) => {
      e.stopPropagation()
      wrapper.dispatchEvent(new CustomEvent('suggestion-dismiss', { bubbles: true }))
    }
    this.cleanups.push(attachTooltip(dismissBtn, { text: 'Dismiss (Esc)', position: 'bottom' }))

    actions.appendChild(acceptBtn)
    actions.appendChild(dismissBtn)

    wrapper.appendChild(content)
    wrapper.appendChild(actions)
    return wrapper
  }

  eq(other: SuggestionWidget) {
    return (
      other.suggestion.line === this.suggestion.line &&
      other.suggestion.suggestion === this.suggestion.suggestion
    )
  }

  destroy() {
    this.cleanups.forEach(fn => fn())
    this.cleanups = []
  }

  ignoreEvent() {
    return false
  }
}

// State field to manage suggestion decorations
const suggestionField = StateField.define<{
  suggestion: LineSuggestion | null
  decorations: RangeSet<Decoration>
}>({
  create() {
    return { suggestion: null, decorations: Decoration.none }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestions)) {
        const suggestion = effect.value
        if (!suggestion) {
          return { suggestion: null, decorations: Decoration.none }
        }

        const decorations: { from: number; to: number; decoration: Decoration }[] = []
        const lineNum = suggestion.line
        const isInsert = suggestion.action === 'insert'
        const totalLines = tr.state.doc.lines

        if (isInsert) {
          // Insert: show widget at the insertion point, no error highlight
          let anchorPos: number
          if (lineNum <= 1) {
            // Insert at the very beginning
            anchorPos = 0
          } else if (lineNum <= totalLines) {
            // Insert before lineNum → attach after the previous line
            anchorPos = tr.state.doc.line(lineNum - 1).to
          } else {
            // Insert at end of document
            anchorPos = tr.state.doc.length
          }

          decorations.push({
            from: anchorPos,
            to: anchorPos,
            decoration: Decoration.widget({
              widget: new SuggestionWidget(suggestion),
              block: true,
              side: 1,
            }),
          })
        } else if (lineNum >= 1 && lineNum <= totalLines) {
          // Replace: highlight the existing line and show widget after it
          const line = tr.state.doc.line(lineNum)

          // Error line decoration (red background)
          decorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-error-line' }),
          })

          // Suggestion widget after the line (green background)
          decorations.push({
            from: line.to,
            to: line.to,
            decoration: Decoration.widget({
              widget: new SuggestionWidget(suggestion),
              block: true,
              side: 1,
            }),
          })
        }

        decorations.sort((a, b) => a.from - b.from)
        return {
          suggestion,
          decorations: Decoration.set(decorations.map((d) => d.decoration.range(d.from, d.to))),
        }
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
})

// Theme for error/suggestion styling
const suggestionTheme = EditorView.theme({
  '.cm-error-line': {
    backgroundColor: 'var(--color-error-bg)',
    boxShadow: 'inset 3px 0 0 var(--color-error)',
  },
  '.cm-suggestion-line': {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'var(--color-success-bg)',
    boxShadow: 'inset 3px 0 0 var(--color-success)',
  },
  '.cm-suggestion-content': {
    flex: '1',
    color: 'var(--color-success)',
    paddingLeft: '6px',
  },
  '.cm-suggestion-insert .cm-suggestion-content::before': {
    content: '"+ "',
    opacity: '0.6',
  },
  '.cm-suggestion-actions': {
    display: 'flex',
    gap: '2px',
    paddingRight: '4px',
  },
  '.cm-suggestion-btn': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    padding: '0',
    border: 'none',
    borderRadius: '3px',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
  },
  '.cm-suggestion-btn:hover': {
    background: 'var(--surface-tertiary)',
  },
  '.cm-suggestion-btn.accept:hover': {
    color: 'var(--color-success)',
  },
  '.cm-suggestion-btn.dismiss:hover': {
    color: 'var(--color-error)',
  },
})

// Custom SQL highlight style that adapts to light/dark mode via CSS variables
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.special(tags.string), color: 'var(--syntax-string)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-number)' },
  { tag: tags.null, color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--syntax-punctuation)' },
  { tag: tags.bracket, color: 'var(--syntax-punctuation)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.propertyName, color: 'var(--syntax-property)' },
  { tag: tags.variableName, color: 'var(--text-primary)' },
])

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
    color: 'var(--text-primary)',
    paddingTop: '2px',
    paddingBottom: '2px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-tooltip-autocomplete': {
    fontFamily: 'var(--font-family-mono)',
    background: 'var(--surface-primary)',
    border: '1px solid var(--border-primary)',
    boxShadow: 'var(--shadow-md)',
  },
  '.cm-completionIcon': {
    display: 'none',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    color: 'var(--text-primary)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--surface-secondary)',
    color: 'var(--text-primary)',
  },
  '.cm-completionLabel': {
    color: 'var(--text-primary)',
  },
  '.cm-completionMatchedText': {
    color: 'var(--color-accent)',
    textDecoration: 'none',
  },
  // Cursor styling - uses accent color
  '.cm-cursor, .cm-cursor-primary': {
    borderLeftColor: 'var(--color-accent)',
    borderLeftWidth: '2px'
  },
  // Selection styling - uses accent color
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--color-selection) !important'
  },
}, { dark: false })

const buildSQLExtension = (dialect: string, _schema: SchemaTable) => {
  // Get the CodeMirror dialect for syntax highlighting
  const sqlDialect = getCodeMirrorDialect(dialect as SqlDialect)
  // Don't pass schema to sql() - we'll handle completions separately
  const sqlLang = sql({ dialect: sqlDialect, upperCaseKeywords: true })

  return [sqlLang]
}

// Build completion sources with exact match filtering
const buildCompletionSources = (dialect: string, schema: SchemaTable, connectionType?: string) => {
  const sqlDialect = getCodeMirrorDialect(dialect as SqlDialect)

  // Wrap schema completions to filter out exact matches
  // We only use boostedSqlKeywords for keywords (not keywordCompletionSource) to avoid duplicates
  const filteredSchema = filterExactMatches(schemaCompletionSource({ dialect: sqlDialect, schema }))

  // Use connectionType for keyword completions (more specific, includes snowflake)
  const keywordDialect = (connectionType || dialect) as SqlDialect
  return [boostedSqlKeywords(keywordDialect), filteredSchema]
}

watch([() => props.dialect, () => props.schema, () => props.connectionType], ([newDialect, newSchema, newConnectionType]) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: [
        languageCompartment.reconfigure(
          buildSQLExtension(newDialect || 'bigquery', newSchema || {})
        ),
        autocompleteCompartment.reconfigure(
          autocompletion({
            override: buildCompletionSources(newDialect || 'bigquery', newSchema || {}, newConnectionType),
            filterStrict: true
          })
        )
      ]
    })
  }
}, { deep: true })

// Watch for line numbers setting changes
watch(() => settingsStore.showEditorLineNumbers, (show) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: lineNumbersCompartment.reconfigure(
        show ? [lineNumbers(), highlightActiveLineGutter()] : []
      )
    })
  }
})

// Watch for font size setting changes
watch(() => settingsStore.editorFontSize, (size) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: fontSizeCompartment.reconfigure(fontSizeExtension(size))
    })
  }
})

// Clear dry run result when query changes (to show fresh estimate on next hover)
watch(() => props.modelValue, () => {
  // Only reset if the query actually changed from what we estimated
  const currentQuery = editorView.value?.state.doc.toString() || ''
  if (currentQuery !== lastDryRunQuery) {
    dryRunResult.value = null
  }
})

// Watch for suggestion changes and update CodeMirror decorations
watch(() => props.suggestion, (newSuggestion) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: setSuggestions.of(newSuggestion || null)
    })

    // Scroll to center the suggestion line
    if (newSuggestion && newSuggestion.line >= 1) {
      const doc = editorView.value.state.doc
      const targetLine = Math.min(newSuggestion.line, doc.lines)
      const line = doc.line(targetLine)
      editorView.value.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
    }
  }
})

onMounted(() => {
  if (!editorRef.value) return

  const keyboardHandlers = EditorView.domEventHandlers({
    keydown(event, view) {
      // Escape dismisses suggestion if active, otherwise blurs editor
      if (event.key === 'Escape') {
        event.preventDefault()
        const state = view.state.field(suggestionField)
        if (state.suggestion) {
          emit('dismiss-suggestion')
        } else {
          view.contentDOM.blur()
        }
        return true
      }
      return false
    }
  })

  editorView.value = new EditorView({
    extensions: [
      // Custom setup without indentation handling or code folding
      lineNumbersCompartment.of(settingsStore.showEditorLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
      fontSizeCompartment.of(fontSizeExtension(settingsStore.editorFontSize)),
      highlightSpecialChars(),
      history(),
      drawSelection({ cursorBlinkRate: 0 }),
      dropCursor(),
      syntaxHighlighting(sqlHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompleteCompartment.of(
        autocompletion({
          override: buildCompletionSources(props.dialect || 'bigquery', props.schema || {}, props.connectionType),
          filterStrict: true
        })
      ),
      highlightSelectionMatches(),
      indentUnit.of(' '), // Two space indent unit
      keymap.of([
        // Mod-Enter (Cmd/Ctrl+Enter) runs query or accepts suggestion
        {
          key: 'Mod-Enter',
          run: (view) => {
            if (!props.disabled) {
              const state = view.state.field(suggestionField)
              if (state.suggestion) {
                emit('accept-suggestion')
              } else {
                emit('run')
              }
            }
            return true
          }
        },
        // Override Enter to insert plain newline without auto-indent
        { key: 'Enter', run: insertNewline },
        // Tab: accept autocomplete if open, otherwise insert 2 spaces
        {
          key: 'Tab',
          run: (view) => {
            // First try to accept autocomplete
            if (acceptCompletion(view)) {
              return true
            }
            // Otherwise insert 2 spaces
            view.dispatch({
              changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: '  ' },
              selection: { anchor: view.state.selection.main.from + 2 }
            })
            return true
          }
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
      ]),
      languageCompartment.of(buildSQLExtension(props.dialect || 'bigquery', props.schema || {})),
      editorTheme,
      suggestionField,
      suggestionTheme,
      keyboardHandlers,
      createTableLinkExtension((ref) => emit('navigate-to-table', ref)),
      tooltips({ parent: document.body }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      })
    ],
    parent: editorRef.value,
    doc: props.modelValue || ''
  })

  // Listen for suggestion button clicks
  editorRef.value?.addEventListener('suggestion-accept', () => emit('accept-suggestion'))
  editorRef.value?.addEventListener('suggestion-dismiss', () => emit('dismiss-suggestion'))

  // Signal that editor is ready
  emit('ready')
})

onUnmounted(() => {
  editorView.value?.destroy()
  if (timerInterval) clearInterval(timerInterval)
  if (dryRunDebounceTimer) clearTimeout(dryRunDebounceTimer)
})

// Accept the current suggestion by replacing or inserting a line
const acceptSuggestion = () => {
  if (!editorView.value || !props.suggestion) return

  const doc = editorView.value.state.doc
  const lineNum = props.suggestion.line
  const isInsert = props.suggestion.action === 'insert'

  if (lineNum < 1) return

  if (isInsert) {
    // Insert a new line at the given position
    let insertText: string
    let insertPos: number

    if (lineNum <= doc.lines) {
      // Insert before existing line — add text + newline at line start
      insertPos = doc.line(lineNum).from
      insertText = props.suggestion.suggestion + '\n'
    } else {
      // Insert at end of document
      insertPos = doc.length
      insertText = '\n' + props.suggestion.suggestion
    }

    editorView.value.dispatch({
      changes: { from: insertPos, to: insertPos, insert: insertText },
      effects: setSuggestions.of(null),
    })
  } else {
    // Replace: swap existing line content
    if (lineNum > doc.lines) return

    const line = doc.line(lineNum)
    const leadingWhitespace = props.suggestion.original.match(/^(\s*)/)?.[1] || ''

    editorView.value.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: leadingWhitespace + props.suggestion.suggestion.trimStart(),
      },
      effects: setSuggestions.of(null),
    })
  }
}

defineExpose({
  getQuery: () => editorView.value?.state.doc.toString() || '',
  focus: () => {
    if (editorView.value) {
      editorView.value.focus()
      return true
    }
    return false
  },
  acceptSuggestion,
})
</script>

<template>
  <div class="query-editor-wrapper" :style="{ height: `${height || 150}px` }">
    <div ref="editorRef" class="query-editor" />

    <button
      class="run-btn"
      :disabled="disabled"
      v-tooltip="runButtonTooltip"
      @mouseenter="triggerDryRun"
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
  /* Strong containment: isolate from parent selection changes */
  contain: layout style paint;
}

.query-editor {
  height: 100%;
  overflow: hidden;
}

.query-editor :deep(.cm-editor) {
  height: 100%;
  overflow: hidden;
}

.query-editor :deep(.cm-scroller) {
  overflow: auto !important;
  scrollbar-width: none;
  scroll-behavior: smooth;
}

.query-editor :deep(.cm-scroller)::-webkit-scrollbar {
  display: none;
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
