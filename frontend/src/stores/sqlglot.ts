import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SqlGlotError } from '../workers/sqlglot.worker'

export type { SqlGlotError }

interface WorkerResponse {
  id: number
  type: 'ready' | 'validate-result' | 'format-result' | 'error'
  errors?: SqlGlotError[]
  formatted?: string
  message?: string
}

export const useSqlGlotStore = defineStore('sqlglot', () => {
  const isReady = ref(false)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  let worker: Worker | null = null
  let nextId = 0
  let initPromise: Promise<void> | null = null
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()

  function sendMessage(msg: Record<string, unknown>): Promise<unknown> {
    if (!worker) throw new Error('SQLGlot worker not created')
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker!.postMessage({ ...msg, id })
    })
  }

  const initialize = async (): Promise<void> => {
    if (isReady.value) return
    if (initPromise) return initPromise

    initPromise = (async () => {
      isLoading.value = true
      loadError.value = null

      try {
        worker = new Worker(
          new URL('../workers/sqlglot.worker.ts', import.meta.url),
          { type: 'classic' }
        )

        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const { id, type } = e.data
          const cb = pending.get(id)
          if (!cb) return
          pending.delete(id)

          if (type === 'error') {
            cb.reject(new Error(e.data.message || 'Worker error'))
          } else {
            cb.resolve(e.data)
          }
        }

        worker.onerror = (err) => {
          console.error('SQLGlot worker error:', err)
        }

        await sendMessage({ type: 'init' })
        isReady.value = true
        console.log('SQLGlot initialized successfully')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('SQLGlot initialization failed:', msg)
        loadError.value = msg
        initPromise = null
        throw err
      } finally {
        isLoading.value = false
      }
    })()

    return initPromise
  }

  const validate = async (
    query: string,
    dialect: string,
  ): Promise<SqlGlotError[]> => {
    if (!isReady.value) {
      if (initPromise) await initPromise
      else return []
    }
    const result = await sendMessage({ type: 'validate', query, dialect }) as WorkerResponse
    return result.errors || []
  }

  const format = async (query: string, dialect: string): Promise<string> => {
    if (!isReady.value) {
      if (initPromise) await initPromise
      else return query
    }
    const result = await sendMessage({ type: 'format', query, dialect }) as WorkerResponse
    return result.formatted || query
  }

  return { isReady, isLoading, loadError, initialize, validate, format }
})
