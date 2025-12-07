import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'sqlshell-settings'

// Load settings from localStorage
const loadSettings = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch (err) {
    console.error('Failed to load settings from localStorage:', err)
    return {}
  }
}

// Save settings to localStorage
const saveSettings = (settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings to localStorage:', err)
  }
}

// Font CDN URLs mapping
const fontCDNMap = {
  '"Fira Code", monospace': 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&display=swap',
  '"JetBrains Mono", monospace': 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap',
  '"Departure Mono", monospace': 'https://fonts.googleapis.com/css2?family=Departure+Mono&display=swap',
  '"Inter", sans-serif': 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap',
}

// Track loaded fonts
const loadedFonts = new Set()

// Load font from CDN if needed
const loadFontFromCDN = (fontValue) => {
  const cdnUrl = fontCDNMap[fontValue]

  if (!cdnUrl || loadedFonts.has(fontValue)) {
    return // No CDN needed or already loaded
  }

  // Create and append link element
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cdnUrl
  document.head.appendChild(link)

  loadedFonts.add(fontValue)
  console.log(`Loaded font from CDN: ${fontValue}`)
}

export const useSettingsStore = defineStore('settings', () => {
  const savedSettings = loadSettings()

  const editorFont = ref(savedSettings.editorFont || 'monospace')
  const tableFont = ref(savedSettings.tableFont || 'system-ui')

  const editorFontOptions = [
    { value: 'monospace', label: 'System Monospace' },
    { value: '"Fira Code", monospace', label: 'Fira Code' },
    { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
    { value: '"SF Mono", Monaco, monospace', label: 'SF Mono' },
    { value: '"Consolas", monospace', label: 'Consolas' },
  ]

  const tableFontOptions = [
    { value: 'system-ui', label: 'System UI' },
    { value: '"Departure Mono", monospace', label: 'Departure Mono' },
    { value: 'monospace', label: 'System Monospace' },
    { value: '"Inter", sans-serif', label: 'Inter' },
    { value: 'Arial, sans-serif', label: 'Arial' },
  ]

  // Load saved fonts on initialization
  loadFontFromCDN(editorFont.value)
  loadFontFromCDN(tableFont.value)

  // Watch for font changes
  watch(editorFont, (newFont) => {
    loadFontFromCDN(newFont)
    saveSettings({
      editorFont: editorFont.value,
      tableFont: tableFont.value,
    })
  })

  watch(tableFont, (newFont) => {
    loadFontFromCDN(newFont)
    saveSettings({
      editorFont: editorFont.value,
      tableFont: tableFont.value,
    })
  })

  const setEditorFont = (font) => {
    editorFont.value = font
  }

  const setTableFont = (font) => {
    tableFont.value = font
  }

  return {
    editorFont,
    tableFont,
    editorFontOptions,
    tableFontOptions,
    setEditorFont,
    setTableFont,
  }
})
