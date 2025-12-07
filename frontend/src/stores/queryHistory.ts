/**
 * Query history store for tracking successful queries per connection
 * Used to provide sample queries as context for the SQL fixer
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX_SAMPLE_QUERIES = 5

interface SampleQuery {
  query: string
  timestamp: number
}

export const useQueryHistoryStore = defineStore('queryHistory', () => {
  // Map: connectionId -> array of recent successful queries
  const sampleQueries = ref<Map<string, SampleQuery[]>>(new Map())

  /**
   * Record a successful query for a connection
   * Maintains a ring buffer of the last MAX_SAMPLE_QUERIES queries
   */
  function recordSuccessfulQuery(connectionId: string, query: string): void {
    // Normalize query (trim whitespace)
    const normalizedQuery = query.trim()

    // Skip empty queries
    if (!normalizedQuery) return

    const queries = sampleQueries.value.get(connectionId) || []

    // Skip duplicates (same query text already exists)
    const isDuplicate = queries.some((q) => q.query === normalizedQuery)
    if (isDuplicate) return

    // Add new query
    queries.push({
      query: normalizedQuery,
      timestamp: Date.now(),
    })

    // Keep only the last MAX_SAMPLE_QUERIES
    while (queries.length > MAX_SAMPLE_QUERIES) {
      queries.shift()
    }

    sampleQueries.value.set(connectionId, queries)
  }

  /**
   * Get sample queries for a connection
   * Returns an array of query strings (most recent last)
   */
  function getSampleQueries(connectionId: string): string[] {
    const queries = sampleQueries.value.get(connectionId) || []
    return queries.map((q) => q.query)
  }

  /**
   * Clear history for a specific connection
   */
  function clearHistory(connectionId: string): void {
    sampleQueries.value.delete(connectionId)
  }

  /**
   * Clear all query history
   */
  function clearAllHistory(): void {
    sampleQueries.value.clear()
  }

  return {
    sampleQueries,
    recordSuccessfulQuery,
    getSampleQueries,
    clearHistory,
    clearAllHistory,
  }
})
