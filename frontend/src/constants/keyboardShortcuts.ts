export type ShortcutCategory = 'General' | 'Navigation' | 'Editing'

export interface KeyboardShortcut {
  id: string
  name: string
  description?: string
  keys: string[] // ['⌘', 'X'] or ['⌘', '⇧', 'Z']
  category: ShortcutCategory
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // General
  { id: 'run-query', name: 'Run query', keys: ['⌘', '⏎'], category: 'General' },
  { id: 'close-box', name: 'Close box', keys: ['Delete'], category: 'General' },
  { id: 'select-all', name: 'Select all boxes', keys: ['⌘', 'A'], category: 'General' },
  { id: 'copy', name: 'Copy box', keys: ['⌘', 'C'], category: 'General' },
  { id: 'paste', name: 'Paste box', keys: ['⌘', 'V'], category: 'General' },
  { id: 'undo', name: 'Undo', keys: ['⌘', 'Z'], category: 'General' },
  { id: 'redo', name: 'Redo', keys: ['⌘', '⇧', 'Z'], category: 'General' },

  // Navigation
  { id: 'move-up', name: 'Move box up', keys: ['↑'], category: 'Navigation' },
  { id: 'move-down', name: 'Move box down', keys: ['↓'], category: 'Navigation' },
  { id: 'move-left', name: 'Move box left', keys: ['←'], category: 'Navigation' },
  { id: 'move-right', name: 'Move box right', keys: ['→'], category: 'Navigation' },

  // Editing (resize)
  { id: 'grow-up', name: 'Grow box up', keys: ['⌘', '↑'], category: 'Editing' },
  { id: 'grow-down', name: 'Grow box down', keys: ['⌘', '↓'], category: 'Editing' },
  { id: 'grow-left', name: 'Grow box left', keys: ['⌘', '←'], category: 'Editing' },
  { id: 'grow-right', name: 'Grow box right', keys: ['⌘', '→'], category: 'Editing' },
]

// Category display order
export const CATEGORY_ORDER: ShortcutCategory[] = ['General', 'Navigation', 'Editing']

// Helper to get shortcuts grouped by category
export const getShortcutsByCategory = (): Map<ShortcutCategory, KeyboardShortcut[]> => {
  const categories = new Map<ShortcutCategory, KeyboardShortcut[]>()

  // Initialize in display order
  for (const category of CATEGORY_ORDER) {
    categories.set(category, [])
  }

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    categories.get(shortcut.category)!.push(shortcut)
  }

  return categories
}
