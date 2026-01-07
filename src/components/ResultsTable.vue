<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'

interface QueryStats {
  engine?: 'duckdb' | 'bigquery'
  executionTimeMs?: number
  totalBytesProcessed?: string
  cacheHit?: boolean
}

const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const tableRef = ref<HTMLElement | null>(null)

const props = defineProps<{
  tableName?: string | null
  stats?: QueryStats | null
  error?: string | null
  boxName?: string
}>()

const emit = defineEmits<{
  'show-row-detail': [payload: { rowData: Record<string, unknown>; rowIndex: number; globalRowIndex: number }]
}>()

// UI state
const hoveredRowIndex = ref<number | null>(null)
const currentPage = ref(1)
const sortColumn = ref<string | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')

// Data state - fetched from DuckDB
const pageData = ref<Record<string, any>[]>([])
const columns = ref<string[]>([])
const totalRows = ref(0)
const isLoading = ref(false)

const pageSize = computed(() => settingsStore.paginationSize)

const totalPages = computed(() => {
  if (!totalRows.value) return 0
  return Math.ceil(totalRows.value / pageSize.value)
})

const hasResults = computed(() => totalRows.value > 0)
const isEmpty = computed(() => props.tableName && totalRows.value === 0 && !isLoading.value)

// Fetch a page of data from DuckDB
const fetchPage = async () => {
  if (!props.tableName) {
    pageData.value = []
    columns.value = []
    totalRows.value = 0
    return
  }

  isLoading.value = true
  try {
    const result = await duckdbStore.queryTablePage(
      props.tableName,
      currentPage.value,
      pageSize.value,
      sortColumn.value,
      sortDirection.value
    )
    pageData.value = result.rows
    columns.value = result.columns
  } catch (err) {
    console.error('Failed to fetch page:', err)
    pageData.value = []
  } finally {
    isLoading.value = false
  }
}

// Fetch total row count
const fetchRowCount = async () => {
  if (!props.tableName) {
    totalRows.value = 0
    return
  }

  try {
    totalRows.value = await duckdbStore.getTableRowCount(props.tableName)
  } catch (err) {
    console.error('Failed to fetch row count:', err)
    totalRows.value = 0
  }
}

// Watch tableName changes - reset and fetch new data
watch(() => props.tableName, async (newTableName) => {
  currentPage.value = 1
  sortColumn.value = null
  sortDirection.value = 'asc'

  if (newTableName) {
    await fetchRowCount()
    await fetchPage()
  } else {
    pageData.value = []
    columns.value = []
    totalRows.value = 0
  }
}, { immediate: true })

// Watch pagination changes
watch(currentPage, fetchPage)

// Watch sort changes - reset to page 1 and fetch
watch([sortColumn, sortDirection], () => {
  currentPage.value = 1
  fetchPage()
})

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

const handleSort = (column: string) => {
  if (sortColumn.value === column) {
    // Toggle direction if clicking the same column
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    // New column - default to ascending
    sortColumn.value = column
    sortDirection.value = 'asc'
  }
}

// Export dropdown state
const showExportMenu = ref(false)
const isExporting = ref(false)

type ExportFormat = 'csv' | 'json' | 'parquet' | 'xlsx'

// Download results using DuckDB's native export
const downloadAs = async (format: ExportFormat) => {
  if (!props.tableName) return

  showExportMenu.value = false
  isExporting.value = true

  try {
    const filename = `${props.boxName || 'results'}.${format}`

    const blob = await duckdbStore.exportTable(
      props.tableName,
      format,
      filename,
      sortColumn.value,
      sortDirection.value
    )

    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename,
      style: 'display:none'
    })
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error(`Failed to export as ${format}:`, err)
  } finally {
    isExporting.value = false
  }
}

// Close export menu when clicking outside
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.closest('.export-dropdown')) {
    showExportMenu.value = false
  }
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

onMounted(() => {
  document.addEventListener('copy', handleCopy)
  document.addEventListener('click', handleClickOutside)
})
onUnmounted(() => {
  document.removeEventListener('copy', handleCopy)
  document.removeEventListener('click', handleClickOutside)
})

defineExpose({ resetPagination })
</script>

<template>
  <section class="results-section">
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>

    <div class="table-container" role="region" aria-label="Query results" tabindex="0">
      <div v-if="isLoading" class="loading-overlay">
        <span class="loading-text">Loading...</span>
      </div>

      <table v-if="hasResults" ref="tableRef" class="results-table">
        <thead>
          <tr>
            <th scope="col" class="row-number-col">#</th>
            <th
              v-for="column in columns"
              :key="column"
              scope="col"
              :class="{
                'sortable': true,
                'sorted': sortColumn === column
              }"
              @click="handleSort(column)"
            >
              <span class="column-header">
                <span class="column-name">{{ column }}</span>
                <span class="sort-indicator">
                  <svg
                    v-if="sortColumn === column && sortDirection === 'asc'"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-label="Sorted ascending"
                  >
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                  <svg
                    v-else-if="sortColumn === column && sortDirection === 'desc'"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-label="Sorted descending"
                  >
                    <path d="M12 5v14M5 12l7 7 7-7"/>
                  </svg>
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in pageData"
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

    <footer v-if="hasResults || isLoading" class="results-footer">
      <div class="results-meta">
        <span v-if="stats?.engine" class="engine-badge" :data-engine="stats.engine">
          {{ stats.engine === 'bigquery' ? 'BigQuery' : 'DuckDB' }}
        </span>
        <span class="stat">{{ totalRows }} {{ totalRows === 1 ? 'row' : 'rows' }}</span>
        <span v-if="stats?.executionTimeMs" class="stat">{{ formatTime(stats.executionTimeMs) }}</span>
        <span v-if="stats?.totalBytesProcessed" class="stat">{{ formatBytes(stats.totalBytesProcessed) }}</span>
        <span v-if="stats?.cacheHit" class="stat cache-hit">Cached</span>
      </div>

      <div class="results-actions">
        <nav class="pagination" aria-label="Results pagination">
          <button
            class="pagination-btn"
            :disabled="currentPage === 1 || isLoading"
            @click.stop="prevPage"
            aria-label="Previous page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span class="page-info">{{ currentPage }} / {{ totalPages || 1 }}</span>
          <button
            class="pagination-btn"
            :disabled="currentPage === totalPages || isLoading"
            @click.stop="nextPage"
            aria-label="Next page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </nav>

        <div class="export-dropdown">
          <button
            class="download-btn"
            @click.stop="showExportMenu = !showExportMenu"
            :disabled="isLoading || isExporting"
            aria-label="Export data"
            aria-haspopup="true"
            :aria-expanded="showExportMenu"
          >
            <svg v-if="!isExporting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <span v-else class="export-spinner"></span>
          </button>
          <div v-if="showExportMenu" class="export-menu" role="menu">
            <button class="export-option" role="menuitem" @click="downloadAs('csv')">
              <span class="format-name">CSV</span>
              <span class="format-desc">Comma-separated values</span>
            </button>
            <button class="export-option" role="menuitem" @click="downloadAs('json')">
              <span class="format-name">JSON</span>
              <span class="format-desc">JavaScript Object Notation</span>
            </button>
            <button class="export-option" role="menuitem" @click="downloadAs('parquet')">
              <span class="format-name">Parquet</span>
              <span class="format-desc">Columnar format (compressed)</span>
            </button>
            <button class="export-option" role="menuitem" @click="downloadAs('xlsx')">
              <span class="format-name">Excel</span>
              <span class="format-desc">Microsoft Excel spreadsheet</span>
            </button>
          </div>
        </div>
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
  position: relative;
}

/* Loading Overlay */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-primary);
  opacity: 0.8;
  z-index: 10;
}

.loading-text {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
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

/* Sortable header cells */
.results-table thead th.sortable {
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}

.results-table thead th.sortable:hover {
  background: var(--table-row-hover-bg);
}

.results-table thead th.sortable.sorted {
  font-weight: 600;
}

/* Column header layout */
.column-header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.column-name {
  flex: 1;
}

.sort-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.sorted .sort-indicator {
  color: var(--text-primary);
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
  padding: var(--box-header-padding);
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

.download-btn:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.download-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Export Dropdown */
.export-dropdown {
  position: relative;
}

.export-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: var(--space-1);
  background: var(--surface-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--border-radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
  z-index: 100;
  overflow: hidden;
}

.export-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.export-option:hover {
  background: var(--surface-secondary);
}

.export-option:not(:last-child) {
  border-bottom: 1px solid var(--border-tertiary);
}

.format-name {
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.format-desc {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Export Spinner */
.export-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-secondary);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
