<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import BaseBox from './BaseBox.vue'
import PivotConfig from './PivotConfig.vue'
import ResultsTable from './ResultsTable.vue'
import { useDuckDBStore } from '../stores/duckdb'
import { useBigQueryStore } from '../stores/bigquery'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useConnectionsStore } from '../stores/connections'
import { useQueryResultsStore } from '../stores/queryResults'
import { useSettingsStore } from '../stores/settings'
import { buildAggregationQuery, buildPivotQuery } from '../utils/pivotQueryBuilder'
import { getTypeCategory } from '../utils/typeUtils'
import type { DatabaseEngine } from '../types/database'
import { getConnectionDisplayName } from '../utils/connectionHelpers'
import type { PivotConfig as PivotConfigType, AvailableColumn } from '../types/pivot'

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 800 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialData: { type: String, default: '{}' },
  initialName: { type: String, default: 'Pivot' },
})

const emit = defineEmits([
  'select', 'update:position', 'update:size',
  'delete', 'maximize', 'update:name', 'update:data',
])

const duckdbStore = useDuckDBStore()
const bigqueryStore = useBigQueryStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const queryResultsStore = useQueryResultsStore()
const settingsStore = useSettingsStore()
const connectionsStore = useConnectionsStore()

// State
const isLoading = ref(false)
const error = ref<string | null>(null)
const currentQuery = ref<string | null>(null)
const queryStats = ref<Record<string, unknown> | null>(null)
const decimals = ref<number | null>(null)
const heatmapEnabled = ref(false)

// Display mode: 'pivot' when column field is set, 'flat' otherwise
const displayTableName = ref<string | null>(null)
const rawTableName = ref<string | null>(null)
const isPivoted = ref(false)

// Parse initial config
const shouldAutoRun = ref(false)
const pivotConfig = ref<PivotConfigType>(parseInitialData())

function parseInitialData(): PivotConfigType {
  try {
    const data = JSON.parse(props.initialData)
    if (data.version === 2) return data
    // Build fresh config from the initial analytics-style data
    if (data.autoRun) shouldAutoRun.value = true
    return buildFreshConfig(data)
  } catch {
    return defaultConfig()
  }
}

function buildFreshConfig(data: Record<string, unknown>): PivotConfigType {
  const tableName = (data.tableName as string) || ''
  const columnName = (data.columnName as string) || ''
  const columnType = (data.columnType as string) || ''
  const typeCategory = (data.typeCategory as string) || 'text'
  const tc = typeCategory as 'number' | 'text' | 'date' | 'boolean'

  // Build available columns
  const availCols: AvailableColumn[] = ((data.availableColumns as string[]) || []).map(name => ({
    name,
    type: name === columnName ? columnType : 'unknown',
    typeCategory: name === columnName ? tc : getTypeCategory('unknown'),
  }))

  // For text/date/boolean columns: show value counts (column as row field, count(*) as metric)
  // For number columns: show the column as metric with sum
  const isValueCountMode = tc !== 'number' && columnName
  const rowFields: PivotConfigType['rowFields'] = isValueCountMode
    ? [{ name: columnName, type: columnType, typeCategory: tc, dateGranularity: tc === 'date' ? 'month' : undefined }]
    : []

  return {
    version: 2,
    tableName,
    rowFields,
    columnField: null,
    metrics: [{
      field: isValueCountMode ? '*' : (columnName || '*'),
      aggregation: isValueCountMode ? 'count' : (tc === 'number' ? 'sum' : 'count'),
    }],
    filters: [],
    sourceEngine: data.sourceEngine as DatabaseEngine | undefined,
    originalQuery: data.originalQuery as string | undefined,
    connectionId: data.connectionId as string | undefined,
    availableColumns: availCols,
  }
}

function defaultConfig(): PivotConfigType {
  return {
    version: 2,
    tableName: '',
    rowFields: [],
    columnField: null,
    metrics: [{ field: '*', aggregation: 'count' }],
    filters: [],
  }
}

// Connection display
const connection = computed(() => {
  if (!pivotConfig.value.connectionId) return null
  return connectionsStore.connections.find(c => c.id === pivotConfig.value.connectionId) || null
})

const connectionName = computed(() => getConnectionDisplayName(connection.value))

// Available columns for config panel
const availableColumns = computed<AvailableColumn[]>(() => {
  return pivotConfig.value.availableColumns || []
})

// Save config to parent for persistence
const saveConfig = () => {
  emit('update:data', JSON.stringify(pivotConfig.value))
}

const updateConfig = (newConfig: PivotConfigType) => {
  pivotConfig.value = newConfig
  saveConfig()
}

// Fetch available columns from DuckDB if not already provided
const fetchAvailableColumns = async () => {
  if (pivotConfig.value.availableColumns?.length) return

  try {
    const columns = await duckdbStore.getTableColumns(pivotConfig.value.tableName)
    // We don't know types without querying, so mark as 'text' by default
    pivotConfig.value.availableColumns = columns.map(name => ({
      name,
      type: 'unknown',
      typeCategory: getTypeCategory('unknown'),
    }))
  } catch {
    console.warn('Could not fetch available columns')
  }
}

// Enrich available columns with type info from DuckDB
const enrichColumnTypes = async () => {
  if (!pivotConfig.value.availableColumns?.length) return
  // Check if we already have proper types
  if (pivotConfig.value.availableColumns.every(c => c.type !== 'unknown')) return

  try {
    const tableName = pivotConfig.value.tableName
    const result = await duckdbStore.runQuery(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}'`
    )
    const typeMap = new Map<string, string>()
    for (const row of result.rows) {
      typeMap.set(row.column_name as string, row.data_type as string)
    }
    pivotConfig.value.availableColumns = pivotConfig.value.availableColumns.map(col => {
      const dbType = typeMap.get(col.name)
      if (dbType) {
        return { ...col, type: dbType, typeCategory: getTypeCategory(dbType) }
      }
      return col
    })
    saveConfig()
  } catch {
    // Not critical - proceed with what we have
  }
}

// Determine which engine to query
const getDialect = (): DatabaseEngine => {
  const { sourceEngine } = pivotConfig.value
  if (sourceEngine === 'bigquery' || sourceEngine === 'postgres' || sourceEngine === 'snowflake') {
    return sourceEngine
  }
  return 'duckdb'
}

const useSourceAnalytics = (): boolean => {
  const { sourceEngine, originalQuery, connectionId } = pivotConfig.value
  return !!(
    (sourceEngine === 'bigquery' || sourceEngine === 'postgres' || sourceEngine === 'snowflake') &&
    originalQuery && connectionId
  )
}

// Main execution: Phase 1 (aggregate) + Phase 2 (pivot)
const run = async () => {
  if (!pivotConfig.value.tableName && !pivotConfig.value.originalQuery) return

  isLoading.value = true
  error.value = null
  displayTableName.value = null
  isPivoted.value = false
  queryStats.value = null

  const t0 = performance.now()

  try {
    const dialect = getDialect()
    const aggTableName = `_pivot_${props.boxId}_agg`
    const pivotTableName = `_pivot_${props.boxId}`

    // Phase 1: Build and run aggregation query
    const aggQuery = buildAggregationQuery(pivotConfig.value, dialect)
    currentQuery.value = aggQuery

    let sourceStats: Record<string, unknown> = {}

    if (useSourceAnalytics()) {
      sourceStats = await runAggregationOnSource(aggQuery, aggTableName)
    } else {
      // DuckDB local - run directly
      await duckdbStore.runQueryWithStorage(aggQuery, aggTableName, null)
      queryResultsStore.initQueryResult(props.boxId, 'duckdb', { hasMoreRows: false })
      sourceStats = { engine: 'duckdb' }
    }

    // Phase 2: If column field is set, run PIVOT on DuckDB
    if (pivotConfig.value.columnField) {
      const pivotQuery = buildPivotQuery(aggTableName, pivotConfig.value)
      await duckdbStore.runQueryWithStorage(pivotQuery, pivotTableName, null)
      rawTableName.value = pivotTableName
      isPivoted.value = true
    } else {
      rawTableName.value = aggTableName
      isPivoted.value = false
    }

    // Apply decimals rounding if set, otherwise show raw
    if (decimals.value != null) {
      await applyDecimals(decimals.value)
    } else {
      displayTableName.value = rawTableName.value
    }

    const executionTimeMs = Math.round(performance.now() - t0)
    queryStats.value = { ...sourceStats, executionTimeMs }

    saveConfig()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    isLoading.value = false
  }
}

// Run Phase 1 aggregation on source database with pagination support
const runAggregationOnSource = async (query: string, storageTableName: string): Promise<Record<string, unknown>> => {
  const { sourceEngine, connectionId } = pivotConfig.value
  if (!sourceEngine || !connectionId) return {}

  const batchSize = settingsStore.fetchBatchSize

  if (sourceEngine === 'bigquery') {
    const result = await bigqueryStore.runQueryPaginated(
      query, batchSize, undefined, null, connectionId
    )
    await duckdbStore.storeResults(
      storageTableName, result.rows as Record<string, unknown>[],
      props.boxId, result.columns, 'bigquery'
    )
    queryResultsStore.initQueryResult(props.boxId, 'bigquery', {
      totalRows: result.totalRows,
      fetchedRows: result.rows.length,
      hasMoreRows: result.hasMore,
      pageToken: result.pageToken,
      originalQuery: query,
      connectionId,
      schema: result.columns,
    })
    return {
      engine: 'bigquery',
      totalBytesProcessed: result.stats?.totalBytesProcessed,
      cacheHit: result.stats?.cacheHit,
    }
  } else if (sourceEngine === 'postgres') {
    const result = await postgresStore.runQueryPaginated(
      connectionId, query, batchSize, 0, true
    )
    await duckdbStore.storeResults(
      storageTableName, result.rows as Record<string, unknown>[], props.boxId, result.columns
    )
    queryResultsStore.initQueryResult(props.boxId, 'postgres', {
      totalRows: result.totalRows,
      fetchedRows: result.rows.length,
      hasMoreRows: result.hasMore,
      nextOffset: result.nextOffset,
      originalQuery: query,
      connectionId,
      schema: result.columns,
    })
    return { engine: 'postgres' }
  } else if (sourceEngine === 'snowflake') {
    const result = await snowflakeStore.runQueryPaginated(
      connectionId, query, batchSize, 0, true
    )
    await duckdbStore.storeResults(
      storageTableName, result.rows as Record<string, unknown>[], props.boxId, result.columns
    )
    queryResultsStore.initQueryResult(props.boxId, 'snowflake', {
      totalRows: result.totalRows,
      fetchedRows: result.rows.length,
      hasMoreRows: result.hasMore,
      nextOffset: result.nextOffset,
      originalQuery: query,
      connectionId,
      schema: result.columns,
    })
    return { engine: 'snowflake' }
  }
  return {}
}

// Handle lazy loading from ResultsTable (flat mode only)
const handleRequestMoreData = async (_neededRows: number) => {
  const fetchState = queryResultsStore.getFetchState(props.boxId)
  if (!fetchState || !fetchState.hasMoreRows || fetchState.isFetching || fetchState.isBackgroundLoading) return

  const engine = fetchState.sourceEngine
  const query = fetchState.originalQuery
  const tableName = displayTableName.value
  const schema = fetchState.schema
  const connectionId = fetchState.connectionId

  if (!query || !tableName || !connectionId) return

  queryResultsStore.setBackgroundLoading(props.boxId, true)
  const batchSize = settingsStore.fetchBatchSize

  try {
    if (engine === 'bigquery') {
      const pageToken = fetchState.pageToken
      if (!pageToken) return
      const result = await bigqueryStore.runQueryPaginated(query, batchSize, pageToken, null, connectionId)
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)
      queryResultsStore.updateFetchProgress(props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, result.pageToken)
    } else if (engine === 'postgres') {
      const offset = fetchState.nextOffset ?? fetchState.fetchedRows
      const result = await postgresStore.runQueryPaginated(connectionId, query, batchSize, offset, false)
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)
      queryResultsStore.updateFetchProgress(props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, undefined, result.nextOffset)
    } else if (engine === 'snowflake') {
      const offset = fetchState.nextOffset ?? fetchState.fetchedRows
      const result = await snowflakeStore.runQueryPaginated(connectionId, query, batchSize, offset, false)
      await duckdbStore.appendResults(tableName, result.rows as Record<string, unknown>[], schema)
      queryResultsStore.updateFetchProgress(props.boxId, fetchState.fetchedRows + result.rows.length, result.hasMore, undefined, result.nextOffset)
    }
  } catch (err) {
    console.error('Lazy loading pivot data failed:', err)
  } finally {
    queryResultsStore.setBackgroundLoading(props.boxId, false)
  }
}

// Apply ROUND() via DuckDB when decimals setting changes
const applyDecimals = async (d: number | null) => {
  decimals.value = d
  if (!rawTableName.value) return
  const source = rawTableName.value
  const roundedName = `${source}_rounded`

  if (d == null) {
    // Reset to raw table
    displayTableName.value = source
    return
  }

  try {
    // Get column info to know which ones to round
    const info = await duckdbStore.runQuery(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${source.replace(/'/g, "''")}'`
    )
    const cols = info.rows.map(r => {
      const name = r.column_name as string
      const type = (r.data_type as string).toLowerCase()
      const isNumeric = /int|float|double|decimal|numeric|real|bigint|smallint|tinyint|hugeint/.test(type)
      return isNumeric ? `ROUND("${name}", ${d}) AS "${name}"` : `"${name}"`
    })
    await duckdbStore.runQueryWithStorage(
      `SELECT ${cols.join(', ')} FROM "${source}"`, roundedName, null
    )
    displayTableName.value = roundedName
  } catch {
    // Fall back to raw table
    displayTableName.value = source
  }
}

// Cmd+Enter shortcut
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    run()
  }
}

onMounted(async () => {
  await fetchAvailableColumns()
  await enrichColumnTypes()

  if (shouldAutoRun.value) {
    shouldAutoRun.value = false
    await run()
  }
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
    <div
      class="pivot-wrapper"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <!-- Config bar -->
      <PivotConfig
        :config="pivotConfig"
        :available-columns="availableColumns"
        :decimals="decimals"
        :heatmap="heatmapEnabled"
        @update:config="updateConfig"
        @update:decimals="applyDecimals"
        @update:heatmap="heatmapEnabled = $event"
        @run="run"
      />

      <!-- Content area -->
      <div class="pivot-content">
        <div
          v-if="isLoading"
          class="empty-state"
        >
          <span class="crunching">Crunching</span>
        </div>

        <div
          v-else-if="error"
          class="empty-state error"
        >
          {{ error }}
        </div>

        <ResultsTable
          v-else-if="displayTableName"
          :table-name="displayTableName"
          :box-name="initialName"
          :box-id="boxId"
          :stats="queryStats"
          :connection-name="connectionName"
          :show-row-detail="false"
          :show-analytics="false"
          :auto-pinned-columns="isPivoted ? pivotConfig.rowFields.map(f => f.name) : undefined"
          :heatmap="heatmapEnabled"
          @request-more-data="handleRequestMoreData"
        />

        <div
          v-else
          class="empty-state"
        >
          <span class="hint">Configure fields above and click <strong>Run</strong></span>
        </div>
      </div>

    </div>
  </BaseBox>
</template>

<style scoped>
.pivot-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.pivot-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
  padding: var(--space-3);
}

.empty-state.error {
  color: var(--color-error);
}

.hint {
  font-size: var(--font-size-body-sm);
}

.pivot-wrapper:focus {
  outline: none;
}

.crunching::after {
  content: '';
  display: inline-block;
  width: 1.5ch;
  text-align: left;
  animation: dots 1.2s steps(4, end) infinite;
}

@keyframes dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
}
</style>
