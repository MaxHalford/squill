<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useDuckDBStore } from '../stores/duckdb'
import { useQueryResultsStore } from '../stores/queryResults'
import { getTypeCategory, simplifyTypeName, formatDateValue } from '../utils/typeUtils'
import { formatRowCount } from '../utils/formatUtils'
import { DATABASE_INFO, type DatabaseEngine } from '../types/database'

interface QueryStats {
  engine?: DatabaseEngine
  executionTimeMs?: number
  totalBytesProcessed?: string
  cacheHit?: boolean
}

const settingsStore = useSettingsStore()
const duckdbStore = useDuckDBStore()
const queryResultsStore = useQueryResultsStore()
const tableRef = ref<HTMLElement | null>(null)

const props = withDefaults(defineProps<{
  tableName?: string | null
  stats?: QueryStats | null
  error?: string | null
  isFetchingFix?: boolean
  noRelevantFix?: boolean
  boxName?: string
  showRowDetail?: boolean
  showAnalytics?: boolean
  connectionName?: string
  boxId?: number | null  // For accessing fetch state
}>(), {
  showRowDetail: true,
  showAnalytics: true,
  boxId: null
})

const emit = defineEmits<{
  'show-row-detail': [payload: { rowData: Record<string, unknown>; columnTypes: Record<string, string>; rowIndex: number; globalRowIndex: number; clickX: number; clickY: number }]
  'show-column-analytics': [payload: { columnName: string; columnType: string; typeCategory: string; tableName: string; clickX: number; clickY: number; sourceEngine?: string; originalQuery?: string; connectionId?: string; availableColumns?: string[] }]
  'request-more-data': [neededRows: number]
}>()

// UI state
const hoveredRowIndex = ref<number | null>(null)
const hoveredColumn = ref<string | null>(null)
const currentPage = ref(1)
const animationKey = ref(0) // Incremented to trigger row animations

// Data state - fetched from DuckDB
const pageData = ref<Record<string, any>[]>([])
const columns = ref<string[]>([])
const columnTypes = ref<Record<string, string>>({})
const duckdbRowCount = ref(0) // Row count from DuckDB (for non-paginated queries)
const isLoading = ref(false)

// Column resize state
const columnWidths = ref<Record<string, number>>({})
const resizingColumn = ref<string | null>(null)
const resizeStartX = ref(0)
const resizeStartWidth = ref(0)

const pageSize = computed(() => settingsStore.paginationSize)

// Get fetch state for this box if available
const fetchState = computed(() => {
  if (props.boxId === null || props.boxId === undefined) return null
  return queryResultsStore.getFetchState(props.boxId)
})

// Use source total rows when available, fallback to DuckDB count
const sourceTotalRows = computed(() => {
  if (fetchState.value?.totalRows !== null && fetchState.value?.totalRows !== undefined) {
    return fetchState.value.totalRows
  }
  return duckdbRowCount.value
})

// Check if data is partially loaded (more rows available from source)
const isPartialData = computed(() => {
  if (!fetchState.value) return false
  return fetchState.value.hasMoreRows ||
    (fetchState.value.totalRows !== null && fetchState.value.fetchedRows < fetchState.value.totalRows)
})

// Loading progress percentage
const loadingProgress = computed(() => {
  if (!fetchState.value || !fetchState.value.totalRows) return '100'
  const percent = (fetchState.value.fetchedRows / fetchState.value.totalRows) * 100
  if (percent < 1) return '<1'
  return Math.round(percent).toString()
})

const totalPages = computed(() => {
  // Use source total for pagination if available
  const total = sourceTotalRows.value
  if (!total) return 0
  return Math.ceil(total / pageSize.value)
})

const hasResults = computed(() => duckdbRowCount.value > 0)
const isEmpty = computed(() => props.tableName && duckdbRowCount.value === 0 && !isLoading.value && !isWaitingForData.value)

// Check if we're waiting for data to be loaded from source (for lazy loading)
const isWaitingForData = computed(() => {
  if (!fetchState.value) return false
  // If background loading is in progress and we don't have data for current page
  if (fetchState.value.isBackgroundLoading) {
    const neededEndRow = currentPage.value * pageSize.value
    return neededEndRow > fetchState.value.fetchedRows
  }
  return false
})

// Check if background loading is in progress (for footer indicator)
const isBackgroundLoading = computed(() => {
  return fetchState.value?.isBackgroundLoading ?? false
})

// Compute row number column width based on current page's max row number
const rowNumberColWidth = computed(() => {
  const maxRowOnPage = (currentPage.value - 1) * pageSize.value + pageData.value.length
  if (maxRowOnPage <= 0) return 24
  const digits = Math.floor(Math.log10(maxRowOnPage)) + 1
  // ~6px per digit at 10px font + padding (12px horizontal)
  return digits * 6 + 12
})

// Compute table width based on column widths
const tableStyle = computed(() => {
  const totalColumnWidth = columns.value.reduce((sum, col) => sum + (columnWidths.value[col] || 150), 0)
  return { width: (rowNumberColWidth.value + totalColumnWidth) + 'px' }
})

// Fetch a page of data from DuckDB
const fetchPage = async () => {
  if (!props.tableName) {
    pageData.value = []
    columns.value = []
    columnTypes.value = {}
    duckdbRowCount.value = 0
    return
  }

  isLoading.value = true
  try {
    const result = await duckdbStore.queryTablePage(
      props.tableName,
      currentPage.value,
      pageSize.value
    )
    pageData.value = result.rows
    columns.value = result.columns
    columnTypes.value = result.columnTypes
    animationKey.value++ // Trigger row reveal animation
  } catch (err) {
    console.error('Failed to fetch page:', err)
    pageData.value = []
  } finally {
    isLoading.value = false
  }
}

// Fetch total row count from DuckDB (only needed for non-paginated queries)
const fetchRowCount = async () => {
  if (!props.tableName) {
    duckdbRowCount.value = 0
    return
  }

  // If we have fetchState with totalRows, use that instead of querying DuckDB
  if (fetchState.value?.totalRows !== null && fetchState.value?.totalRows !== undefined) {
    duckdbRowCount.value = fetchState.value.fetchedRows
    return
  }

  try {
    duckdbRowCount.value = await duckdbStore.getTableRowCount(props.tableName)
  } catch (err) {
    console.error('Failed to fetch row count:', err)
    duckdbRowCount.value = 0
  }
}

// Calculate initial column widths based on column names and types
const calculateInitialColumnWidths = () => {
  const newWidths: Record<string, number> = {}
  const charWidth = 8 // Approximate character width in pixels for monospace font
  const padding = 50 // Extra padding for icons, resize handle, etc.
  const minWidth = 140
  const maxWidth = 300

  for (const col of columns.value) {
    // Base width on column name length
    const nameWidth = col.length * charWidth + padding
    // Clamp between min and max
    newWidths[col] = Math.min(maxWidth, Math.max(minWidth, nameWidth))
  }

  columnWidths.value = newWidths
}

// Watch tableName changes - reset and fetch new data
watch(() => props.tableName, async (newTableName) => {
  currentPage.value = 1
  columnWidths.value = {} // Reset column widths for new table

  if (newTableName) {
    await fetchRowCount()
    await fetchPage()
    // Calculate initial widths after columns are loaded
    calculateInitialColumnWidths()
  } else {
    pageData.value = []
    columns.value = []
    columnTypes.value = {}
    duckdbRowCount.value = 0
  }
}, { immediate: true })

// Watch pagination changes - check if we need more data from source
watch(currentPage, async () => {
  // Check if the requested page needs data beyond what's fetched
  if (props.boxId !== null) {
    const fetchState = queryResultsStore.getFetchState(props.boxId)
    if (fetchState && fetchState.hasMoreRows) {
      const neededStartRow = (currentPage.value - 1) * pageSize.value
      const neededEndRow = neededStartRow + pageSize.value

      // If we need rows beyond what's fetched, request more data
      if (neededEndRow > fetchState.fetchedRows) {
        emit('request-more-data', neededEndRow)
      }
    }
  }

  // Fetch page from DuckDB (may show partial/no data while loading more)
  await fetchPage()
})

// Watch for more data being loaded - refresh current page when new data arrives
watch(
  () => props.boxId !== null ? queryResultsStore.getFetchState(props.boxId)?.fetchedRows : null,
  (newFetchedRows, oldFetchedRows) => {
    // If more rows were fetched and we're on a page that might now have data
    if (typeof newFetchedRows === 'number' && typeof oldFetchedRows === 'number' && newFetchedRows > oldFetchedRows) {
      // Update local row count to reflect loaded data
      duckdbRowCount.value = newFetchedRows

      const neededEndRow = currentPage.value * pageSize.value
      // Refresh if we were waiting for this data
      if (neededEndRow <= newFetchedRows && neededEndRow > oldFetchedRows) {
        fetchPage()
      }
    }
  }
)

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

// Format cell value based on type
const formatCellValue = (value: unknown, columnType: string): string => {
  if (value === null) return 'null'

  const typeCategory = getTypeCategory(columnType)

  if (typeCategory === 'date') {
    return formatDateValue(value)
  }

  return String(value)
}

// Calculate BigQuery on-demand cost ($5 per TB)
const bigQueryCost = computed(() => {
  // Only show cost for BigQuery, non-cached queries
  if (props.stats?.engine !== 'bigquery') return null
  if (props.stats?.cacheHit) return null
  if (!props.stats?.totalBytesProcessed) return null

  const bytes = parseInt(props.stats.totalBytesProcessed, 10)
  if (bytes === 0) return null

  // BigQuery on-demand pricing: $5 per TB
  const TB = 1024 * 1024 * 1024 * 1024
  const costPerTB = 5
  const cost = (bytes / TB) * costPerTB

  // Format cost
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
})

const handleShowDetail = (event: MouseEvent, row: Record<string, unknown>, index: number) => {
  emit('show-row-detail', {
    rowData: row,
    columnTypes: columnTypes.value,
    rowIndex: index,
    globalRowIndex: (currentPage.value - 1) * pageSize.value + index,
    clickX: event.clientX,
    clickY: event.clientY
  })
}

const handleShowAnalytics = (event: MouseEvent, column: string) => {
  event.stopPropagation()
  const typeCategory = getTypeCategory(columnTypes.value[column] || '')

  // Don't show analytics for unsupported types
  if (typeCategory === 'binary' || typeCategory === 'json') return

  // Include source engine info for source-based analytics
  const state = fetchState.value
  emit('show-column-analytics', {
    columnName: column,
    columnType: columnTypes.value[column] || 'unknown',
    typeCategory,
    tableName: props.tableName || '',
    clickX: event.clientX,
    clickY: event.clientY,
    // Source engine info for running analytics against the source database
    sourceEngine: state?.sourceEngine,
    originalQuery: state?.originalQuery,
    connectionId: state?.connectionId,
    // All columns for GROUP BY feature
    availableColumns: columns.value
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

// Column resize handlers with RAF for smooth 60fps updates
let resizeRAF: number | null = null
let pendingResizeWidth: number | null = null

const startResize = (event: MouseEvent, column: string) => {
  resizingColumn.value = column
  resizeStartX.value = event.clientX
  const th = (event.target as HTMLElement).parentElement
  resizeStartWidth.value = th?.offsetWidth || 150

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.classList.add('resizing-column')
}

const handleResize = (event: MouseEvent) => {
  if (!resizingColumn.value) return
  const delta = event.clientX - resizeStartX.value
  pendingResizeWidth = Math.max(140, resizeStartWidth.value + delta)

  // Use RAF to batch updates for smooth 60fps resizing
  if (!resizeRAF) {
    resizeRAF = requestAnimationFrame(() => {
      if (resizingColumn.value && pendingResizeWidth !== null) {
        columnWidths.value[resizingColumn.value] = pendingResizeWidth
      }
      resizeRAF = null
    })
  }
}

const stopResize = () => {
  // Apply any pending resize immediately
  if (resizingColumn.value && pendingResizeWidth !== null) {
    columnWidths.value[resizingColumn.value] = pendingResizeWidth
  }

  // Cancel pending RAF
  if (resizeRAF) {
    cancelAnimationFrame(resizeRAF)
    resizeRAF = null
  }
  pendingResizeWidth = null

  resizingColumn.value = null
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.classList.remove('resizing-column')
}

// Export dropdown state
const showExportMenu = ref(false)
const isExporting = ref(false)

type ExportFormat = 'csv' | 'json' | 'parquet'

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
      filename
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
  // Clean up resize listeners in case component unmounts during resize
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
})

defineExpose({ resetPagination })
</script>

<template>
  <section class="results-section">
    <div v-if="error" class="error-banner" role="alert">
      <span>{{ error }}</span>
      <span v-if="isFetchingFix" class="fix-loading">Getting fix suggestion...</span>
      <span v-else-if="noRelevantFix" class="no-fix-found">No relevant fix found</span>
    </div>

    <div class="table-container" role="region" aria-label="Query results" tabindex="0">
      <table v-if="hasResults && !isBackgroundLoading" ref="tableRef" class="results-table" :style="tableStyle">
        <colgroup>
          <col class="row-number-col" :style="{ width: rowNumberColWidth + 'px' }">
          <col v-for="column in columns" :key="column" :style="{ width: (columnWidths[column] || 150) + 'px' }">
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="row-number-col"></th>
            <th
              v-for="column in columns"
              :key="column"
              scope="col"
              :class="{
                'number-cell': getTypeCategory(columnTypes[column] || '') === 'number'
              }"
              @mouseenter="hoveredColumn = column"
              @mouseleave="hoveredColumn = null"
            >
              <span class="column-header">
                <!-- Left group: type icon, column name, analytics button -->
                <span class="column-info">
                  <!-- Type icon -->
                  <span class="type-icon" v-tooltip="simplifyTypeName(columnTypes[column])">
                    <!-- Number type -->
                    <svg v-if="getTypeCategory(columnTypes[column] || '') === 'number'" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="2" y="5" width="3" height="8" rx="0.5"/>
                      <rect x="6.5" y="7" width="3" height="6" rx="0.5"/>
                      <rect x="11" y="3" width="3" height="10" rx="0.5"/>
                    </svg>
                    <!-- Text type -->
                    <svg v-else-if="getTypeCategory(columnTypes[column] || '') === 'text'" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2.5 3a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1h-11zM2.5 6a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1h-9zM2.5 9a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zM2.5 12a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5z"/>
                    </svg>
                    <!-- Date type -->
                    <svg v-else-if="getTypeCategory(columnTypes[column] || '') === 'date'" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="2" y="3" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                      <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" stroke-width="1.5"/>
                      <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      <line x1="11" y1="1" x2="11" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    <!-- Boolean type -->
                    <svg v-else-if="getTypeCategory(columnTypes[column] || '') === 'boolean'" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/>
                    </svg>
                    <!-- Binary type -->
                    <svg v-else-if="getTypeCategory(columnTypes[column] || '') === 'binary'" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5.526 13.09c.976 0 1.524-.79 1.524-2.205 0-1.412-.548-2.203-1.524-2.203-.978 0-1.526.79-1.526 2.203 0 1.415.548 2.206 1.526 2.206zm-.832-2.205c0-1.05.29-1.612.832-1.612.358 0 .607.247.733.721L4.7 11.137a6.749 6.749 0 0 1-.006-.252zm.832 1.614c-.36 0-.606-.246-.732-.718l1.556-1.145c.003.079.005.164.005.258 0 1.05-.29 1.605-.829 1.605zm5.329.501v-.595H9.73V8.772h-.69l-1.19.786v.688L8.986 9.5h.05v2.906h-1.18V13h3z"/>
                    </svg>
                    <!-- JSON/struct type - curly braces -->
                    <svg v-else-if="getTypeCategory(columnTypes[column] || '') === 'json'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 2C2.5 2 2 3 2 4v2.5c0 .5-.5 1.5-1.5 1.5 1 0 1.5 1 1.5 1.5V12c0 1 .5 2 2 2"/>
                      <path d="M12 2c1.5 0 2 1 2 2v2.5c0 .5.5 1.5 1.5 1.5-1 0-1.5 1-1.5 1.5V12c0 1-.5 2-2 2"/>
                    </svg>
                  </span>
                  <span class="column-name">{{ column }}</span>
                  <!-- Analytics button (right next to column name) -->
                  <button
                    v-if="showAnalytics"
                    class="analytics-btn"
                    :class="{
                      visible: hoveredColumn === column,
                      hidden: getTypeCategory(columnTypes[column] || '') === 'binary' ||
                              getTypeCategory(columnTypes[column] || '') === 'json'
                    }"
                    @click.stop="handleShowAnalytics($event, column)"
                    v-tooltip="'View column analytics'"
                    :tabindex="hoveredColumn === column ? 0 : -1"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                  </button>
                </span>
              </span>
              <div
                class="resize-handle"
                @mousedown.stop.prevent="startResize($event, column)"
              />
            </th>
          </tr>
        </thead>
        <tbody :key="animationKey">
          <tr
            v-for="(row, index) in pageData"
            :key="index"
            :style="{ '--row-index': index }"
            class="reveal-row"
            @mouseenter="hoveredRowIndex = index"
            @mouseleave="hoveredRowIndex = null"
          >
            <th scope="row" class="row-number-col">
              <span class="row-number" :class="{ hidden: showRowDetail && hoveredRowIndex === index }">
                {{ (currentPage - 1) * pageSize + index + 1 }}
              </span>
              <button
                v-if="showRowDetail"
                class="detail-btn"
                :class="{ visible: hoveredRowIndex === index }"
                @click.stop="handleShowDetail($event, row, index)"
                aria-label="View row details"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </th>
            <td
              v-for="column in columns"
              :key="column"
              :class="{
                'null-value': row[column] === null,
                'number-cell': getTypeCategory(columnTypes[column] || '') === 'number'
              }"
            >
              {{ formatCellValue(row[column], columnTypes[column] || '') }}
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else-if="isWaitingForData || isBackgroundLoading" class="loading-state">Fetching...</div>
      <div v-else-if="isEmpty" class="empty-state">Empty table</div>
    </div>

    <footer v-if="hasResults || isLoading || isWaitingForData" class="results-footer">
      <div class="results-meta">
        <span
          v-if="stats?.engine"
          class="engine-badge"
          :style="{
            background: DATABASE_INFO[stats.engine].color,
            color: DATABASE_INFO[stats.engine].textColor
          }"
          v-tooltip="connectionName"
        >
          {{ DATABASE_INFO[stats.engine].shortName }}
        </span>
        <span class="stat">
          {{ formatRowCount(sourceTotalRows) }}
          <span v-if="isPartialData" class="partial-indicator" v-tooltip="`${formatRowCount(fetchState?.fetchedRows || 0)} loaded`">
            ({{ loadingProgress }}%)
          </span>
        </span>
        <span v-if="stats?.executionTimeMs" class="stat">{{ formatTime(stats.executionTimeMs) }}</span>
        <span v-if="stats?.totalBytesProcessed" class="stat" v-tooltip="'Bytes processed'">{{ formatBytes(stats.totalBytesProcessed) }}</span>
        <span v-if="stats?.cacheHit" class="stat cache-hit">Cached</span>
        <span v-if="bigQueryCost" class="stat" v-tooltip="'On-demand pricing, not factoring reservations'">{{ bigQueryCost }}</span>
      </div>

      <div class="results-actions">
        <nav class="pagination" aria-label="Results pagination">
          <button
            class="pagination-btn"
            :disabled="currentPage === 1 || isLoading"
            @click.stop="prevPage"
            aria-label="Previous page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span class="page-info">{{ currentPage.toLocaleString() }} / {{ (totalPages || 1).toLocaleString() }}</span>
          <button
            class="pagination-btn"
            :disabled="currentPage === totalPages || isLoading"
            @click.stop="nextPage"
            aria-label="Next page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
            v-tooltip="`Download ${formatRowCount(duckdbRowCount)} loaded`"
          >
            <svg v-if="!isExporting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <span v-else class="export-spinner"></span>
          </button>
          <Transition name="dropdown-up">
            <div v-if="showExportMenu" class="export-menu dropdown-menu" role="menu">
              <button class="export-option dropdown-menu-item" role="menuitem" @click="downloadAs('csv')">
                <span class="format-name">CSV</span>
                <span class="format-desc">Comma-separated values</span>
              </button>
              <button class="export-option dropdown-menu-item" role="menuitem" @click="downloadAs('json')">
                <span class="format-name">JSON</span>
                <span class="format-desc">JavaScript Object Notation</span>
              </button>
              <button class="export-option dropdown-menu-item" role="menuitem" @click="downloadAs('parquet')">
                <span class="format-name">Parquet</span>
                <span class="format-desc">Columnar format (compressed)</span>
              </button>
            </div>
          </Transition>
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
  overflow: hidden;
}

.error-banner {
  padding: var(--space-2) var(--space-3);
  background: var(--color-error-bg);
  border-block-end: var(--border-width-thin) solid var(--border-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.fix-loading {
  color: var(--text-secondary);
  font-weight: normal;
  font-style: italic;
}

.no-fix-found {
  color: var(--text-secondary);
  font-weight: normal;
  font-style: italic;
}

/* Table Container - scrollable region */
.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  cursor: default;
  position: relative;
  scrollbar-width: none;
  background: var(--surface-primary);
}

.table-container::-webkit-scrollbar {
  display: none;
}

/* Table Base - TUI Style */
.results-table {
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--table-font-size);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  text-align: start;
  line-height: 1.3;
}

.results-table ::selection {
  background: var(--color-selection);
}

/* All cells base styles - compact TUI padding */
.results-table th,
.results-table td {
  padding: var(--table-cell-padding);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
  vertical-align: middle;
}

/* Header cells - TUI style */
.results-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--table-header-bg);
  font-weight: 500;
  text-align: start;
  min-width: 60px;
  user-select: text;
  cursor: text;
}

/* Column resize handle */
.resize-handle {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  z-index: 1;
}

.resize-handle:hover {
  background: var(--text-tertiary);
}

/* Column header layout - compact TUI style */
.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
}

/* Left group: type icon, column name, analytics button */
.column-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.type-icon svg {
  width: 10px;
  height: 10px;
}

.column-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Analytics Button - compact */
.analytics-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
}

.analytics-btn svg {
  width: 10px;
  height: 10px;
}

.analytics-btn.visible {
  opacity: 1;
}

.analytics-btn.hidden {
  visibility: hidden;
  pointer-events: none;
}

.analytics-btn:hover {
  color: var(--text-primary);
}

.analytics-btn:focus-visible {
  opacity: 1;
  outline: 1px solid var(--text-tertiary);
}

/* Data cells - TUI style */
.results-table td {
  min-width: 40px;
  user-select: text;
  cursor: text;
}

/* Row backgrounds - subtle TUI style */
.results-table tbody tr {
  background: var(--surface-primary);
}

.results-table tbody tr:nth-child(even) {
  background: var(--table-row-stripe-bg);
}

.results-table tbody tr:hover {
  background: var(--table-row-hover-bg);
}

/* Terminal-style row reveal animation */
.reveal-row {
  animation: row-reveal 0.15s ease-out backwards;
  animation-delay: calc(var(--row-index) * 12ms);
}

@keyframes row-reveal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  .reveal-row {
    animation: none;
  }
}

/* Null values - dim styling */
.null-value {
  color: var(--text-tertiary);
  font-style: normal;
}

/* Number cells - right aligned with tabular figures */
.number-cell {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

/* Row Number Column - compact TUI style */
.results-table .row-number-col {
  position: sticky;
  inset-inline-start: 0;
  z-index: 1;
  padding: 3px 6px;
  text-align: end;
  vertical-align: middle;
  user-select: none;
  background: var(--surface-primary);
}

/* Header row number cell */
.results-table thead .row-number-col {
  z-index: 3;
  background: var(--table-header-bg);
}

/* Body row number cells inherit row background */
.results-table tbody tr:nth-child(even) .row-number-col {
  background: var(--table-row-stripe-bg);
}

.results-table tbody tr:hover .row-number-col {
  background: var(--table-row-hover-bg);
}

.row-number {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.row-number.hidden {
  opacity: 0;
}

/* Detail Button - compact */
.detail-btn {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  cursor: pointer;
  color: var(--text-tertiary);
  opacity: 0;
  pointer-events: none;
}

.detail-btn svg {
  width: 12px;
  height: 12px;
}

.detail-btn.visible {
  opacity: 1;
  pointer-events: auto;
}

.detail-btn:hover {
  color: var(--text-primary);
}

/* Footer - compact TUI style */
.results-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 8px;
  background: var(--table-header-bg);
  border-block-start: 1px solid var(--text-tertiary);
  flex-shrink: 0;
  font-family: var(--font-family-mono);
}

.results-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.stat::before {
  content: '·';
  margin-inline-end: 6px;
  color: var(--text-tertiary);
}

.stat:first-child::before {
  display: none;
}

.cache-hit {
  color: var(--color-success);
}

/* Partial data indicator */
.partial-indicator {
  color: var(--text-tertiary);
}

/* Engine Badge uses global .engine-badge from style.css */

/* Actions */
.results-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Pagination - compact TUI style */
.pagination {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pagination-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--text-secondary);
  cursor: pointer;
}

.pagination-btn svg {
  width: 10px;
  height: 10px;
}

.pagination-btn:hover:not(:disabled) {
  color: var(--text-primary);
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  padding: 0 4px;
  user-select: none;
}

/* Download Button - compact */
.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.download-btn svg {
  width: 12px;
  height: 12px;
}

.download-btn:hover:not(:disabled) {
  background: var(--text-secondary);
  color: var(--surface-primary);
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
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  min-width: 160px;
}

.export-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 10px;
}

.format-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.format-desc {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 1px;
}

/* Export Spinner */
.export-spinner {
  width: 10px;
  height: 10px;
  border: 1px solid var(--text-tertiary);
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

/* Loading State */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

</style>
