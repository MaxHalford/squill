<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings'

interface QueryStats {
  engine?: 'duckdb' | 'bigquery'
  executionTimeMs?: number
  totalBytesProcessed?: string
  cacheHit?: boolean
}

const settingsStore = useSettingsStore()
const tableRef = ref<HTMLElement | null>(null)

const props = defineProps<{
  results?: Record<string, unknown>[] | null
  stats?: QueryStats | null
  error?: string | null
  boxName?: string
}>()

const emit = defineEmits<{
  'show-row-detail': [payload: { rowData: Record<string, unknown>; rowIndex: number; globalRowIndex: number }]
}>()

const hoveredRowIndex = ref<number | null>(null)
const currentPage = ref(1)

const pageSize = computed(() => settingsStore.paginationSize)

const columns = computed(() => {
  if (!props.results?.length) return []
  return Object.keys(props.results[0])
})

const numericColumns = computed(() => {
  if (!props.results?.length) return new Set<string>()

  const numeric = new Set<string>()
  const sampleSize = Math.min(10, props.results.length)

  for (const column of columns.value) {
    let numericCount = 0
    for (let i = 0; i < sampleSize; i++) {
      const value = props.results[i][column]
      if (value === null || value === undefined || value === '') continue
      if (!isNaN(Number(value)) && isFinite(Number(value))) numericCount++
    }
    if (numericCount / sampleSize > 0.8) numeric.add(column)
  }

  return numeric
})

const totalPages = computed(() => {
  if (!props.results?.length) return 0
  return Math.ceil(props.results.length / pageSize.value)
})

const paginatedData = computed(() => {
  if (!props.results) return []
  const start = (currentPage.value - 1) * pageSize.value
  return props.results.slice(start, start + pageSize.value)
})

const hasResults = computed(() => props.results && props.results.length > 0)
const isEmpty = computed(() => props.results && props.results.length === 0)

// Format bytes to human-readable
const formatBytes = (bytes: string | number | undefined): string => {
  if (!bytes) return '0 B'
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
  if (num === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(num) / Math.log(1024))
  return `${Math.round(num / Math.pow(1024, i) * 100) / 100} ${units[i]}`
}

// Format milliseconds to human-readable
const formatTime = (ms: number | undefined): string => {
  if (!ms) return '0ms'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const handleShowDetail = (row: Record<string, unknown>, index: number) => {
  emit('show-row-detail', {
    rowData: row,
    rowIndex: index,
    globalRowIndex: (currentPage.value - 1) * pageSize.value + index
  })
}

const nextPage = () => {
  if (currentPage.value < totalPages.value) currentPage.value++
}

const prevPage = () => {
  if (currentPage.value > 1) currentPage.value--
}

const resetPagination = () => {
  currentPage.value = 1
}

const downloadCSV = () => {
  if (!props.results?.length) return

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    return `"${String(val).replace(/"/g, '""')}"`
  }

  const rows = [
    columns.value.map(escape).join(','),
    ...props.results.map(row => columns.value.map(col => escape(row[col])).join(','))
  ]

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `${props.boxName || 'results'}.csv`,
    style: 'display:none'
  })
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Copy handler for Google Sheets compatibility (TSV format)
const handleCopy = (event: ClipboardEvent) => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !tableRef.value) return

  const range = selection.getRangeAt(0)
  if (!tableRef.value.contains(range.commonAncestorContainer)) return

  const rows: string[][] = []

  tableRef.value.querySelectorAll('tr').forEach(row => {
    const cells: string[] = []
    let hasSelection = false

    row.querySelectorAll('th, td').forEach(cell => {
      if (selection.containsNode(cell, true)) {
        hasSelection = true
        cells.push(cell.textContent?.trim() || '')
      } else {
        cells.push('')
      }
    })

    if (hasSelection) {
      // Trim empty cells from start/end
      let start = 0, end = cells.length - 1
      while (start < cells.length && !cells[start]) start++
      while (end >= 0 && !cells[end]) end--
      rows.push(cells.slice(start, end + 1))
    }
  })

  if (rows.length) {
    event.preventDefault()
    event.clipboardData?.setData('text/plain', rows.map(r => r.join('\t')).join('\n'))
  }
}

onMounted(() => document.addEventListener('copy', handleCopy))
onUnmounted(() => document.removeEventListener('copy', handleCopy))

defineExpose({ resetPagination })
</script>

<template>
  <section class="results-section">
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>

    <div class="table-container" role="region" aria-label="Query results" tabindex="0">
      <table v-if="hasResults" ref="tableRef" class="results-table">
        <thead>
          <tr>
            <th scope="col" class="row-number-col">#</th>
            <th
              v-for="column in columns"
              :key="column"
              scope="col"
              :class="{ 'col-numeric': numericColumns.has(column) }"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in paginatedData"
            :key="`${currentPage}-${index}`"
            @mouseenter="hoveredRowIndex = index"
            @mouseleave="hoveredRowIndex = null"
          >
            <th scope="row" class="row-number-col">
              <span class="row-number" :class="{ hidden: hoveredRowIndex === index }">
                {{ (currentPage - 1) * pageSize + index + 1 }}
              </span>
              <button
                class="detail-btn"
                :class="{ visible: hoveredRowIndex === index }"
                @click.stop="handleShowDetail(row, index)"
                aria-label="View row details"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </th>
            <td
              v-for="column in columns"
              :key="column"
              :class="{
                'col-numeric': numericColumns.has(column),
                'null-value': row[column] === null
              }"
            >
              {{ row[column] === null ? 'null' : row[column] }}
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else-if="isEmpty" class="empty-state">No results found</div>
    </div>

    <footer v-if="hasResults" class="results-footer">
      <div class="results-meta">
        <span v-if="stats?.engine" class="engine-badge" :data-engine="stats.engine">
          {{ stats.engine === 'bigquery' ? 'BigQuery' : 'DuckDB' }}
        </span>
        <span class="stat">{{ results!.length }} {{ results!.length === 1 ? 'row' : 'rows' }}</span>
        <span v-if="stats?.executionTimeMs" class="stat">{{ formatTime(stats.executionTimeMs) }}</span>
        <span v-if="stats?.totalBytesProcessed" class="stat">{{ formatBytes(stats.totalBytesProcessed) }}</span>
        <span v-if="stats?.cacheHit" class="stat cache-hit">Cached</span>
      </div>

      <div class="results-actions">
        <nav class="pagination" aria-label="Results pagination">
          <button
            class="pagination-btn"
            :disabled="currentPage === 1"
            @click.stop="prevPage"
            aria-label="Previous page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
          <button
            class="pagination-btn"
            :disabled="currentPage === totalPages"
            @click.stop="nextPage"
            aria-label="Next page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </nav>

        <button
          class="download-btn"
          @click.stop="downloadCSV"
          aria-label="Download as CSV"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.results-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: clip;
  border-block-start: var(--border-width-thin) solid var(--border-primary);
}

.error-banner {
  padding: var(--space-2) var(--space-3);
  background: var(--color-error-bg);
  border-block-end: var(--border-width-thin) solid var(--border-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  flex-shrink: 0;
}

/* Table Container - scrollable region with accessibility support */
.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: default;
}

/* Table Base - using border-collapse: collapse for modern approach */
.results-table {
  border-collapse: collapse;
  font-size: var(--table-font-size);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  text-align: start;
}

.results-table ::selection {
  background: var(--color-selection);
}

/* All cells base styles */
.results-table th,
.results-table td {
  padding: var(--table-cell-padding);
  white-space: nowrap;
  vertical-align: baseline;
}

/* Header cells */
.results-table thead th {
  position: sticky;
  inset-block-start: 0;
  z-index: 2;
  background: var(--surface-primary);
  font-weight: 500;
  text-align: start;
  min-width: 150px;
  user-select: text;
  cursor: text;
  /* Use box-shadow for border since regular borders have issues with sticky */
  box-shadow: inset 0 -1px 0 var(--border-secondary);
}

/* Vertical separator between header columns */
.results-table thead th:not(:last-child)::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: 1px;
  background: var(--border-secondary);
}

/* Data cells */
.results-table td {
  min-width: 150px;
  user-select: text;
  cursor: text;
  border-block-end: 1px solid var(--border-tertiary);
}

/* Row backgrounds */
.results-table tbody tr {
  background: var(--surface-primary);
}

.results-table tbody tr:hover {
  background: var(--table-row-hover-bg);
}

/* Numeric column alignment */
.col-numeric {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

/* Null values */
.null-value {
  color: var(--text-tertiary);
  font-style: italic;
}

/* Row Number Column - sticky on inline-start (left in LTR) */
.results-table .row-number-col {
  position: sticky;
  inset-inline-start: 0;
  width: 0;
  min-width: 0;
  padding: var(--space-2);
  text-align: center;
  user-select: none;
  background: var(--surface-primary);
  /* Border via box-shadow to work with sticky */
  box-shadow: inset -1px 0 0 var(--border-secondary);
}

/* Header row number cell - highest z-index since it's sticky in both directions */
.results-table thead .row-number-col {
  z-index: 3;
  /* Combined shadows for both borders */
  box-shadow:
    inset 0 -1px 0 var(--border-secondary),
    inset -1px 0 0 var(--border-secondary);
}

/* Body row number cells need proper background for hover state */
.results-table tbody tr:hover .row-number-col {
  background: var(--table-row-hover-bg);
}

.row-number {
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  transition: opacity 0.1s;
}

.row-number.hidden {
  opacity: 0;
}

/* Detail Button */
.detail-btn {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s, background 0.1s;
}

.detail-btn.visible {
  opacity: 1;
  pointer-events: auto;
}

.detail-btn:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

/* Footer */
.results-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-primary);
  border-block-start: var(--border-width-thin) solid var(--border-primary);
  flex-shrink: 0;
}

.results-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.stat {
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  white-space: nowrap;
}

.stat::before {
  content: '·';
  margin-inline-end: var(--space-2);
  color: var(--text-tertiary);
}

.stat:first-child::before,
.engine-badge + .stat::before {
  display: none;
}

.cache-hit {
  color: var(--color-success);
}

/* Engine Badge */
.engine-badge {
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: var(--font-size-caption);
}

.engine-badge[data-engine="bigquery"] {
  background: var(--color-bigquery);
  color: white;
}

.engine-badge[data-engine="duckdb"] {
  background: var(--color-duckdb);
  color: black;
}

/* Actions */
.results-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.pagination-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  padding: 0 var(--space-1);
  user-select: none;
}

/* Download Button */
.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s;
}

.download-btn:hover {
  background: var(--surface-secondary);
}

/* Empty State */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}
</style>
