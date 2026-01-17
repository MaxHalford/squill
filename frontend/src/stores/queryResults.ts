/**
 * Query Results Store
 * Manages fetch state for paginated queries per SQL box.
 * Tracks how many rows have been fetched from source databases
 * and coordinates background loading.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { QueryFetchState } from '../types/pagination'
import type { DatabaseEngine } from '../types/database'

export const useQueryResultsStore = defineStore('queryResults', () => {
  // Fetch state per box ID
  const fetchStates = ref<Map<number, QueryFetchState>>(new Map())

  /**
   * Initialize fetch state for a new query result
   */
  const initQueryResult = (
    boxId: number,
    engine: DatabaseEngine,
    options: {
      totalRows?: number | null
      fetchedRows?: number
      hasMoreRows?: boolean
      pageToken?: string
      nextOffset?: number
      originalQuery?: string
      connectionId?: string
      schema?: { name: string; type: string }[]
    } = {}
  ): QueryFetchState => {
    const state: QueryFetchState = {
      totalRows: options.totalRows ?? null,
      fetchedRows: options.fetchedRows ?? 0,
      hasMoreRows: options.hasMoreRows ?? false,
      isFetching: false,
      isBackgroundLoading: false,
      sourceEngine: engine,
      pageToken: options.pageToken,
      nextOffset: options.nextOffset,
      originalQuery: options.originalQuery,
      connectionId: options.connectionId,
      schema: options.schema
    }

    fetchStates.value.set(boxId, state)
    return state
  }

  /**
   * Get fetch state for a box
   */
  const getFetchState = (boxId: number): QueryFetchState | undefined => {
    return fetchStates.value.get(boxId)
  }

  /**
   * Update fetch progress after loading more rows
   */
  const updateFetchProgress = (
    boxId: number,
    rowsFetched: number,
    hasMore: boolean,
    pageToken?: string,
    nextOffset?: number
  ): void => {
    const state = fetchStates.value.get(boxId)
    if (!state) return

    state.fetchedRows = rowsFetched
    state.hasMoreRows = hasMore
    if (pageToken !== undefined) state.pageToken = pageToken
    if (nextOffset !== undefined) state.nextOffset = nextOffset
  }

  /**
   * Set fetching state (for loading indicators)
   */
  const setFetching = (boxId: number, isFetching: boolean): void => {
    const state = fetchStates.value.get(boxId)
    if (state) {
      state.isFetching = isFetching
    }
  }

  /**
   * Set background loading state
   */
  const setBackgroundLoading = (boxId: number, isLoading: boolean): void => {
    const state = fetchStates.value.get(boxId)
    if (state) {
      state.isBackgroundLoading = isLoading
    }
  }

  /**
   * Check if we need to fetch more rows to display a given page
   * @param boxId - The box ID
   * @param displayPage - The page number (1-indexed)
   * @param displaySize - Rows per page in the UI
   * @returns true if we need to fetch more rows from source
   */
  const needsFetchForDisplayPage = (
    boxId: number,
    displayPage: number,
    displaySize: number
  ): boolean => {
    const state = fetchStates.value.get(boxId)
    if (!state) return false
    if (!state.hasMoreRows) return false

    // Calculate the row range needed for this page
    const neededStartRow = (displayPage - 1) * displaySize
    const neededEndRow = neededStartRow + displaySize

    // Check if any needed rows are beyond what we've fetched
    return neededEndRow > state.fetchedRows
  }

  /**
   * Get the effective total rows (source total, not DuckDB count)
   * Falls back to fetched rows if total is unknown
   */
  const getEffectiveTotalRows = (boxId: number): number => {
    const state = fetchStates.value.get(boxId)
    if (!state) return 0
    return state.totalRows ?? state.fetchedRows
  }

  /**
   * Check if query result has partial data (not all rows fetched)
   */
  const hasPartialData = (boxId: number): boolean => {
    const state = fetchStates.value.get(boxId)
    if (!state) return false
    return state.hasMoreRows || (state.totalRows !== null && state.fetchedRows < state.totalRows)
  }

  /**
   * Get loading progress as a percentage (0-100)
   */
  const getLoadingProgress = (boxId: number): number => {
    const state = fetchStates.value.get(boxId)
    if (!state || !state.totalRows) return 100
    return Math.round((state.fetchedRows / state.totalRows) * 100)
  }

  /**
   * Clean up state when a box is closed
   */
  const cleanup = (boxId: number): void => {
    fetchStates.value.delete(boxId)
  }

  /**
   * Clear all fetch states (e.g., on page unload)
   */
  const clearAll = (): void => {
    fetchStates.value.clear()
  }

  return {
    fetchStates,
    initQueryResult,
    getFetchState,
    updateFetchProgress,
    setFetching,
    setBackgroundLoading,
    needsFetchForDisplayPage,
    getEffectiveTotalRows,
    hasPartialData,
    getLoadingProgress,
    cleanup,
    clearAll
  }
})
