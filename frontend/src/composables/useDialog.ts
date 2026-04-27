import { ref } from 'vue'

type DialogType = 'confirm' | 'prompt'

interface DialogState {
  type: DialogType
  message: string
  defaultValue: string
  resolve: (value: boolean | string | null) => void
}

const active = ref<DialogState | null>(null)

export function useDialog() {
  const confirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      active.value = { type: 'confirm', message, defaultValue: '', resolve: (v) => resolve(!!v) }
    })
  }

  const prompt = (message: string, defaultValue = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      active.value = { type: 'prompt', message, defaultValue, resolve: (v) => resolve(v as string | null) }
    })
  }

  const respond = (value: boolean | string | null) => {
    if (active.value) {
      active.value.resolve(value)
      active.value = null
    }
  }

  return { active, confirm, prompt, respond }
}
