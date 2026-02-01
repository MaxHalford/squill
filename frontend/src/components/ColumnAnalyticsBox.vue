<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import BaseBox from './BaseBox.vue'
import ResultsTable from './ResultsTable.vue'
import { useDuckDBStore } from '../stores/duckdb'
import { useBigQueryStore } from '../stores/bigquery'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useConnectionsStore } from '../stores/connections'
import { useQueryResultsStore } from '../stores/queryResults'
import { useSettingsStore } from '../stores/settings'
import { buildAnalyticsQuery, type TypeCategory } from '../utils/analyticsQueryBuilder'
import { DATABASE_INFO, type DatabaseEngine } from '../types/database'
import { formatDateValue } from '../utils/typeUtils'

interface AnalyticsData {
  tableName: string
  columnName: string
  columnType: string
  typeCategory: 'number' | 'text' | 'date' | 'boolean'
  autoRun?: boolean  // True when newly created, false after first run
  // Source-based analytics fields
  sourceEngine?: DatabaseEngine
  originalQuery?: string
  connectionId?: string
  // Available columns for GROUP BY (passed from parent ResultsTable)
  availableColumns?: string[]
}

interface NumericStats {
  min: number | null
  max: number | null
  avg: number | null
  stddev: number | null
  count: number
  nonNullCount: number
}

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 400 },
  initialHeight: { type: Number, default: 400 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialData: { type: String, default: '{}' },
  initialName: { type: String, default: 'Column Analytics' }
})

const emit = defineEmits([
  'select', 'update:position', 'update:size',
  'delete', 'maximize', 'update:name', 'update:data'
])

const duckdbStore = useDuckDBStore()
const bigqueryStore = useBigQueryStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const queryResultsStore = useQueryResultsStore()
const settingsStore = useSettingsStore()
// Note: connectionsStore is imported but used indirectly via bigqueryStore/postgresStore/snowflakeStore
void useConnectionsStore() // Ensure connections store is initialized

// Core state
const isLoading = ref(false)
const error = ref<string | null>(null)
const numericStats = ref<NumericStats | null>(null)
const totalDistinct = ref<number | null>(null)
const needsRefresh = ref(true)

// Table name for ResultsTable to display
const analyticsTableName = ref<string | null>(null)

// Group by state
const availableColumns = ref<string[]>([])
const groupByColumns = ref<string[]>([])
const showColumnDropdown = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const analyticsData = computed<AnalyticsData | null>(() => {
  try {
    return JSON.parse(props.initialData)
  } catch {
    return null
  }
})

// Save current state to parent for persistence
const saveData = (clearAutoRun = false) => {
  if (!analyticsData.value) return
  const data = {
    ...analyticsData.value,
    groupByColumns: groupByColumns.value,
    // Clear autoRun after first successful run to prevent re-running on page reload
    ...(clearAutoRun ? { autoRun: false } : {})
  }
  emit('update:data', JSON.stringify(data))
}

const isGrouped = computed(() => groupByColumns.value.length > 0)

// Show numeric stats grid only for non-grouped number/date columns
const showStatsGrid = computed(() => {
  if (!analyticsData.value) return false
  const { typeCategory } = analyticsData.value
  return !isGrouped.value && (typeCategory === 'number' || typeCategory === 'date') && numericStats.value !== null
})

// Show results table for text/boolean or grouped results
const showResultsTable = computed(() => {
  if (!analyticsData.value) return false
  const { typeCategory } = analyticsData.value
  return analyticsTableName.value !== null && (isGrouped.value || typeCategory === 'text' || typeCategory === 'boolean')
})

// Columns available for grouping (exclude the analytics column itself)
const selectableColumns = computed(() => {
  if (!analyticsData.value) return []
  return availableColumns.value.filter(
    col => col !== analyticsData.value!.columnName && !groupByColumns.value.includes(col)
  )
})

// Build query based on grouping state
const buildQuery = (data: AnalyticsData): string => {
  const { tableName, columnName, typeCategory } = data
  const col = `"${columnName}"`

  if (isGrouped.value) {
    return buildGroupedQuery(data)
  }

  switch (typeCategory) {
    case 'number':
      return `SELECT
        MIN(${col}) as min_val,
        MAX(${col}) as max_val,
        AVG(${col}) as avg_val,
        STDDEV(${col}) as stddev_val,
        COUNT(*) as total_count,
        COUNT(${col}) as non_null_count
      FROM "${tableName}"`

    case 'text':
      return `SELECT
        ${col},
        COUNT(*) as count
      FROM "${tableName}"
      GROUP BY ${col}
      ORDER BY count DESC`

    case 'date':
      return `SELECT
        MIN(${col}) as min_val,
        MAX(${col}) as max_val,
        COUNT(DISTINCT ${col}) as distinct_count,
        COUNT(*) as total_count,
        COUNT(${col}) as non_null_count
      FROM "${tableName}"`

    case 'boolean':
      return `SELECT
        ${col},
        COUNT(*) as count
      FROM "${tableName}"
      GROUP BY ${col}
      ORDER BY ${col} DESC NULLS LAST`

    default:
      throw new Error(`Unsupported type category: ${typeCategory}`)
  }
}

const buildGroupedQuery = (data: AnalyticsData): string => {
  const { tableName, columnName, typeCategory } = data
  const col = `"${columnName}"`
  const groupCols = groupByColumns.value.map(c => `"${c}"`).join(', ')

  let selectFields: string
  let orderBy: string

  if (typeCategory === 'number' || typeCategory === 'date') {
    selectFields = `${groupCols},
      MIN(${col}) as min_val,
      MAX(${col}) as max_val,
      AVG(${col}) as avg_val,
      COUNT(*) as count`
    orderBy = groupCols
  } else {
    selectFields = `${groupCols}, ${col}, COUNT(*) as count`
    orderBy = `${groupCols}, count DESC`
  }

  return `SELECT ${selectFields}
    FROM "${tableName}"
    GROUP BY ${groupCols}${typeCategory === 'text' || typeCategory === 'boolean' ? `, ${col}` : ''}
    ORDER BY ${orderBy}`
}

const fetchAvailableColumns = async () => {
  if (!analyticsData.value) return

  // Use columns passed from parent ResultsTable (preferred - no query needed)
  if (analyticsData.value.availableColumns?.length) {
    availableColumns.value = analyticsData.value.availableColumns
    return
  }

  // Fallback: try DuckDB (works if parent query was run in this session)
  try {
    availableColumns.value = await duckdbStore.getTableColumns(analyticsData.value.tableName)
  } catch {
    // DuckDB table doesn't exist, GROUP BY won't be available
    console.warn('Could not fetch available columns for GROUP BY')
  }
}

// Run analytics query (independent of parent boxes)
const refresh = async () => {
  if (!analyticsData.value) return

  isLoading.value = true
  error.value = null

  try {
    // Fetch available columns for GROUP BY (from DuckDB if table exists)
    await fetchAvailableColumns()

    // Run analytics directly against source database
    await runAnalyticsQuery()
    needsRefresh.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    isLoading.value = false
  }
}

// Run query against the appropriate database
const runQueryOnSource = async (query: string, sourceEngine: string | undefined, connectionId: string | undefined): Promise<{ rows: Record<string, unknown>[] }> => {
  if (sourceEngine === 'bigquery' && connectionId) {
    return await bigqueryStore.runQuery(query, null, connectionId)
  } else if (sourceEngine === 'postgres' && connectionId) {
    return await postgresStore.runQuery(connectionId, query, null)
  } else if (sourceEngine === 'snowflake' && connectionId) {
    return await snowflakeStore.runQuery(connectionId, query, null)
  } else {
    // Default to DuckDB
    return await duckdbStore.runQuery(query)
  }
}

// Run just the analytics query (uses source database when available)
const runAnalyticsQuery = async () => {
  if (!analyticsData.value) return

  numericStats.value = null
  totalDistinct.value = null
  analyticsTableName.value = null

  const { typeCategory, sourceEngine, originalQuery, connectionId, tableName, columnName } = analyticsData.value

  // Determine the dialect for query building
  const dialect: DatabaseEngine =
    sourceEngine === 'bigquery' ? 'bigquery' :
    sourceEngine === 'postgres' ? 'postgres' :
    sourceEngine === 'snowflake' ? 'snowflake' :
    'duckdb'

  // Build the analytics query
  // If we have an original query and it's a remote engine, use source-based analytics
  const useSourceAnalytics = (sourceEngine === 'bigquery' || sourceEngine === 'postgres' || sourceEngine === 'snowflake') && originalQuery && connectionId

  let query: string
  if (useSourceAnalytics) {
    // Build query using the original query as a subquery
    query = buildAnalyticsQuery({
      tableName,
      columnName,
      typeCategory: typeCategory as TypeCategory,
      dialect,
      originalQuery,
      groupByColumns: isGrouped.value ? groupByColumns.value : undefined
    })
  } else {
    // Use existing buildQuery for DuckDB tables
    query = buildQuery(analyticsData.value)
  }

  if (!isGrouped.value && (typeCategory === 'number' || typeCategory === 'date')) {
    const result = useSourceAnalytics
      ? await runQueryOnSource(query, sourceEngine, connectionId)
      : await duckdbStore.runQuery(query)

    if (!result.rows || result.rows.length === 0) {
      throw new Error('No data returned')
    }

    const row = result.rows[0]
    if (typeCategory === 'number') {
      numericStats.value = {
        min: row.min_val as number | null,
        max: row.max_val as number | null,
        avg: row.avg_val as number | null,
        stddev: row.stddev_val as number | null,
        count: row.total_count as number,
        nonNullCount: row.non_null_count as number
      }
    } else {
      numericStats.value = {
        min: row.min_val as number | null,
        max: row.max_val as number | null,
        avg: null,
        stddev: null,
        count: row.total_count as number,
        nonNullCount: row.non_null_count as number
      }
      totalDistinct.value = row.distinct_count as number
    }
  } else {
    // For grouped queries or text/boolean, store results in DuckDB for display
    const storageTableName = `_analytics_${props.boxId}`

    if (useSourceAnalytics && sourceEngine && connectionId) {
      // Use paginated query for source-based analytics
      const batchSize = settingsStore.fetchBatchSize

      if (sourceEngine === 'bigquery') {
        const paginatedResult = await bigqueryStore.runQueryPaginated(
          query,
          batchSize,
          undefined, // No page token for first request
          null, // No abort signal for analytics
          connectionId
        )

        // Store first batch in DuckDB (BigQuery needs explicit type casts)
        await duckdbStore.storeResults(
          storageTableName,
          paginatedResult.rows as Record<string, unknown>[],
          props.boxId,
          paginatedResult.columns,
          'bigquery'
        )

        // Initialize fetch state for pagination
        queryResultsStore.initQueryResult(props.boxId, 'bigquery', {
          totalRows: paginatedResult.totalRows,
          fetchedRows: paginatedResult.rows.length,
          hasMoreRows: paginatedResult.hasMore,
          pageToken: paginatedResult.pageToken,
          originalQuery: query,
          connectionId,
          schema: paginatedResult.columns
        })
      } else if (sourceEngine === 'postgres') {
        const paginatedResult = await postgresStore.runQueryPaginated(
          connectionId,
          query,
          batchSize,
          0, // Start at offset 0
          true // Include count on first request
        )

        // Store first batch in DuckDB
        await duckdbStore.storeResults(
          storageTableName,
          paginatedResult.rows as Record<string, unknown>[],
          props.boxId,
          paginatedResult.columns
        )

        // Initialize fetch state for pagination
        queryResultsStore.initQueryResult(props.boxId, 'postgres', {
          totalRows: paginatedResult.totalRows,
          fetchedRows: paginatedResult.rows.length,
          hasMoreRows: paginatedResult.hasMore,
          nextOffset: paginatedResult.nextOffset,
          originalQuery: query,
          connectionId,
          schema: paginatedResult.columns
        })
      } else if (sourceEngine === 'snowflake') {
        const paginatedResult = await snowflakeStore.runQueryPaginated(
          connectionId,
          query,
          batchSize,
          0, // Start at offset 0
          true // Include count on first request
        )

        // Store first batch in DuckDB
        await duckdbStore.storeResults(
          storageTableName,
          paginatedResult.rows as Record<string, unknown>[],
          props.boxId,
          paginatedResult.columns
        )

        // Initialize fetch state for pagination
        queryResultsStore.initQueryResult(props.boxId, 'snowflake', {
          totalRows: paginatedResult.totalRows,
          fetchedRows: paginatedResult.rows.length,
          hasMoreRows: paginatedResult.hasMore,
          nextOffset: paginatedResult.nextOffset,
          originalQuery: query,
          connectionId,
          schema: paginatedResult.columns
        })
      }
    } else {
      // DuckDB local query - run directly
      await duckdbStore.runQueryWithStorage(query, storageTableName, null)

      // Initialize fetch state (no pagination for local data)
      queryResultsStore.initQueryResult(props.boxId, 'duckdb', {
        hasMoreRows: false
      })
    }
    analyticsTableName.value = storageTableName
  }
}

// Group by actions
const addGroupByColumn = async (column: string) => {
  groupByColumns.value.push(column)
  showColumnDropdown.value = false
  saveData() // Persist the change
  if (!needsRefresh.value) {
    isLoading.value = true
    try {
      await runAnalyticsQuery()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      isLoading.value = false
    }
  }
}

const removeGroupByColumn = async (column: string) => {
  groupByColumns.value = groupByColumns.value.filter(c => c !== column)
  saveData() // Persist the change
  if (!needsRefresh.value) {
    isLoading.value = true
    try {
      await runAnalyticsQuery()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      isLoading.value = false
    }
  }
}

// Handle request for more data from ResultsTable (lazy loading)
const handleRequestMoreData = async (_neededRows: number) => {
  const fetchState = queryResultsStore.getFetchState(props.boxId)
  if (!fetchState || !fetchState.hasMoreRows || fetchState.isFetching || fetchState.isBackgroundLoading) {
    return // Already loading or no more data
  }

  const engine = fetchState.sourceEngine
  const query = fetchState.originalQuery
  const tableName = analyticsTableName.value
  const schema = fetchState.schema
  const connectionId = fetchState.connectionId

  if (!query || !tableName || !connectionId) return

  queryResultsStore.setBackgroundLoading(props.boxId, true)

  const batchSize = settingsStore.fetchBatchSize

  try {
    if (engine === 'bigquery') {
      const pageToken = fetchState.pageToken
      if (!pageToken) return

      const result = await bigqueryStore.runQueryPaginated(
        query,
        batchSize,
        pageToken,
        null, // No abort signal
        connectionId
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const newFetchedRows = fetchState.fetchedRows + result.rows.length
      queryResultsStore.updateFetchProgress(
        props.boxId,
        newFetchedRows,
        result.hasMore,
        result.pageToken
      )
    } else if (engine === 'postgres') {
      const offset = fetchState.nextOffset ?? fetchState.fetchedRows

      const result = await postgresStore.runQueryPaginated(
        connectionId,
        query,
        batchSize,
        offset,
        false // Don't need count again
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const newFetchedRows = fetchState.fetchedRows + result.rows.length
      queryResultsStore.updateFetchProgress(
        props.boxId,
        newFetchedRows,
        result.hasMore,
        undefined, // No page token for Postgres
        result.nextOffset
      )
    } else if (engine === 'snowflake') {
      const offset = fetchState.nextOffset ?? fetchState.fetchedRows

      const result = await snowflakeStore.runQueryPaginated(
        connectionId,
        query,
        batchSize,
        offset,
        false // Don't need count again
      )

      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)

      const newFetchedRows = fetchState.fetchedRows + result.rows.length
      queryResultsStore.updateFetchProgress(
        props.boxId,
        newFetchedRows,
        result.hasMore,
        undefined, // No page token for Snowflake
        result.nextOffset
      )
    }
  } catch (err) {
    console.error('Lazy loading analytics failed:', err)
  } finally {
    queryResultsStore.setBackgroundLoading(props.boxId, false)
  }
}

// Format helpers
const formatNumber = (val: number | null | unknown): string => {
  if (val === null || val === undefined) return 'NULL'
  const num = Number(val)
  if (isNaN(num)) return String(val)
  if (Number.isInteger(num)) return num.toLocaleString()
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// Format stat value based on type category
const formatStatValue = (val: unknown): string => {
  if (val === null || val === undefined) return 'NULL'
  if (analyticsData.value?.typeCategory === 'date') {
    return formatDateValue(val)
  }
  return formatNumber(val)
}

const nullCount = computed(() => {
  if (!numericStats.value) return 0
  return numericStats.value.count - numericStats.value.nonNullCount
})

const nullPercent = computed(() => {
  if (!numericStats.value || numericStats.value.count === 0) return '0'
  const pct = (nullCount.value / numericStats.value.count) * 100
  return pct.toFixed(1)
})

// Click outside to close dropdown
const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    showColumnDropdown.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', handleClickOutside)

  // Restore groupByColumns from persisted data
  if (analyticsData.value) {
    try {
      const parsed = JSON.parse(props.initialData)
      if (Array.isArray(parsed.groupByColumns)) {
        groupByColumns.value = parsed.groupByColumns
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Only auto-run if explicitly requested (newly created box)
  // This prevents unexpected queries on page reload
  if (analyticsData.value?.autoRun) {
    isLoading.value = true
    try {
      await fetchAvailableColumns()
      await runAnalyticsQuery()
      needsRefresh.value = false
      // Clear autoRun flag so it doesn't run again on next page load
      saveData(true)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      isLoading.value = false
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="analytics-wrapper">
      <div class="detail-content">
        <!-- Loading -->
        <div v-if="isLoading" class="empty-state">
          Crunching...
        </div>

        <!-- Error -->
        <div v-else-if="error" class="empty-state error">
          {{ error }}
        </div>

        <!-- Needs refresh -->
        <div v-else-if="needsRefresh" class="empty-state">
          <button class="refresh-btn" @click="refresh">
            Refresh
          </button>
        </div>

        <!-- Numeric/Date Stats (grid layout) -->
        <div v-else-if="showStatsGrid" class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Min</div>
            <div class="stat-value">{{ formatStatValue(numericStats!.min) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Max</div>
            <div class="stat-value">{{ formatStatValue(numericStats!.max) }}</div>
          </div>
          <div v-if="numericStats!.avg !== null" class="stat-card">
            <div class="stat-label">Average</div>
            <div class="stat-value">{{ formatNumber(numericStats!.avg) }}</div>
          </div>
          <div v-if="numericStats!.stddev !== null" class="stat-card">
            <div class="stat-label">Std Dev</div>
            <div class="stat-value">{{ formatNumber(numericStats!.stddev) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Count</div>
            <div class="stat-value">{{ formatNumber(numericStats!.count) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Null</div>
            <div class="stat-value">{{ formatNumber(nullCount) }} ({{ nullPercent }}%)</div>
          </div>
          <div v-if="totalDistinct !== null" class="stat-card">
            <div class="stat-label">Distinct</div>
            <div class="stat-value">{{ formatNumber(totalDistinct) }}</div>
          </div>
        </div>

        <!-- Results Table (for text/boolean/grouped) -->
        <div v-else-if="showResultsTable" class="results-container">
          <ResultsTable
            :table-name="analyticsTableName"
            :box-name="initialName"
            :box-id="boxId"
            :show-row-detail="false"
            :show-analytics="false"
            @request-more-data="handleRequestMoreData"
          />
        </div>

        <!-- Empty -->
        <div v-else-if="!isLoading" class="empty-state">
          No data available
        </div>
      </div>

      <!-- Footer with engine badge and group by controls -->
      <footer class="analytics-footer">
        <!-- Engine badge -->
        <span
          v-if="analyticsData?.sourceEngine"
          class="engine-badge"
          :style="{
            background: DATABASE_INFO[analyticsData.sourceEngine].color,
            color: DATABASE_INFO[analyticsData.sourceEngine].textColor
          }"
          :title="`Analytics run on ${DATABASE_INFO[analyticsData.sourceEngine].name}`"
        >
          {{ DATABASE_INFO[analyticsData.sourceEngine].shortName }}
        </span>

        <div class="group-by-section" ref="dropdownRef">
          <span class="group-by-label">GROUP BY</span>

          <!-- Selected columns as chips -->
          <span
            v-for="col in groupByColumns"
            :key="col"
            class="column-chip"
          >
            {{ col }}
            <button
              class="chip-remove"
              @click.stop="removeGroupByColumn(col)"
              aria-label="Remove"
            >×</button>
          </span>

          <!-- Add column button with dropdown -->
          <div v-if="selectableColumns.length > 0" class="add-column-wrapper">
            <button
              class="add-column-btn"
              @click.stop="showColumnDropdown = !showColumnDropdown"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <Transition name="dropdown-up">
              <div v-if="showColumnDropdown" class="column-dropdown dropdown-menu">
                <button
                  v-for="col in selectableColumns"
                  :key="col"
                  class="dropdown-item dropdown-menu-item"
                  @click.stop="addGroupByColumn(col)"
                >
                  {{ col }}
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </footer>
    </div>
  </BaseBox>
</template>

<style scoped>
.analytics-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Stats Grid (for numeric columns) */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2);
  padding: var(--space-3);
  overflow-y: auto;
}

.stat-card {
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-secondary);
  border-radius: var(--border-radius-sm);
  transition: background 0.15s ease;
}

.stat-card:hover {
  background: var(--surface-primary);
}

.stat-label {
  font-size: var(--font-size-caption);
  font-weight: bold;
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: text;
  cursor: text;
}

.stat-label::selection {
  background: var(--color-selection);
}

.stat-value {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  user-select: text;
  cursor: text;
}

.stat-value::selection {
  background: var(--color-selection);
}

/* Results container */
.results-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Empty/error states */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
  padding: var(--space-3);
}

.empty-state.error {
  color: var(--color-error);
}

.refresh-btn {
  padding: var(--space-2) var(--space-4);
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  border-radius: var(--border-radius-sm);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.refresh-btn:hover {
  background: var(--surface-primary);
  border-color: var(--text-secondary);
}

/* Footer */
.analytics-footer {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-primary);
  border-top: var(--border-width-thin) solid var(--border-secondary);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Engine badge uses global .engine-badge from style.css */

.group-by-section {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  flex: 1;
}

.group-by-label {
  /* Matches .engine-badge sizing from style.css */
  box-sizing: border-box;
  height: 17px;
  font-size: 9px;
  font-weight: 600;
  line-height: 13px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--surface-secondary);
  padding: 2px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.column-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 17px;
  padding: 0 4px 0 6px;
  background: var(--surface-secondary);
  border: var(--border-width-thin) solid var(--border-secondary);
  border-radius: 3px;
  font-size: 9px;
  line-height: 1;
  font-family: var(--font-family-mono);
  color: var(--text-primary);
}

.chip-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 2px;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  transition: background 0.1s, color 0.1s;
}

.chip-remove:hover {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.add-column-wrapper {
  position: relative;
}

.add-column-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  padding: 0;
  background: var(--surface-secondary);
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.add-column-btn:hover {
  background: var(--text-secondary);
  color: var(--surface-primary);
}

/* Position-specific overrides for this dropdown (uses global .dropdown-menu) */
.column-dropdown {
  bottom: calc(100% + var(--space-1));
  left: 50%;
  transform: translateX(-50%);
  min-width: 150px;
  max-height: 200px;
  overflow-y: auto;
}

/* Use monospace font for column names */
.dropdown-item {
  font-family: var(--font-family-mono);
}
</style>
