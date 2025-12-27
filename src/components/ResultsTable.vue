<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  results: { type: Array, default: null },
  stats: { type: Object, default: null },
  error: { type: String, default: null },
  boxName: { type: String, default: 'results' }
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

// Convert results to CSV and download
const downloadCSV = () => {
  if (!props.results || props.results.length === 0) return

  // Convert to CSV format
  const headers = columns.value
  const csvRows = []

  // Add header row
  csvRows.push(headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','))

  // Add data rows
  for (const row of props.results) {
    const values = headers.map(header => {
      const value = row[header]
      if (value === null || value === undefined) return ''
      // Escape quotes and wrap in quotes
      return `"${String(value).replace(/"/g, '""')}"`
    })
    csvRows.push(values.join(','))
  }

  const csvContent = csvRows.join('\n')

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', `${props.boxName}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
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
        <span v-if="stats && stats.engine" class="engine-badge" :class="`engine-${stats.engine}`">
          {{ stats.engine === 'bigquery' ? 'BigQuery' : 'DuckDB' }}
        </span>
        <span v-if="stats && stats.engine" class="stats-divider">•</span>
        <span class="results-stat">{{ results.length }} {{ results.length === 1 ? 'row' : 'rows' }}</span>
        <span v-if="stats && stats.executionTimeMs" class="stats-divider">•</span>
        <span v-if="stats && stats.executionTimeMs" class="results-stat">
          {{ formatTime(stats.executionTimeMs) }}
        </span>
        <span v-if="stats && stats.totalBytesProcessed" class="stats-divider">•</span>
        <span v-if="stats && stats.totalBytesProcessed" class="results-stat">
          {{ formatBytes(stats.totalBytesProcessed) }}
        </span>
        <span v-if="stats && stats.engine === 'bigquery'" class="stats-divider">•</span>
        <span v-if="stats && stats.engine === 'bigquery'" class="results-stat" :class="{ 'cache-hit': stats.cacheHit }">
          {{ stats.cacheHit ? '⚡ Cached' : '' }}
        </span>
      </div>
      <div class="footer-actions">
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
        <button
          @click.stop="downloadCSV"
          class="download-btn"
          title="Download as CSV"
        >
          ⬇
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
  background: var(--surface-primary);
}

.error-banner {
  padding: var(--space-2) var(--space-3);
  background: var(--color-error-bg);
  border-bottom: var(--border-width-thin) solid var(--border-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-weight: bold;
  flex-shrink: 0;
}

.results-footer {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-primary);
  border-top: var(--border-width-thin) solid var(--border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  min-height: 36px;
}

.results-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
}

.results-stat {
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-weight: normal;
  white-space: nowrap;
}

.stats-divider {
  color: var(--text-secondary);
  font-size: var(--font-size-body-sm);
  opacity: 0.5;
  user-select: none;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.download-btn {
  background: transparent;
  color: var(--text-primary);
  border: none;
  padding: 0;
  border-radius: var(--button-border-radius);
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s ease, border-color 0.15s ease;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.download-btn:hover {
  background: var(--surface-secondary);
  border-color: var(--text-secondary);
}

.download-btn:focus {
  outline: none;
}

.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px;
  border-radius: var(--button-border-radius);
}

.pagination-btn {
  background: transparent;
  color: var(--text-primary);
  border: none;
  padding: 4px 8px;
  border-radius: calc(var(--button-border-radius) - 2px);
  cursor: pointer;
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  transition: background 0.15s ease;
  outline: none;
  font-family: var(--font-family-ui);
  min-width: 24px;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--surface-primary);
}

.pagination-btn:focus {
  outline: none;
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  color: var(--text-primary);
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  user-select: none;
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
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--table-font-size);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
}

.results-table th {
  padding: var(--table-cell-padding);
  font-weight: bold;
  white-space: nowrap;
  background: var(--surface-primary);
  z-index: 10;
  border-bottom: var(--table-border-width) solid var(--border-primary);
  min-width: 150px;
  vertical-align: bottom;
}

.results-table td {
  padding: var(--table-cell-padding);
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
  font-family: var(--font-family-mono);
}

/* Headers always align with their column content */
.results-table th.text-column {
  text-align: left;
}

.results-table th.numeric-column {
  text-align: left;
}

.results-table tbody tr:nth-child(even) {
  background: var(--table-row-stripe-bg);
}

.results-table tbody tr:nth-child(odd) {
  background: var(--surface-primary);
}

.results-table tbody tr:hover {
  background: var(--table-row-hover-bg);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.engine-badge {
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: var(--font-size-caption);
}

.engine-bigquery {
  background: #4285f4;
  color: white;
}

.engine-duckdb {
  background: #ffc107;
  color: black;
}
</style>
