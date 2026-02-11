/**
 * Query history store for tracking executed queries
 * - Persists to IndexedDB for history browsing
 * - Provides sample queries as context for the AI fixer
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { QueryHistoryStateSchema, type QueryHistoryEntry } from '../utils/storageSchemas'
import { loadItem, saveItem } from '../utils/storage'

// Simple debounce utility
const debounce = <T extends (...args: unknown[]) => void>(fn: T, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }
  return debounced
}

const MAX_HISTORY_ENTRIES = 100
const MAX_SAMPLE_QUERIES = 5 // For AI fixer compatibility

type DatabaseEngine = 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'

export interface RecordQueryParams {
  query: string
  connectionId: string
  connectionType: DatabaseEngine
  success: boolean
  boxName?: string
  boxId?: number
  executionTimeMs?: number
  rowCount?: number
  errorMessage?: string
}

export const useQueryHistoryStore = defineStore('queryHistory', () => {
  const historyEntries = ref<QueryHistoryEntry[]>([])

  function generateId(): string {
    return crypto.randomUUID()
  }

  // ---- Persistence ----

  const loadState = async () => {
    try {
      const data = await loadItem<{ version: number; entries: QueryHistoryEntry[]; maxEntries: number }>('query-history')
      if (data) {
        const result = QueryHistoryStateSchema.safeParse(data)
        if (result.success) {
          historyEntries.value = result.data.entries
        }
      }
    } catch (err) {
      console.error('Failed to load query history:', err)
    }
  }

  const saveState = () => {
    const state = {
      version: 1 as const,
      entries: historyEntries.value,
      maxEntries: MAX_HISTORY_ENTRIES,
    }
    saveItem('query-history', state).catch(err => {
      console.error('Failed to save query history:', err)
    })
  }

  const debouncedSave = debounce(saveState, 500)

  watch(historyEntries, () => {
    debouncedSave()
  }, { deep: true })

  const ready = loadState()

  // ---- Actions ----

  /**
   * Record a query execution (success or failure)
   */
  function recordQuery(params: RecordQueryParams): void {
    const normalizedQuery = params.query.trim()
    if (!normalizedQuery) return

    // Skip exact duplicates within last minute
    const oneMinuteAgo = Date.now() - 60000
    const isDuplicate = historyEntries.value.some(
      e => e.query === normalizedQuery &&
           e.connectionId === params.connectionId &&
           e.timestamp > oneMinuteAgo
    )
    if (isDuplicate) return

    const entry: QueryHistoryEntry = {
      id: generateId(),
      query: normalizedQuery,
      timestamp: Date.now(),
      connectionId: params.connectionId,
      connectionType: params.connectionType,
      boxName: params.boxName,
      executionTimeMs: params.executionTimeMs,
      rowCount: params.rowCount,
      success: params.success,
      errorMessage: params.errorMessage
    }

    // Add to beginning (most recent first)
    historyEntries.value.unshift(entry)

    // Trim to max entries
    if (historyEntries.value.length > MAX_HISTORY_ENTRIES) {
      historyEntries.value = historyEntries.value.slice(0, MAX_HISTORY_ENTRIES)
    }
  }

  /**
   * Backward compatibility: record successful query (for existing code)
   */
  function recordSuccessfulQuery(connectionId: string, query: string): void {
    recordQuery({
      query,
      connectionId,
      connectionType: 'duckdb', // Default, will be overridden by SqlBox
      success: true
    })
  }

  /**
   * Get sample queries for AI fixer (backward compatible)
   * Returns last 5 successful queries for a connection
   */
  function getSampleQueries(connectionId: string): string[] {
    return historyEntries.value
      .filter(e => e.connectionId === connectionId && e.success)
      .slice(0, MAX_SAMPLE_QUERIES)
      .map(e => e.query)
  }

  /**
   * Get history entries with optional filtering
   */
  function getHistory(options?: {
    connectionId?: string
    limit?: number
    search?: string
    successOnly?: boolean
  }): QueryHistoryEntry[] {
    let entries = historyEntries.value

    if (options?.connectionId) {
      entries = entries.filter(e => e.connectionId === options.connectionId)
    }

    if (options?.successOnly) {
      entries = entries.filter(e => e.success)
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase()
      entries = entries.filter(e =>
        e.query.toLowerCase().includes(searchLower) ||
        e.boxName?.toLowerCase().includes(searchLower)
      )
    }

    if (options?.limit) {
      entries = entries.slice(0, options.limit)
    }

    return entries
  }

  /**
   * Get a single entry by ID
   */
  function getEntry(id: string): QueryHistoryEntry | null {
    return historyEntries.value.find(e => e.id === id) || null
  }

  /**
   * Delete a history entry
   */
  function deleteEntry(id: string): void {
    const index = historyEntries.value.findIndex(e => e.id === id)
    if (index !== -1) {
      historyEntries.value.splice(index, 1)
    }
  }

  /**
   * Clear history for a specific connection
   */
  function clearHistory(connectionId: string): void {
    historyEntries.value = historyEntries.value.filter(
      e => e.connectionId !== connectionId
    )
  }

  /**
   * Clear all query history
   */
  function clearAllHistory(): void {
    historyEntries.value = []
  }

  /**
   * Get all unique connection IDs in history
   */
  const connectionIds = computed(() => {
    const ids = new Set(historyEntries.value.map(e => e.connectionId))
    return Array.from(ids)
  })

  return {
    ready,
    historyEntries,
    connectionIds,
    recordQuery,
    recordSuccessfulQuery,
    getSampleQueries,
    getHistory,
    getEntry,
    deleteEntry,
    clearHistory,
    clearAllHistory
  }
})
