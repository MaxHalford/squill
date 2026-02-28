import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { SettingsSchema } from '../utils/storageSchemas'
import { loadItem, saveItem } from '../utils/storage'

type ThemePreference = 'system' | 'light' | 'dark'
type CanvasPattern = 'dots' | 'grid' | 'crosshatch' | 'waves' | 'none'

interface Settings {
  // Fetch pagination: rows loaded per batch from source databases
  fetchBatchSize: number
  fetchPaginationEnabled: boolean
  paginationSize: number  // Display pagination: rows per page in UI
  panToBoxOnSelect: boolean
  autofixEnabled: boolean
  themePreference: ThemePreference
  // Code editor settings
  showEditorLineNumbers: boolean
  editorFontSize: number  // Font size in pixels for code editor
  tableLinkEnabled: boolean  // Cmd+click to navigate to table definitions
  accentColor: string  // Highlighter color for Cmd+click table links
  // Appearance settings
  canvasPattern: CanvasPattern  // Background pattern for canvas
}

// Default settings
const DEFAULT_SETTINGS: Settings = {
  fetchBatchSize: 500,  // Rows loaded per batch from source databases
  fetchPaginationEnabled: true,
  paginationSize: 100,  // Display pagination: rows per page in UI
  panToBoxOnSelect: true,
  autofixEnabled: true,
  themePreference: 'system',
  showEditorLineNumbers: false,
  editorFontSize: 13,  // Default font size in pixels for code editor
  tableLinkEnabled: true,  // Cmd+click to navigate to table definitions
  accentColor: '#9333ea',  // Purple (default accent color)
  canvasPattern: 'dots'  // Default canvas pattern
}

export const useSettingsStore = defineStore('settings', () => {
  // Refs start with defaults, hydrate from IDB when ready
  const fetchBatchSize = ref(DEFAULT_SETTINGS.fetchBatchSize)
  const fetchPaginationEnabled = ref(DEFAULT_SETTINGS.fetchPaginationEnabled)
  const paginationSize = ref(DEFAULT_SETTINGS.paginationSize)
  const panToBoxOnSelect = ref(DEFAULT_SETTINGS.panToBoxOnSelect)
  const autofixEnabled = ref(DEFAULT_SETTINGS.autofixEnabled)
  const themePreference = ref<ThemePreference>(DEFAULT_SETTINGS.themePreference)
  const showEditorLineNumbers = ref(DEFAULT_SETTINGS.showEditorLineNumbers)
  const editorFontSize = ref(DEFAULT_SETTINGS.editorFontSize)
  const tableLinkEnabled = ref(DEFAULT_SETTINGS.tableLinkEnabled)
  const accentColor = ref(DEFAULT_SETTINGS.accentColor)
  const canvasPattern = ref<CanvasPattern>(DEFAULT_SETTINGS.canvasPattern)

  const applySettings = (s: Settings) => {
    fetchBatchSize.value = s.fetchBatchSize
    fetchPaginationEnabled.value = s.fetchPaginationEnabled
    paginationSize.value = s.paginationSize
    panToBoxOnSelect.value = s.panToBoxOnSelect
    autofixEnabled.value = s.autofixEnabled
    themePreference.value = s.themePreference
    showEditorLineNumbers.value = s.showEditorLineNumbers
    editorFontSize.value = s.editorFontSize
    tableLinkEnabled.value = s.tableLinkEnabled
    accentColor.value = s.accentColor
    canvasPattern.value = s.canvasPattern
  }

  const collectSettings = (): Settings => ({
    fetchBatchSize: fetchBatchSize.value,
    fetchPaginationEnabled: fetchPaginationEnabled.value,
    paginationSize: paginationSize.value,
    panToBoxOnSelect: panToBoxOnSelect.value,
    autofixEnabled: autofixEnabled.value,
    themePreference: themePreference.value,
    showEditorLineNumbers: showEditorLineNumbers.value,
    editorFontSize: editorFontSize.value,
    tableLinkEnabled: tableLinkEnabled.value,
    accentColor: accentColor.value,
    canvasPattern: canvasPattern.value,
  })

  const loadState = async () => {
    try {
      const data = await loadItem<Settings>('settings')
      if (data) {
        const result = SettingsSchema.safeParse(data)
        if (result.success) {
          applySettings({ ...DEFAULT_SETTINGS, ...result.data })
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  const saveState = () => {
    saveItem('settings', collectSettings()).catch(err => {
      console.error('Failed to save settings:', err)
    })
  }

  const ready = loadState()

  // Watch for changes and auto-save
  watch([fetchBatchSize, fetchPaginationEnabled, paginationSize, panToBoxOnSelect, autofixEnabled, themePreference, showEditorLineNumbers, editorFontSize, tableLinkEnabled, accentColor, canvasPattern], saveState)

  // Reactive system theme tracking
  const systemTheme = ref<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', (e) => {
    systemTheme.value = e.matches ? 'dark' : 'light'
  })

  const resolvedTheme = computed((): 'light' | 'dark' => {
    if (themePreference.value === 'system') {
      return systemTheme.value
    }
    return themePreference.value
  })

  // Actions
  const setFetchBatchSize = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value
    if (numValue > 0 && numValue <= 100000) {
      fetchBatchSize.value = numValue
    }
  }

  const toggleFetchPagination = () => {
    fetchPaginationEnabled.value = !fetchPaginationEnabled.value
  }

  const setPaginationSize = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value
    if (numValue > 0 && numValue <= 10000) {
      paginationSize.value = numValue
    }
  }

  const togglePanToBoxOnSelect = () => {
    panToBoxOnSelect.value = !panToBoxOnSelect.value
  }

  const toggleAutofix = () => {
    autofixEnabled.value = !autofixEnabled.value
  }

  const setThemePreference = (value: ThemePreference) => {
    themePreference.value = value
  }

  const cycleTheme = () => {
    const themes: ThemePreference[] = ['system', 'light', 'dark']
    const currentIndex = themes.indexOf(themePreference.value)
    const nextIndex = (currentIndex + 1) % themes.length
    themePreference.value = themes[nextIndex]
  }

  const toggleEditorLineNumbers = () => {
    showEditorLineNumbers.value = !showEditorLineNumbers.value
  }

  const toggleTableLink = () => {
    tableLinkEnabled.value = !tableLinkEnabled.value
  }

  const setEditorFontSize = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value
    if (numValue >= 8 && numValue <= 24) {
      editorFontSize.value = numValue
    }
  }

  const setTableLinkHighlightColor = (color: string) => {
    // Validate hex color format
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      accentColor.value = color
    }
  }

  const setCanvasPattern = (pattern: CanvasPattern) => {
    canvasPattern.value = pattern
  }

  const resetToDefaults = () => {
    applySettings(DEFAULT_SETTINGS)
  }

  return {
    ready,
    // Fetch pagination (rows loaded per batch from source)
    fetchBatchSize,
    fetchPaginationEnabled,
    setFetchBatchSize,
    toggleFetchPagination,
    // Display pagination (rows per page in UI)
    paginationSize,
    setPaginationSize,
    // Other settings
    panToBoxOnSelect,
    autofixEnabled,
    themePreference,
    resolvedTheme,
    togglePanToBoxOnSelect,
    toggleAutofix,
    setThemePreference,
    cycleTheme,
    // Editor settings
    showEditorLineNumbers,
    toggleEditorLineNumbers,
    editorFontSize,
    setEditorFontSize,
    tableLinkEnabled,
    toggleTableLink,
    // Table link highlight
    accentColor,
    setTableLinkHighlightColor,
    // Appearance
    canvasPattern,
    setCanvasPattern,
    resetToDefaults
  }
})
