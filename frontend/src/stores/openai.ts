import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { deleteItem, loadItem, saveItem } from '../utils/storage'

const OPENAI_API_KEY_STORAGE_KEY = 'openai-api-key'

export const useOpenAIStore = defineStore('openai', () => {
  const apiKey = ref('')

  const loadState = async () => {
    try {
      apiKey.value = (await loadItem<string>(OPENAI_API_KEY_STORAGE_KEY))?.trim() || ''
    } catch (error) {
      console.error('Failed to load the OpenAI API key:', error)
    }
  }

  const ready = loadState()
  const hasApiKey = computed(() => apiKey.value.length > 0)

  const setApiKey = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) throw new Error('Enter an OpenAI API key')
    await saveItem(OPENAI_API_KEY_STORAGE_KEY, trimmed)
    apiKey.value = trimmed
  }

  const clearApiKey = async () => {
    await deleteItem(OPENAI_API_KEY_STORAGE_KEY)
    apiKey.value = ''
  }

  return {
    apiKey,
    hasApiKey,
    ready,
    setApiKey,
    clearApiKey,
  }
})
