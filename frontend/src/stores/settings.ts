import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { SettingsSchema } from '../utils/storageSchemas'

const STORAGE_KEY = 'squill-settings'

type ThemePreference = 'system' | 'light' | 'dark'

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
  accentColor: string  // Highlighter color for Cmd+click table links
}

// Default settings
const DEFAULT_SETTINGS: Settings = {
  fetchBatchSize: 5000,  // Rows loaded per batch from source databases
  fetchPaginationEnabled: true,
  paginationSize: 100,  // Display pagination: rows per page in UI
  panToBoxOnSelect: true,
  autofixEnabled: true,
  themePreference: 'system',
  showEditorLineNumbers: false,
  editorFontSize: 13,  // Default font size in pixels for code editor
  accentColor: '#9333ea'  // Purple (default accent color)
}

const loadSettings = (): Settings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return DEFAULT_SETTINGS

    const parsed = JSON.parse(saved)
    const result = SettingsSchema.safeParse(parsed)

    if (result.success) {
      return { ...DEFAULT_SETTINGS, ...result.data }
    }

    console.warn('Invalid settings in localStorage:', result.error.issues)
    return DEFAULT_SETTINGS
  } catch (err) {
    console.error('Failed to load settings:', err)
    return DEFAULT_SETTINGS
  }
}

const saveSettings = (data: Settings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const savedSettings = loadSettings()

  // Fetch pagination settings (rows loaded per batch from source)
  const fetchBatchSize = ref(savedSettings.fetchBatchSize)
  const fetchPaginationEnabled = ref(savedSettings.fetchPaginationEnabled)

  // Display pagination settings (rows per page in UI)
  const paginationSize = ref(savedSettings.paginationSize)

  // Viewport settings
  const panToBoxOnSelect = ref(savedSettings.panToBoxOnSelect)

  // AI autofix settings
  const autofixEnabled = ref(savedSettings.autofixEnabled)

  // Theme settings
  const themePreference = ref<ThemePreference>(savedSettings.themePreference)

  // Editor settings
  const showEditorLineNumbers = ref(savedSettings.showEditorLineNumbers)
  const editorFontSize = ref(savedSettings.editorFontSize)

  // Table link highlight color
  const accentColor = ref(savedSettings.accentColor)

  // Resolve system preference to actual theme
  const getSystemTheme = (): 'light' | 'dark' => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  const resolvedTheme = computed((): 'light' | 'dark' => {
    if (themePreference.value === 'system') {
      return getSystemTheme()
    }
    return themePreference.value
  })

  // Watch for changes and auto-save
  watch([fetchBatchSize, fetchPaginationEnabled, paginationSize, panToBoxOnSelect, autofixEnabled, themePreference, showEditorLineNumbers, editorFontSize, accentColor], () => {
    saveSettings({
      fetchBatchSize: fetchBatchSize.value,
      fetchPaginationEnabled: fetchPaginationEnabled.value,
      paginationSize: paginationSize.value,
      panToBoxOnSelect: panToBoxOnSelect.value,
      autofixEnabled: autofixEnabled.value,
      themePreference: themePreference.value,
      showEditorLineNumbers: showEditorLineNumbers.value,
      editorFontSize: editorFontSize.value,
      accentColor: accentColor.value
    })
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

  const resetToDefaults = () => {
    fetchBatchSize.value = DEFAULT_SETTINGS.fetchBatchSize
    fetchPaginationEnabled.value = DEFAULT_SETTINGS.fetchPaginationEnabled
    paginationSize.value = DEFAULT_SETTINGS.paginationSize
    panToBoxOnSelect.value = DEFAULT_SETTINGS.panToBoxOnSelect
    autofixEnabled.value = DEFAULT_SETTINGS.autofixEnabled
    themePreference.value = DEFAULT_SETTINGS.themePreference
    showEditorLineNumbers.value = DEFAULT_SETTINGS.showEditorLineNumbers
    editorFontSize.value = DEFAULT_SETTINGS.editorFontSize
    accentColor.value = DEFAULT_SETTINGS.accentColor
  }

  return {
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
    // Table link highlight
    accentColor,
    setTableLinkHighlightColor,
    resetToDefaults
  }
})
