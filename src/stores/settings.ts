import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'squill-settings'

interface Settings {
  autoLimitEnabled: boolean
  autoLimitValue: number
}

// Default settings
const DEFAULT_SETTINGS: Settings = {
  autoLimitEnabled: true,
  autoLimitValue: 5000
}

const loadSettings = (): Settings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
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

  // Auto-limit settings
  const autoLimitEnabled = ref(savedSettings.autoLimitEnabled)
  const autoLimitValue = ref(savedSettings.autoLimitValue)

  // Watch for changes and auto-save
  watch([autoLimitEnabled, autoLimitValue], () => {
    saveSettings({
      autoLimitEnabled: autoLimitEnabled.value,
      autoLimitValue: autoLimitValue.value
    })
  })

  // Actions
  const toggleAutoLimit = () => {
    autoLimitEnabled.value = !autoLimitEnabled.value
  }

  const setAutoLimitValue = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value
    if (numValue > 0 && numValue <= 1000000) {
      autoLimitValue.value = numValue
    }
  }

  const resetToDefaults = () => {
    autoLimitEnabled.value = DEFAULT_SETTINGS.autoLimitEnabled
    autoLimitValue.value = DEFAULT_SETTINGS.autoLimitValue
  }

  return {
    autoLimitEnabled,
    autoLimitValue,
    toggleAutoLimit,
    setAutoLimitValue,
    resetToDefaults
  }
})
