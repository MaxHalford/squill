<script setup lang="ts">
/**
 * SqlBox — canvas-aware SQL query box.
 *
 * Thin wrapper around QueryPanel that adds canvas integration:
 * - BaseBox window chrome (drag, resize, close, maximize)
 * - Dependency tracking and recursive execution
 * - Query history recording
 * - DuckDB table rename on box name change
 */
import { ref, watch, onMounted, onUnmounted, computed, inject, toRef, nextTick } from 'vue'
import BaseBox from '../../components/BaseBox.vue'
import QueryPanel, { type QueryCompleteEvent } from '../../components/QueryPanel.vue'
import { useDuckDBStore } from '../../stores/duckdb'
import { useCanvasStore } from '../../stores/canvas'
import { useQueryHistoryStore } from '../../stores/queryHistory'
import { useSettingsStore } from '../../stores/settings'
import { useBoxConnection } from '../../composables/useBoxConnection'
import { announceQueryResult, notifyTab } from '../../utils/voiceNotify'
import { getEffectiveEngine, extractTableReferences, type TableReferenceWithPosition } from '../../utils/queryAnalyzer'
import { DATABASE_INFO } from '../../types/database'
import { hasCTEs } from '../../utils/cteParser'
import { useSqlGlotStore } from '../../stores/sqlglot'

const duckdbStore = useDuckDBStore()
const canvasStore = useCanvasStore()
const sqlglotStore = useSqlGlotStore()
const queryHistoryStore = useQueryHistoryStore()
const settingsStore = useSettingsStore()

// Register this box so keyboard shortcuts can execute it explicitly.
const registerBoxExecutor = inject<((boxId: number, runFn: () => Promise<void>) => void) | null>('registerBoxExecutor', null)
const unregisterBoxExecutor = inject<((boxId: number) => void) | null>('unregisterBoxExecutor', null)

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialQuery: { type: String, default: 'SELECT *\nFROM bigquery-public-data.chicago_taxi_trips.taxi_trips' },
  initialName: { type: String, default: 'SQL Query' },
  connectionId: { type: String, default: undefined },
  initialEditorHeight: { type: Number, default: 150 },
})

const emit = defineEmits([
  'select', 'update:position', 'update:size', 'delete', 'maximize',
  'update:name', 'update:query', 'update:editorHeight', 'show-row-detail', 'show-column-analytics',
  'drag-start', 'drag-end', 'navigate-to-table', 'show-explain',
])

const baseBoxRef = ref<InstanceType<typeof BaseBox> | null>(null)
const queryPanelRef = ref<InstanceType<typeof QueryPanel> | null>(null)
const queryText = ref(props.initialQuery)
const lastQueryStartTime = ref(0)

// ---------------------------------------------------------------------------
// Header action button state (forwarded from QueryPanel/QueryEditor)
// ---------------------------------------------------------------------------

const panelIsRunning = computed(() => queryPanelRef.value?.isRunning ?? false)
const panelIsEngineLoading = computed(() => queryPanelRef.value?.isEngineLoading ?? false)
const panelExplainDisabledReason = computed(() => queryPanelRef.value?.explainDisabledReason ?? '')
const panelJustFormatted = computed(() => queryPanelRef.value?.justFormatted ?? false)

const runButtonTooltip = computed(() => {
  const base = 'Run query (\u2318\u23CE)'
  if (panelIsEngineLoading.value) return 'Loading database...'
  if (panelIsRunning.value) return 'Query running...'
  return base
})

const formatButtonTooltip = computed(() => {
  if (panelJustFormatted.value) return 'Formatted'
  if (sqlglotStore.isLoading) return 'Loading formatter...'
  if (!sqlglotStore.isReady) return 'Formatter unavailable'
  return 'Format SQL'
})

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const { connection: boxConnection, isConnectionMissing } = useBoxConnection(toRef(props, 'connectionId'))

const missingConnectionType = computed((): string | undefined => {
  if (!props.connectionId) return undefined
  if (props.connectionId.startsWith('bigquery')) return DATABASE_INFO.bigquery.name
  return 'database'
})

// ---------------------------------------------------------------------------
// Dependency tracking
// ---------------------------------------------------------------------------

const updateDependenciesFromQuery = (query: string) => {
  try {
    // Track dependencies for ALL engines (not just DuckDB) so that
    // same-connection CTE chains also show dependency arrows.
    const tableRefs = extractTableReferences(query)
    const dependencyBoxIds = tableRefs
      .filter(ref => !ref.includes('.')) // skip qualified remote refs
      .map(ref => {
        const tableName = ref.replace(/`/g, '').toLowerCase()
        let boxId = duckdbStore.getTableBoxId(tableName)

        if (boxId === null) {
          const matchingBox = canvasStore.boxes.find(b =>
            duckdbStore.sanitizeTableName(b.name) === tableName,
          )
          boxId = matchingBox?.id ?? null
        }

        return boxId
      })
      .filter((boxId): boxId is number => boxId !== null && boxId !== undefined && boxId !== props.boxId)

    const uniqueDeps = [...new Set(dependencyBoxIds)]
    canvasStore.updateBoxDependencies(props.boxId, uniqueDeps)
  } catch (err) {
    console.warn('Failed to update dependencies:', err)
  }
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

// Sync queryText from prop changes (e.g., from localStorage reload)
let isUpdatingFromProp = false
watch(() => props.initialQuery, (newQuery) => {
  isUpdatingFromProp = true
  queryText.value = newQuery
  setTimeout(() => { isUpdatingFromProp = false }, 0)

  if (newQuery) updateDependenciesFromQuery(newQuery)
})

// Recalculate dependencies when DuckDB schema changes (table renames, etc.)
// Debounced to avoid N*M cascade when many boxes react to schema changes.
let depTimeout: ReturnType<typeof setTimeout> | null = null
watch(() => duckdbStore.schemaVersion, () => {
  if (depTimeout) clearTimeout(depTimeout)
  depTimeout = setTimeout(() => {
    if (queryText.value) updateDependenciesFromQuery(queryText.value)
  }, 500)
})

// Debounced emit of query changes for persistence + dependency tracking
let queryTimeout: ReturnType<typeof setTimeout> | null = null
watch(queryText, (newQuery) => {
  if (isUpdatingFromProp) return

  if (queryTimeout) clearTimeout(queryTimeout)
  queryTimeout = setTimeout(() => {
    emit('update:query', newQuery)
    updateDependenciesFromQuery(newQuery)
  }, 500)
})

// ---------------------------------------------------------------------------
// CTE Explode
// ---------------------------------------------------------------------------

const canExplode = computed(() => hasCTEs(queryText.value) && sqlglotStore.isReady)

const handleExplode = async () => {
  const dialect = boxConnection.value?.type ?? 'duckdb'
  console.log('[explode] dialect:', dialect, 'query:', queryText.value.slice(0, 80))
  const exploded = await sqlglotStore.parseCTEs(queryText.value, dialect)
  console.log('[explode] parseCTEs result:', exploded)
  if (!exploded || exploded.ctes.length === 0) return
  const newBoxIds = canvasStore.explodeBox(props.boxId, exploded)
  if (newBoxIds.length) {
    await nextTick()
    canvasStore.canvasRef?.fitToBoxIds(newBoxIds)
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

const handleQueryComplete = (result: QueryCompleteEvent) => {
  updateDependenciesFromQuery(queryPanelRef.value?.getQuery() || queryText.value)

  const boxName = baseBoxRef.value?.boxName || props.initialName
  notifyTab(boxName, true)
  if (settingsStore.voiceNotifyEnabled && result.executionTimeMs > 10_000) {
    announceQueryResult(boxName, true)
  }

  if (props.connectionId) {
    queryHistoryStore.recordQuery({
      query: queryPanelRef.value?.getQuery() || queryText.value,
      connectionId: props.connectionId,
      connectionType: result.engine,
      success: true,
      boxName,
      executionTimeMs: result.executionTimeMs,
      rowCount: result.rowCount,
    })
  }

}

const handleQueryError = (errorMessage: string) => {
  const boxName = baseBoxRef.value?.boxName || props.initialName
  notifyTab(boxName, false)
  const elapsed = performance.now() - lastQueryStartTime.value
  if (settingsStore.voiceNotifyEnabled && elapsed > 10_000) {
    announceQueryResult(boxName, false)
  }

  if (props.connectionId) {
    const currentEngine = getEffectiveEngine(
      boxConnection.value?.type,
      queryText.value,
      Object.keys(duckdbStore.tables),
      props.connectionId,
      canvasStore.boxes,
    )
    queryHistoryStore.recordQuery({
      query: queryPanelRef.value?.getQuery() || queryText.value,
      connectionId: props.connectionId,
      connectionType: currentEngine,
      success: false,
      boxName,
      errorMessage,
    })
  }
}

const handleNavigateToTable = (ref: TableReferenceWithPosition) => {
  const connectionType = boxConnection.value?.type || 'duckdb'
  const connectionId = boxConnection.value?.id

  const navigationInfo: {
    connectionType: string
    connectionId?: string
    tableName: string
    projectId?: string
    datasetId?: string
    databaseName?: string
    schemaName?: string
  } = {
    connectionType,
    connectionId,
    tableName: ref.rawName,
  }

  if (connectionType === 'bigquery' && ref.parts.length === 3) {
    navigationInfo.projectId = ref.parts[0]
    navigationInfo.datasetId = ref.parts[1]
    navigationInfo.tableName = ref.parts[2]
  }

  emit('navigate-to-table', navigationInfo)
}

const handleUpdateName = async (newName: string) => {
  try {
    await duckdbStore.renameTable(props.initialName, newName)
  } catch (err) {
    console.warn('Failed to rename table:', err)
  }
  emit('update:name', newName)
}

// A run command executes this box only. Dependencies are never run implicitly.
const registeredRun = async () => {
  lastQueryStartTime.value = performance.now()
  await queryPanelRef.value?.runQuery()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  if (registerBoxExecutor) {
    registerBoxExecutor(props.boxId, registeredRun)
  }
})

onUnmounted(() => {
  if (queryTimeout) {
    clearTimeout(queryTimeout)
    queryTimeout = null
  }
  if (depTimeout) {
    clearTimeout(depTimeout)
    depTimeout = null
  }
  if (unregisterBoxExecutor) {
    unregisterBoxExecutor(props.boxId)
  }
})

defineExpose({
  focusEditor: () => queryPanelRef.value?.focusEditor(),
})
</script>

<template>
  <BaseBox
    ref="baseBoxRef"
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    :show-header-name="true"
    :connection-missing="isConnectionMissing"
    :connection-type="missingConnectionType"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="handleUpdateName"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <template #header-actions>
      <!-- Run query -->
      <button
        v-tooltip="runButtonTooltip"
        class="header-action-btn"
        :disabled="panelIsEngineLoading || panelIsRunning"
        @click.stop="queryPanelRef?.runQuery()"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
        >
          <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
        </svg>
      </button>

      <!-- Explain query -->
      <button
        v-tooltip="panelExplainDisabledReason || 'Explain query'"
        class="header-action-btn"
        :disabled="panelIsEngineLoading || panelIsRunning || !!panelExplainDisabledReason"
        @click.stop="queryPanelRef?.explainQuery({ clientX: $event.clientX, clientY: $event.clientY })"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.34-4.34" />
        </svg>
      </button>

      <!-- Format SQL -->
      <button
        v-tooltip="formatButtonTooltip"
        class="header-action-btn"
        :class="{ formatted: panelJustFormatted }"
        :disabled="panelIsEngineLoading || panelIsRunning || !sqlglotStore.isReady"
        @click.stop="queryPanelRef?.formatQuery()"
      >
        <svg
          v-if="panelJustFormatted"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m14.622 17.897-10.68-2.913" />
          <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" />
          <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
        </svg>
      </button>

      <!-- Break CTEs into separate boxes -->
      <button
        v-tooltip="canExplode ? 'Break CTEs into separate boxes' : 'No CTEs to break'"
        class="header-action-btn"
        :disabled="!canExplode"
        @click.stop="handleExplode"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m15 12-8.373 8.373a1 1 0 0 1-3-3L12 9" />
          <path d="m18 15 4-4" />
          <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V9l3 3h1.172a2 2 0 0 1 1.414.586L19.5 14.5" />
        </svg>
      </button>
    </template>

    <QueryPanel
      ref="queryPanelRef"
      v-model="queryText"
      :connection-id="connectionId"
      :box-id="boxId"
      :box-name="baseBoxRef?.boxName || initialName"
      :initial-editor-height="initialEditorHeight"
      :can-explode="canExplode"
      @query-complete="handleQueryComplete"
      @query-error="handleQueryError"
      @navigate-to-table="handleNavigateToTable"
      @show-row-detail="emit('show-row-detail', $event)"
      @show-column-analytics="emit('show-column-analytics', $event)"
      @show-explain="emit('show-explain', $event)"
      @update:editor-height="emit('update:editorHeight', $event)"
      @explode="handleExplode"
    />
  </BaseBox>
</template>

<style scoped>
.header-action-btn {
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

.header-action-btn:hover:not(:disabled) {
  background: var(--text-secondary);
  color: var(--surface-primary);
}

.header-action-btn.active {
  color: var(--text-primary);
}

.header-action-btn.formatted {
  color: var(--text-inverse);
}

.header-action-btn:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.5;
}

.header-action-btn .spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
