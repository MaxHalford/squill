import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OAuthSettingsSchema } from '../utils/storageSchemas'
import { loadItem, saveItem, deleteItem } from '../utils/storage'

const STORAGE_KEY = 'oauth-settings'

export const useOAuthSettingsStore = defineStore('oauthSettings', () => {
  const googleClientId = ref('')
  const googleClientSecret = ref('')

  const loadState = async () => {
    try {
      const saved = await loadItem<unknown>(STORAGE_KEY)
      if (!saved) return
      const result = OAuthSettingsSchema.safeParse(saved)
      if (!result.success) return
      googleClientId.value = result.data.googleClientId ?? ''
      googleClientSecret.value = result.data.googleClientSecret ?? ''
    } catch (err) {
      console.error('Failed to load OAuth settings:', err)
    }
  }

  const ready = loadState()

  const setGoogleCredentials = async (clientId: string, clientSecret: string) => {
    googleClientId.value = clientId.trim()
    googleClientSecret.value = clientSecret.trim()
    await saveItem(STORAGE_KEY, {
      googleClientId: googleClientId.value,
      googleClientSecret: googleClientSecret.value,
    })
  }

  const clearGoogleCredentials = async () => {
    googleClientId.value = ''
    googleClientSecret.value = ''
    await deleteItem(STORAGE_KEY)
  }

  return {
    googleClientId,
    googleClientSecret,
    ready,
    setGoogleCredentials,
    clearGoogleCredentials,
  }
})
