<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  results: { type: Array, default: null },
  stats: { type: Object, default: null },
  error: { type: String, default: null }
})

// Format bytes to human-readable format
const formatBytes = (bytes) => {
  if (!bytes || bytes === '0') return '0 B'
  const num = parseInt(bytes)
  if (num === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(num) / Math.log(k))
  return Math.round(num / Math.pow(k, i) * 100) / 100 + ' ' + units[i]
}

// Format milliseconds to human-readable format
const formatTime = (ms) => {
  if (!ms) return '0ms'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const currentPage = ref(1)
const pageSize = ref(10)

const columns = computed(() => {
  if (!props.results || props.results.length === 0) return []
  return Object.keys(props.results[0])
})

// Detect if a column contains numeric data
const isNumericColumn = computed(() => {
  if (!props.results || props.results.length === 0) return {}

  const numericColumns = {}
  columns.value.forEach(column => {
    // Sample first 10 rows to determine if column is numeric
    const sampleSize = Math.min(10, props.results.length)
    let numericCount = 0

    for (let i = 0; i < sampleSize; i++) {
      const value = props.results[i][column]
      if (value === null || value === undefined || value === '') continue

      // Check if value is a number or can be parsed as number
      const numValue = Number(value)
      if (!isNaN(numValue) && isFinite(numValue)) {
        numericCount++
      }
    }

    // If more than 80% of sampled values are numeric, treat as numeric column
    numericColumns[column] = (numericCount / sampleSize) > 0.8
  })

  return numericColumns
})

// Get CSS class for column alignment
const getColumnClass = (column) => {
  return isNumericColumn.value[column] ? 'numeric-column' : 'text-column'
}

const totalPages = computed(() => {
  if (!props.results) return 0
  return Math.ceil(props.results.length / pageSize.value)
})

const paginatedData = computed(() => {
  if (!props.results) return []
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return props.results.slice(start, end)
})

const nextPage = (e) => {
  e.stopPropagation()
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}

const prevPage = (e) => {
  e.stopPropagation()
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

// Reset to page 1 when results change
const resetPagination = () => {
  currentPage.value = 1
}

defineExpose({
  resetPagination
})
</script>

<template>
  <div class="results-section">
    <div v-if="error" class="error-banner">
      {{ error }}
    </div>
    <div class="table-container">
      <table
        v-if="results && results.length > 0"
        class="results-table"
      >
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column"
              :class="getColumnClass(column)"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in paginatedData" :key="`row-${currentPage}-${index}`">
            <td
              v-for="column in columns"
              :key="column"
              :class="getColumnClass(column)"
            >
              {{ row[column] }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="results && results.length === 0" class="empty-state">
        No results found
      </div>
    </div>
    <div v-if="results && results.length > 0" class="results-footer">
      <div class="results-info">
        <span class="results-stat">{{ results.length }} {{ results.length === 1 ? 'row' : 'rows' }}</span>
        <span v-if="stats" class="stats-divider">•</span>
        <span v-if="stats && stats.executionTimeMs" class="results-stat">
          {{ formatTime(stats.executionTimeMs) }}
        </span>
        <span v-if="stats && stats.totalBytesProcessed" class="stats-divider">•</span>
        <span v-if="stats && stats.totalBytesProcessed" class="results-stat">
          {{ formatBytes(stats.totalBytesProcessed) }} processed
        </span>
      </div>
      <div class="pagination">
        <button
          @click.stop="prevPage"
          :disabled="currentPage === 1"
          class="pagination-btn"
        >
          ←
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button
          @click.stop="nextPage"
          :disabled="currentPage === totalPages"
          class="pagination-btn"
        >
          →
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.results-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;
}

.error-banner {
  padding: 10px 12px;
  background: #ffebee;
  border-bottom: 1px solid #c62828;
  color: #c62828;
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
}

.results-footer {
  padding: 8px 12px;
  background: white;
  border-top: 1px solid black;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.results-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.results-stat {
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-weight: normal;
}

.stats-divider {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: bold;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-btn {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: var(--border-width) solid var(--border-color);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: bold;
  transition: none;
  outline: none;
  font-family: var(--font-ui);
}

.pagination-btn:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.pagination-btn:focus {
  outline: none;
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  background: var(--bg-secondary);
}

.page-info {
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  min-width: 50px;
  text-align: center;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: default;
  position: relative;
}

.results-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: var(--font-size-sm);
  font-family: var(--font-results);
  color: var(--text-primary);
}

.results-table thead {
  position: sticky;
  top: 0;
  background: var(--bg-primary);
  z-index: 10;
}

.results-table thead tr {
  display: table-row;
}

.results-table th {
  padding: 8px 12px;
  font-weight: bold;
  white-space: nowrap;
  background: var(--bg-primary);
  position: sticky;
  top: -1px;
  z-index: 10;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  min-width: 150px;
  vertical-align: bottom;
}

.results-table td {
  padding: 8px 12px;
  white-space: nowrap;
  min-width: 150px;
  vertical-align: baseline;
}

/* Text columns: left-aligned */
.text-column {
  text-align: left;
}

/* Numeric columns: right-aligned with monospace font */
.numeric-column {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-results);
}

/* Headers always align with their column content */
.results-table th.text-column {
  text-align: left;
}

.results-table th.numeric-column {
  text-align: left;
}

.results-table tbody tr:nth-child(even) {
  background: #f5f5f5;
}

.results-table tbody tr:nth-child(odd) {
  background: white;
}

.results-table tbody tr:hover {
  background: #e8e8e8;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
}
</style>
