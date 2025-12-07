<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { StateField, StateEffect, RangeSet } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

// Types for error suggestions
interface LineSuggestion {
  line: number // 1-indexed line number
  original: string
  suggested: string
  message?: string
}

// State effect to set suggestions
const setSuggestions = StateEffect.define<LineSuggestion[]>()

// Widget to display the suggested fix below the error line
class SuggestionWidget extends WidgetType {
  constructor(readonly suggestion: LineSuggestion) {
    super()
  }

  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-suggestion-line'

    const lineNumber = document.createElement('span')
    lineNumber.className = 'cm-suggestion-gutter'
    lineNumber.textContent = '+'

    const content = document.createElement('span')
    content.className = 'cm-suggestion-content'
    content.textContent = this.suggestion.suggested

    wrapper.appendChild(lineNumber)
    wrapper.appendChild(content)

    return wrapper
  }

  eq(other: SuggestionWidget) {
    return other.suggestion.line === this.suggestion.line &&
           other.suggestion.suggested === this.suggestion.suggested
  }

  ignoreEvent() {
    return false
  }
}

// State field to manage decorations
const suggestionField = StateField.define<{ suggestions: LineSuggestion[], decorations: RangeSet<Decoration> }>({
  create() {
    return { suggestions: [], decorations: Decoration.none }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestions)) {
        const suggestions = effect.value
        const decorations: { from: number, to: number, decoration: Decoration }[] = []

        for (const suggestion of suggestions) {
          const lineNum = suggestion.line
          if (lineNum < 1 || lineNum > tr.state.doc.lines) continue

          const line = tr.state.doc.line(lineNum)

          // Add error line decoration (red background)
          decorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-error-line' })
          })

          // Add suggestion widget after the line (green background)
          decorations.push({
            from: line.to,
            to: line.to,
            decoration: Decoration.widget({
              widget: new SuggestionWidget(suggestion),
              block: true,
              side: 1
            })
          })
        }

        // Sort by from position
        decorations.sort((a, b) => a.from - b.from)

        return {
          suggestions,
          decorations: Decoration.set(decorations.map(d => d.decoration.range(d.from, d.to)))
        }
      }
    }

    // If document changed, recompute decorations for current suggestions
    if (tr.docChanged && value.suggestions.length > 0) {
      const suggestions = value.suggestions
      const decorations: { from: number, to: number, decoration: Decoration }[] = []

      for (const suggestion of suggestions) {
        const lineNum = suggestion.line
        if (lineNum < 1 || lineNum > tr.state.doc.lines) continue

        const line = tr.state.doc.line(lineNum)

        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: 'cm-error-line' })
        })

        decorations.push({
          from: line.to,
          to: line.to,
          decoration: Decoration.widget({
            widget: new SuggestionWidget(suggestion),
            block: true,
            side: 1
          })
        })
      }

      decorations.sort((a, b) => a.from - b.from)

      return {
        suggestions,
        decorations: Decoration.set(decorations.map(d => d.decoration.range(d.from, d.to)))
      }
    }

    return value
  },
  provide: f => EditorView.decorations.from(f, value => value.decorations)
})

// Theme for error/suggestion styling
const suggestionTheme = EditorView.theme({
  '.cm-error-line': {
    backgroundColor: 'var(--color-error-bg)',
    borderLeft: '3px solid var(--color-error)'
  },
  '.cm-suggestion-line': {
    display: 'flex',
    backgroundColor: 'var(--color-success-bg)',
    borderLeft: '3px solid var(--color-success)',
    fontFamily: 'var(--font-family-mono)',
    fontSize: '14px',
    lineHeight: '1.4'
  },
  '.cm-suggestion-gutter': {
    width: '50px',
    paddingLeft: '16px',
    color: 'var(--color-success)',
    fontWeight: 'bold',
    flexShrink: '0'
  },
  '.cm-suggestion-content': {
    color: 'var(--color-success)',
    paddingLeft: '4px'
  }
})

const editorRef = ref<HTMLElement | null>(null)
const editorView = ref<EditorView | null>(null)

// Demo data
const demoQuery = `SELECT
  user_id,
  user_name,
  FORM users
WHERE status = 'active'
ORDER BY created_at DESC`

const demoSuggestion: LineSuggestion = {
  line: 4,
  original: '  FORM users',
  suggested: '  FROM users',
  message: 'Typo: FORM should be FROM'
}

const suggestions = ref<LineSuggestion[]>([demoSuggestion])

const applySuggestions = () => {
  if (editorView.value) {
    editorView.value.dispatch({
      effects: setSuggestions.of(suggestions.value)
    })
  }
}

const clearSuggestions = () => {
  suggestions.value = []
  if (editorView.value) {
    editorView.value.dispatch({
      effects: setSuggestions.of([])
    })
  }
}

const acceptSuggestion = (suggestion: LineSuggestion) => {
  if (!editorView.value) return

  const doc = editorView.value.state.doc
  if (suggestion.line < 1 || suggestion.line > doc.lines) return

  const line = doc.line(suggestion.line)

  // Replace the line content with the suggestion
  editorView.value.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: suggestion.suggested
    }
  })

  // Remove this suggestion from the list
  suggestions.value = suggestions.value.filter(s => s.line !== suggestion.line)
  applySuggestions()
}

onMounted(() => {
  if (!editorRef.value) return

  editorView.value = new EditorView({
    extensions: [
      basicSetup,
      sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
      suggestionField,
      suggestionTheme,
      EditorView.theme({
        '.cm-gutters': {
          backgroundColor: 'var(--editor-bg)',
          color: 'var(--editor-gutter-color)',
          border: 'none',
        },
        '&': {
          fontFamily: 'var(--font-family-mono)',
        },
        '.cm-content': {
          fontFamily: 'var(--font-family-mono)',
        }
      }, { dark: false })
    ],
    parent: editorRef.value,
    doc: demoQuery
  })

  // Apply initial suggestions
  setTimeout(applySuggestions, 100)
})

onUnmounted(() => {
  editorView.value?.destroy()
})
</script>

<template>
  <div class="workbench">
    <header class="workbench-header">
      <h1>SQL Error Correction Workbench</h1>
      <p>Testing AI-powered SQL error detection and suggestions</p>
    </header>

    <div class="workbench-content">
      <div class="editor-section">
        <div class="section-header">
          <h2>Query Editor</h2>
          <div class="actions">
            <button @click="applySuggestions" class="btn">Show Suggestions</button>
            <button @click="clearSuggestions" class="btn btn-secondary">Clear</button>
          </div>
        </div>
        <div ref="editorRef" class="editor" />
      </div>

      <div class="suggestions-panel" v-if="suggestions.length > 0">
        <h2>Suggestions</h2>
        <div v-for="suggestion in suggestions" :key="suggestion.line" class="suggestion-card">
          <div class="suggestion-header">
            <span class="line-badge">Line {{ suggestion.line }}</span>
            <span class="message" v-if="suggestion.message">{{ suggestion.message }}</span>
          </div>
          <div class="suggestion-diff">
            <div class="diff-line diff-remove">
              <span class="diff-sign">-</span>
              <code>{{ suggestion.original }}</code>
            </div>
            <div class="diff-line diff-add">
              <span class="diff-sign">+</span>
              <code>{{ suggestion.suggested }}</code>
            </div>
          </div>
          <button @click="acceptSuggestion(suggestion)" class="btn btn-accept">
            Accept Fix
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workbench {
  min-height: 100vh;
  background: var(--bg-primary);
  padding: var(--space-6);
}

.workbench-header {
  margin-bottom: var(--space-6);
}

.workbench-header h1 {
  font-size: var(--font-size-heading-lg);
  color: var(--text-primary);
  margin: 0 0 var(--space-2) 0;
}

.workbench-header p {
  color: var(--text-secondary);
  margin: 0;
}

.workbench-content {
  display: grid;
  grid-template-columns: 1fr 350px;
  gap: var(--space-6);
  max-width: 1400px;
}

.editor-section {
  background: var(--surface-primary);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  border: 1px solid var(--border-primary);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-primary);
}

.section-header h2 {
  font-size: var(--font-size-body-lg);
  color: var(--text-primary);
  margin: 0;
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.editor {
  height: 400px;
}

.editor :deep(.cm-editor) {
  height: 100%;
}

.editor :deep(.cm-scroller) {
  overflow: auto;
}

.suggestions-panel {
  background: var(--surface-primary);
  border-radius: var(--border-radius-lg);
  padding: var(--space-4);
  border: 1px solid var(--border-primary);
  height: fit-content;
}

.suggestions-panel h2 {
  font-size: var(--font-size-body-lg);
  color: var(--text-primary);
  margin: 0 0 var(--space-4) 0;
}

.suggestion-card {
  background: var(--surface-secondary);
  border-radius: var(--border-radius-md);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.line-badge {
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
}

.message {
  color: var(--text-secondary);
  font-size: var(--font-size-body-sm);
}

.suggestion-diff {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  margin-bottom: var(--space-3);
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

.diff-line {
  display: flex;
  padding: var(--space-2);
}

.diff-sign {
  width: 20px;
  flex-shrink: 0;
  font-weight: bold;
}

.diff-remove {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.diff-add {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.btn {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
  border: none;
  background: var(--surface-accent);
  color: white;
}

.btn:hover {
  opacity: 0.9;
}

.btn-secondary {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.btn-accept {
  width: 100%;
  background: var(--color-success);
  color: white;
}

.btn-accept:hover {
  filter: brightness(0.9);
}
</style>
