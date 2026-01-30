/**
 * CodeMirror extension for Cmd+click navigation to table definitions.
 * Shows dashed underlines on qualified table references when Cmd is held.
 */

import { StateField, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { extractTableReferencesWithPositions, type TableReferenceWithPosition } from './queryAnalyzer'

// State effect to toggle Cmd key state
const setCmdKeyDown = StateEffect.define<boolean>()

// Mark decoration for table links
const tableLinkMark = Decoration.mark({ class: 'cm-table-link' })

// State field tracking Cmd state and computing decorations
const tableLinkField = StateField.define<{
  cmdDown: boolean
  decorations: DecorationSet
}>({
  create() {
    return { cmdDown: false, decorations: Decoration.none }
  },

  update(value, tr) {
    let cmdDown = value.cmdDown
    let decorations = value.decorations

    // Handle Cmd key state changes
    for (const effect of tr.effects) {
      if (effect.is(setCmdKeyDown)) {
        cmdDown = effect.value

        if (cmdDown) {
          // Compute decorations when Cmd is pressed
          const query = tr.state.doc.toString()
          const refs = extractTableReferencesWithPositions(query)
          const marks = refs.map(ref =>
            tableLinkMark.range(ref.from, ref.to)
          )
          decorations = Decoration.set(marks, true)
        } else {
          // Clear decorations when Cmd is released
          decorations = Decoration.none
        }
      }
    }

    // If document changed while Cmd is down, recompute decorations
    if (tr.docChanged && cmdDown) {
      const query = tr.state.doc.toString()
      const refs = extractTableReferencesWithPositions(query)
      const marks = refs.map(ref =>
        tableLinkMark.range(ref.from, ref.to)
      )
      decorations = Decoration.set(marks, true)
    }

    return { cmdDown, decorations }
  },

  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
})

// Theme for table link styling
const tableLinkTheme = EditorView.theme({
  '.cm-table-link': {
    textDecoration: 'underline dashed var(--color-purple)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
    borderRadius: '2px',
  },
  '.cm-table-link:hover': {
    background: 'color-mix(in srgb, var(--color-purple) 15%, transparent)',
  }
})

/**
 * Create a table link extension with a navigation callback.
 * @param onNavigateToTable Callback invoked when user Cmd+clicks a table reference
 */
export function createTableLinkExtension(
  onNavigateToTable: (ref: TableReferenceWithPosition) => void
) {
  // DOM event handlers for Cmd key tracking and click handling
  const tableLinkHandlers = EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key === 'Meta' || event.key === 'Control') {
        view.dispatch({ effects: setCmdKeyDown.of(true) })
      }
      return false
    },

    keyup(event, view) {
      if (event.key === 'Meta' || event.key === 'Control') {
        view.dispatch({ effects: setCmdKeyDown.of(false) })
      }
      return false
    },

    blur(_event, view) {
      // Clear Cmd state when editor loses focus
      const state = view.state.field(tableLinkField)
      if (state.cmdDown) {
        view.dispatch({ effects: setCmdKeyDown.of(false) })
      }
      return false
    },

    click(event, view) {
      // Only handle Cmd+click
      if (!(event.metaKey || event.ctrlKey)) return false

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false

      // Check if click is within a table reference
      const query = view.state.doc.toString()
      const refs = extractTableReferencesWithPositions(query)

      for (const ref of refs) {
        if (pos >= ref.from && pos <= ref.to) {
          // Found clicked table reference
          event.preventDefault()
          event.stopPropagation()
          onNavigateToTable(ref)
          return true
        }
      }

      return false
    }
  })

  return [
    tableLinkField,
    tableLinkTheme,
    tableLinkHandlers
  ]
}
