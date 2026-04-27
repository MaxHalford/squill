<script lang="ts">
// Types for error suggestions
export interface LineSuggestion {
  line: number // 1-indexed line number
  original: string
  suggestion: string
  action?: 'replace' | 'insert'
  message?: string
}
</script>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { EditorView } from 'codemirror'
import { sql } from '@codemirror/lang-sql'
import { Compartment, StateField, StateEffect, RangeSet, EditorState } from '@codemirror/state'
import { Decoration, WidgetType, tooltips, lineNumbers, drawSelection, dropCursor, highlightSpecialChars, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, acceptCompletion } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search'
import { getCodeMirrorDialect, type SqlDialect } from '../utils/sqlDialects'
import { boostedSqlKeywords, substringSchemaCompletions } from '../utils/sqlKeywordCompletions'
import { useSettingsStore } from '../stores/settings'
import { useBigQueryStore, type DryRunResult } from '../stores/bigquery'
import { createTableLinkExtension } from '../utils/tableLinkExtension'
import { attachTooltip } from '../directives/tooltip'
import { useSqlGlotStore, type SqlGlotError } from '../stores/sqlglot'
import { useUserStore } from '../stores/user'
import type { TableReferenceWithPosition } from '../utils/queryAnalyzer'
import type { SchemaNamespace } from '../utils/schemaBuilder'

const props = defineProps<{
  modelValue?: string
  height?: number
  isRunning?: boolean
  disabled?: boolean
  dialect?: 'bigquery' | 'duckdb' | 'postgres'
  schema?: SchemaNamespace
  suggestion?: LineSuggestion | null
  connectionType?: 'bigquery' | 'clickhouse' | 'duckdb' | 'mysql' | 'postgres' | 'snowflake'
  connectionId?: string
  explainDisabledReason?: string
  canExplode?: boolean
  isCastingSpell?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'run': []
  'stop': []
  'explain': [event: { clientX: number; clientY: number }]
  'explode': []
  'accept-suggestion': []
  'dismiss-suggestion': []
  'navigate-to-table': [ref: TableReferenceWithPosition]
  'ready': []
  'activate': []
  'cast-spell': [instruction: string, selectedText: string]
}>()

const settingsStore = useSettingsStore()
const bigqueryStore = useBigQueryStore()
const sqlglotStore = useSqlGlotStore()
const userStore = useUserStore()

const editorRef = ref<HTMLElement | null>(null)
const editorView = ref<EditorView | null>(null)

// Spell input state
const showSpellInput = ref(false)
const spellInstruction = ref('')
const spellInputRef = ref<HTMLTextAreaElement | null>(null)

// Casting starfield animation
const starFrames = ['.', '·', '+', '*', '✦', '*', '+', '·']
interface ScatteredStar {
  x: number
  y: number
  offset: number
  speed: number
}
const castingStars = ref<ScatteredStar[]>([])
const castingTick = ref(0)
let castingTimer: ReturnType<typeof setInterval> | null = null

function seedCastingStars() {
  castingStars.value = Array.from({ length: 12 + Math.floor(Math.random() * 6) }, () => ({
    x: 5 + Math.random() * 90,
    y: 5 + Math.random() * 90,
    offset: Math.floor(Math.random() * 8),
    speed: 0.3 + Math.random() * 0.4,
  }))
}

function starDisplay(star: ScatteredStar): string {
  const tick = star.offset + Math.floor(castingTick.value * 0.1 / star.speed)
  return starFrames[tick % starFrames.length]
}

watch(() => props.isCastingSpell, (casting) => {
  if (casting) {
    seedCastingStars()
    castingTick.value = 0
    castingTimer = setInterval(() => { castingTick.value++ }, 100)
  } else {
    if (castingTimer) { clearInterval(castingTimer); castingTimer = null }
    castingStars.value = []
  }
})

// Dry run state for cost estimation
const dryRunResult = ref<DryRunResult | null>(null)
const isDryRunLoading = ref(false)
let dryRunDebounceTimer: ReturnType<typeof setTimeout> | null = null
let lastDryRunQuery = ''

// SQLGlot error tooltip state
const hoveredError = ref<{ message: string; top: number } | null>(null)
let validateTimer: ReturnType<typeof setTimeout> | null = null

// Debounced SQLGlot validation
const triggerValidation = () => {
  if (!sqlglotStore.isReady) return
  if (validateTimer) clearTimeout(validateTimer)
  validateTimer = setTimeout(async () => {
    const view = editorView.value
    if (!view) return
    const query = view.state.doc.toString()
    if (!query.trim()) {
      view.dispatch({ effects: setSqlGlotErrors.of({ errors: [], doc: query }) })
      return
    }
    try {
      const dialect = props.connectionType || props.dialect || 'duckdb'
      const errors = await sqlglotStore.validate(query, dialect)
      // Only apply if the document hasn't changed since we started
      if (view.state.doc.toString() === query) {
        view.dispatch({ effects: setSqlGlotErrors.of({ errors, doc: query }) })
      }
    } catch {
      // Validation failed — silently ignore
    }
  }, 200)
}

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

// Format button handler
const justFormatted = ref(false)
const handleFormat = async () => {
  const view = editorView.value
  if (!view || !sqlglotStore.isReady) return
  const query = view.state.doc.toString()
  if (!query.trim()) return
  const dialect = props.connectionType || props.dialect || 'duckdb'
  try {
    const formatted = await sqlglotStore.format(query, dialect)
    if (formatted && formatted !== query) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted }
      })
    }
    justFormatted.value = true
    setTimeout(() => { justFormatted.value = false }, 2000)
  } catch {
    // Format failed — silently ignore
  }
}

// Spell input handlers
const toggleSpellInput = () => {
  if (!userStore.isPro) return
  showSpellInput.value = !showSpellInput.value
  spellInstruction.value = ''
  if (showSpellInput.value) {
    nextTick(() => spellInputRef.value?.focus())
  }
}

const submitSpell = () => {
  const instruction = spellInstruction.value.trim()
  if (!instruction) return
  const view = editorView.value
  const selectedText = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : ''
  emit('cast-spell', instruction, selectedText)
  showSpellInput.value = false
  spellInstruction.value = ''
}

const dismissSpellInput = () => {
  showSpellInput.value = false
  spellInstruction.value = ''
}

const handleSpellClickOutside = (e: MouseEvent) => {
  if (!showSpellInput.value) return
  const target = e.target as HTMLElement
  if (target.closest('.spell-input-wrapper') || target.closest('.wand-btn')) return
  dismissSpellInput()
}

const languageCompartment = new Compartment()
const lineNumbersCompartment = new Compartment()
const autocompleteCompartment = new Compartment()
const fontSizeCompartment = new Compartment()
const tableLinkCompartment = new Compartment()

// Create a dynamic font size extension
const fontSizeExtension = (size: number) => EditorView.theme({
  '&': { fontSize: `${size}px` },
  '.cm-content': { fontSize: `${size}px` },
  '.cm-gutters': { fontSize: `${size}px` },
})

// State effect to set suggestions
const setSuggestions = StateEffect.define<LineSuggestion | null>()

// SQLGlot error decorations — squiggly red underlines
const setSqlGlotErrors = StateEffect.define<{ errors: SqlGlotError[]; doc: string }>()

const sqlglotErrorField = StateField.define<{
  errors: SqlGlotError[]
  decorations: RangeSet<Decoration>
}>({
  create() {
    return { errors: [], decorations: Decoration.none }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSqlGlotErrors)) {
        const { errors } = effect.value
        if (errors.length === 0) {
          return { errors: [], decorations: Decoration.none }
        }

        const decorations: Array<{ from: number; to: number }> = []
        const doc = tr.state.doc

        for (const err of errors) {
          const lineNum = err.line
          if (lineNum < 1 || lineNum > doc.lines) continue

          const line = doc.line(lineNum)
          const col = err.col > 0 ? err.col - 1 : 0 // Convert 1-indexed to 0-indexed

          const from = Math.min(line.from + col, line.to)
          // If we have a highlight string, use its length for the span
          const highlightLen = err.highlight ? err.highlight.trim().length : 0
          const to = highlightLen > 0
            ? Math.min(from + highlightLen, line.to)
            : line.to // No highlight info — mark to end of line

          if (from < to) {
            decorations.push({ from, to })
          }
        }

        // Sort and deduplicate
        decorations.sort((a, b) => a.from - b.from || a.to - b.to)

        return {
          errors,
          decorations: Decoration.set(
            decorations.map(d =>
              Decoration.mark({ class: 'cm-sqlglot-error' }).range(d.from, d.to)
            )
          ),
        }
      }
    }
    // Map decorations through document changes
    if (tr.docChanged) {
      return { errors: value.errors, decorations: value.decorations.map(tr.changes) }
    }
    return value
  },
  provide: f => EditorView.decorations.from(f, v => v.decorations),
})

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

// Theme for SQLGlot error squiggly underlines
const sqlglotErrorTheme = EditorView.theme({
  '.cm-sqlglot-error': {
    textDecoration: 'underline',
    textDecorationColor: 'var(--color-error)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
  },
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


// CodeMirror theme - values match CSS variables in style.css
const editorTheme = EditorView.theme({

  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--editor-gutter-color)',
    border: 'none',
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
    textDecoration: 'none',
    backgroundColor: 'color-mix(in srgb, var(--color-warning) 25%, transparent)',
    borderRadius: '1px',
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

const buildSQLExtension = (dialect: string, _schema: SchemaNamespace) => {
  // Get the CodeMirror dialect for syntax highlighting
  const sqlDialect = getCodeMirrorDialect(dialect as SqlDialect)
  // Don't pass schema to sql() - we'll handle completions separately
  const sqlLang = sql({ dialect: sqlDialect, upperCaseKeywords: true })

  return [sqlLang]
}

// Build completion sources with substring matching for schema items
const buildCompletionSources = (dialect: string, schema: SchemaNamespace, connectionType?: string) => {
  // Use connectionType for keyword completions (more specific, includes snowflake)
  const keywordDialect = (connectionType || dialect) as SqlDialect
  return [boostedSqlKeywords(keywordDialect), substringSchemaCompletions(schema)]
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
        show ? [lineNumbers()] : []
      )
    })
  }
})

// Watch for table link setting changes
watch(() => settingsStore.tableLinkEnabled, (enabled) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: tableLinkCompartment.reconfigure(
        enabled ? createTableLinkExtension((ref) => emit('navigate-to-table', ref)) : []
      )
    })
  }
})

// Re-validate when SQLGlot becomes ready
watch(() => sqlglotStore.isReady, () => {
  triggerValidation()
})

// Watch for font size setting changes
watch(() => settingsStore.editorFontSize, (size) => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: fontSizeCompartment.reconfigure(fontSizeExtension(size))
    })
  }
})

// Sync external modelValue changes into CodeMirror (e.g. chat agent setting the query)
watch(() => props.modelValue, (newVal) => {
  if (!editorView.value) return
  const currentDoc = editorView.value.state.doc.toString()
  if (newVal !== undefined && newVal !== currentDoc) {
    editorView.value.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: newVal },
    })
  }

  // Clear dry run result when query changes (to show fresh estimate on next hover)
  if (currentDoc !== lastDryRunQuery) {
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

  let hasActivated = false
  const keyboardHandlers = EditorView.domEventHandlers({
    focus() {
      if (!hasActivated) {
        hasActivated = true
        emit('activate')
      }
      return false
    },
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
      lineNumbersCompartment.of(settingsStore.showEditorLineNumbers ? [lineNumbers()] : []),
      fontSizeCompartment.of(fontSizeExtension(settingsStore.editorFontSize)),
      highlightSpecialChars(),
      EditorState.allowMultipleSelections.of(true),
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
        // Enter: insert newline and copy indentation from the current line
        {
          key: 'Enter',
          run: (view) => {
            const { head } = view.state.selection.main
            const line = view.state.doc.lineAt(head)
            const indent = line.text.match(/^\s*/)?.[0] || ''
            view.dispatch({
              changes: { from: head, insert: '\n' + indent },
              selection: { anchor: head + 1 + indent.length },
            })
            return true
          }
        },
        // Tab: accept autocomplete if open, indent selection, or insert spaces
        {
          key: 'Tab',
          run: (view) => {
            if (acceptCompletion(view)) return true
            const { from, to } = view.state.selection.main
            if (from !== to) return indentMore(view)
            view.dispatch({
              changes: { from, to, insert: '  ' },
              selection: { anchor: from + 2 }
            })
            return true
          }
        },
        // Shift-Tab: dedent selected lines
        { key: 'Shift-Tab', run: indentLess },
        // Cmd-D: select next occurrence of selection
        { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
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
      sqlglotErrorField,
      sqlglotErrorTheme,
      keyboardHandlers,
      tableLinkCompartment.of(settingsStore.tableLinkEnabled ? createTableLinkExtension((ref) => emit('navigate-to-table', ref)) : []),
      tooltips({ parent: document.body }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
          triggerValidation()
        }
      }),
      // Hover detection for SQLGlot error tooltips
      EditorView.domEventHandlers({
        mousemove(event, view) {
          const target = event.target as HTMLElement
          const errorSpan = target.closest('.cm-sqlglot-error') as HTMLElement | null
          if (!errorSpan) {
            hoveredError.value = null
            return false
          }
          // Find the error at this position
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) return false
          const errorState = view.state.field(sqlglotErrorField)
          const lineNum = view.state.doc.lineAt(pos).number
          const matchingError = errorState.errors.find(e => e.line === lineNum)
          if (matchingError) {
            const coords = view.coordsAtPos(pos)
            if (coords) {
              const wrapperRect = editorRef.value?.getBoundingClientRect()
              if (wrapperRect) {
                hoveredError.value = {
                  message: matchingError.message,
                  top: coords.top - wrapperRect.top,
                }
              }
            }
          }
          return false
        },
        mouseleave() {
          hoveredError.value = null
          return false
        },
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

  // Click-outside listener for spell input
  document.addEventListener('mousedown', handleSpellClickOutside)
})

onUnmounted(() => {
  editorView.value?.destroy()
  if (dryRunDebounceTimer) clearTimeout(dryRunDebounceTimer)
  if (validateTimer) clearTimeout(validateTimer)
  if (castingTimer) clearInterval(castingTimer)
  document.removeEventListener('mousedown', handleSpellClickOutside)
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
  formatQuery: handleFormat,
  triggerDryRun,
  toggleSpellInput,
  showSpellInput,
  justFormatted,
  dryRunResult,
  isDryRunLoading,
})
</script>

<template>
  <div
    class="query-editor-wrapper"
    :style="{ height: `${height || 150}px` }"
  >
    <div
      ref="editorRef"
      class="query-editor"
    />

    <!-- Casting overlay — starfield over editor while spell is being cast -->
    <div v-if="isCastingSpell" class="casting-overlay">
      <span
        v-for="(star, i) in castingStars"
        :key="i"
        class="casting-star"
        :style="{ left: star.x + '%', top: star.y + '%' }"
      >{{ starDisplay(star) }}</span>
      <span class="casting-label">Casting...</span>
    </div>

    <!-- SQLGlot error tooltip — side-anchored -->
    <div
      v-if="hoveredError"
      class="sqlglot-error-tooltip"
      :style="{ top: hoveredError.top + 'px' }"
    >
      {{ hoveredError.message }}
    </div>

    <!-- Spell input — textarea centered above the wand button -->
    <div v-if="showSpellInput" class="spell-input-wrapper">
      <textarea
        ref="spellInputRef"
        v-model="spellInstruction"
        class="spell-input"
        placeholder="e.g. add a WHERE for date > 2024"
        rows="3"
        :disabled="isCastingSpell"
        @keydown.enter.exact.prevent="submitSpell"
        @keydown.escape.prevent="dismissSpellInput"
      />
      <button
        v-tooltip="'Submit (Enter)'"
        class="spell-submit-btn"
        :disabled="isCastingSpell || !spellInstruction.trim()"
        @click.stop="submitSpell"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          <path d="m9 10-5 5 5 5" />
        </svg>
      </button>
    </div>

  </div>
</template>

<style scoped>
.query-editor-wrapper {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  /* Containment: prevent layout/paint leaking to parent */
  contain: layout style paint;
}

.query-editor {
  height: 100%;
  overflow: hidden;
}

.query-editor :deep(.cm-editor) {
  height: 100%;
  overflow: hidden;
  font-feature-settings: "liga" 0;
}

.query-editor :deep(.cm-scroller) {
  overflow: auto !important;
  scrollbar-width: none;
  scroll-behavior: smooth;
}

.query-editor :deep(.cm-scroller)::-webkit-scrollbar {
  display: none;
}

/* Spell Input — textarea centered above the wand button */
.spell-input-wrapper {
  position: absolute;
  bottom: var(--space-2);
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  /* Contain the absolutely-positioned submit button */
  display: inline-block;
}

.spell-submit-btn {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  line-height: 1;
  cursor: pointer;
}

.spell-submit-btn:hover:not(:disabled) {
  color: var(--text-primary);
}

.spell-submit-btn:disabled {
  color: var(--text-tertiary);
  opacity: 0.5;
  cursor: not-allowed;
}

.spell-input {
  display: block;
  width: 360px;
  padding: 8px 36px 8px 10px;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  background: var(--surface-primary);
  border: 2px solid var(--border-secondary);
  color: var(--text-primary);
  outline: none;
  resize: none;
}

.spell-input:focus {
  border-color: var(--text-secondary);
}

.spell-input::placeholder {
  color: var(--text-tertiary);
}

/* Casting overlay — starfield over the editor */
.casting-overlay {
  position: absolute;
  inset: 0;
  background: var(--surface-primary);
  opacity: 0.85;
  z-index: 2;
  pointer-events: none;
}

.casting-star {
  position: absolute;
  font-family: var(--font-family-mono);
  font-size: 14px;
  color: var(--text-tertiary);
  user-select: none;
  pointer-events: none;
}

.casting-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

/* SQLGlot error tooltip */
.sqlglot-error-tooltip {
  position: absolute;
  right: var(--space-2);
  max-width: 300px;
  padding: var(--space-1) var(--space-2);
  background: var(--surface-primary);
  border: 2px solid var(--color-error);
  color: var(--color-error);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  line-height: 1.3;
  z-index: 2;
  pointer-events: none;
  white-space: pre-wrap;
  box-shadow: var(--shadow-md);
}


</style>
