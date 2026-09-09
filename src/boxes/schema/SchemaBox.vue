<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseBox from '../../components/BaseBox.vue'
import { useBigQueryStore } from '../../stores/bigquery'
import { useConnectionsStore } from '../../stores/connections'
import { useDuckDBStore } from '../../stores/duckdb'
import type { BigQueryDataset, BigQueryField, BigQueryProject, BigQueryTable } from '../../types/bigquery'

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 800 },
  initialHeight: { type: Number, default: 600 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialName: { type: String, default: 'Schema Browser' },
})

const emit = defineEmits([
  'select',
  'update:position',
  'update:size',
  'delete',
  'maximize',
  'update:name',
  'query-table',
])

const bigqueryStore = useBigQueryStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()

const projects = ref<BigQueryProject[]>([])
const datasets = ref<BigQueryDataset[]>([])
const tables = ref<BigQueryTable[]>([])
const fields = ref<BigQueryField[]>([])
const selectedConnectionId = ref<string | null>(null)
const selectedProjectId = ref<string | null>(null)
const selectedDatasetId = ref<string | null>(null)
const selectedTableId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const connections = computed(() => connectionsStore.getConnectionsByType('bigquery'))

const runAction = async (action: () => Promise<void>) => {
  loading.value = true
  error.value = null
  try {
    await action()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

const selectConnection = (connectionId: string) => runAction(async () => {
  selectedConnectionId.value = connectionId
  selectedProjectId.value = null
  selectedDatasetId.value = null
  selectedTableId.value = null
  projects.value = []
  datasets.value = []
  tables.value = []
  fields.value = []

  connectionsStore.setActiveConnection(connectionId)
  await bigqueryStore.ensureAccessToken(connectionId)
  projects.value = await bigqueryStore.fetchProjects()

  const connection = connectionsStore.connections.find(item => item.id === connectionId)
  const defaultProject = connection?.projectId || projects.value[0]?.projectId
  if (defaultProject) await selectProject(defaultProject)
})

const selectProject = (projectId: string) => runAction(async () => {
  const connectionId = selectedConnectionId.value
  if (!connectionId) return

  selectedProjectId.value = projectId
  selectedDatasetId.value = null
  selectedTableId.value = null
  datasets.value = []
  tables.value = []
  fields.value = []

  connectionsStore.setConnectionProjectId(connectionId, projectId)
  bigqueryStore.setProjectId(projectId)
  datasets.value = await bigqueryStore.fetchDatasets(projectId)
})

const selectDataset = (datasetId: string) => runAction(async () => {
  selectedDatasetId.value = datasetId
  selectedTableId.value = null
  tables.value = []
  fields.value = []
  tables.value = await bigqueryStore.fetchTables(datasetId, selectedProjectId.value)
})

const selectTable = (tableId: string) => runAction(async () => {
  if (!selectedDatasetId.value) return
  selectedTableId.value = tableId
  fields.value = []
  const detail = await bigqueryStore.fetchTableSchema(
    selectedDatasetId.value,
    tableId,
    selectedProjectId.value,
  )
  fields.value = detail.fields || []
  if (selectedConnectionId.value && selectedProjectId.value) {
    await duckdbStore.upsertTableSchema(
      'bigquery',
      selectedConnectionId.value,
      selectedProjectId.value,
      selectedDatasetId.value,
      tableId,
      fields.value.map(field => ({ name: field.name, type: field.type })),
    )
  }
})

const querySelectedTable = () => {
  if (!selectedProjectId.value || !selectedDatasetId.value || !selectedTableId.value) return
  emit('query-table', {
    tableName: `\`${selectedProjectId.value}.${selectedDatasetId.value}.${selectedTableId.value}\``,
    boxName: selectedTableId.value,
    engine: 'bigquery',
    connectionId: selectedConnectionId.value || undefined,
  })
}

const navigateToTable = async (info: {
  connectionId?: string
  tableName: string
  projectId?: string
  datasetId?: string
}) => {
  const parts = info.tableName.replace(/`/g, '').split('.')
  const projectId = info.projectId || (parts.length >= 3 ? parts[parts.length - 3] : undefined)
  const datasetId = info.datasetId || (parts.length >= 2 ? parts[parts.length - 2] : undefined)
  const tableId = parts[parts.length - 1]
  const connectionId = info.connectionId || connectionsStore.activeConnectionId || connections.value[0]?.id
  if (!connectionId || !projectId || !datasetId || !tableId) return

  await selectConnection(connectionId)
  await selectProject(projectId)
  await selectDataset(datasetId)
  await selectTable(tableId)
}

defineExpose({ navigateToTable })
</script>

<template>
  <BaseBox
    :box-id="props.boxId"
    :initial-x="props.initialX"
    :initial-y="props.initialY"
    :initial-width="props.initialWidth"
    :initial-height="props.initialHeight"
    :initial-z-index="props.initialZIndex"
    :is-selected="props.isSelected"
    :initial-name="props.initialName"
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="schema-browser">
      <div v-if="error" class="schema-error">
        {{ error }}
      </div>
      <div v-if="loading" class="schema-loading">
        Loading BigQuery metadata…
      </div>

      <div class="schema-columns">
        <section class="schema-column">
          <h3>Accounts</h3>
          <button
            v-for="connection in connections"
            :key="connection.id"
            :class="{ selected: selectedConnectionId === connection.id }"
            @click="selectConnection(connection.id)"
          >
            {{ connection.email || connection.name }}
            <span v-if="connectionsStore.isConnectionExpired(connection.id)">authorize</span>
          </button>
          <p v-if="connections.length === 0" class="empty">
            Connect to BigQuery from the menu.
          </p>
        </section>

        <section class="schema-column">
          <h3>Projects</h3>
          <button
            v-for="project in projects"
            :key="project.projectId"
            :class="{ selected: selectedProjectId === project.projectId }"
            @click="selectProject(project.projectId)"
          >
            {{ project.name || project.projectId }}
          </button>
        </section>

        <section class="schema-column">
          <h3>Datasets</h3>
          <button
            v-for="dataset in datasets"
            :key="dataset.datasetReference.datasetId"
            :class="{ selected: selectedDatasetId === dataset.datasetReference.datasetId }"
            @click="selectDataset(dataset.datasetReference.datasetId)"
          >
            {{ dataset.datasetReference.datasetId }}
          </button>
        </section>

        <section class="schema-column">
          <h3>Tables</h3>
          <button
            v-for="table in tables"
            :key="table.tableReference.tableId"
            :class="{ selected: selectedTableId === table.tableReference.tableId }"
            @click="selectTable(table.tableReference.tableId)"
            @dblclick="querySelectedTable"
          >
            {{ table.tableReference.tableId }}
          </button>
        </section>

        <section class="schema-column schema-fields">
          <h3>Columns</h3>
          <div v-for="field in fields" :key="field.name" class="schema-field">
            <span>{{ field.name }}</span>
            <code>{{ field.type }}</code>
          </div>
          <button v-if="selectedTableId" class="query-table-button" @click="querySelectedTable">
            New query
          </button>
        </section>
      </div>
    </div>
  </BaseBox>
</template>
<style scoped>
/* Schema Browser - Column View */
.schema-browser {
  display: flex;
  height: 100%;
  background: var(--surface-primary);
  overflow-x: auto;
  overflow-y: hidden;
}

.schema-columns {
  display: flex;
  min-width: 100%;
  height: 100%;
}

.schema-column {
  min-width: 180px;
  flex: 1 0 180px;
  overflow: auto;
  border-right: var(--border-width-thin) solid var(--border-secondary);
}

.schema-column h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-secondary);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  font-size: var(--font-size-body-sm);
}

.schema-column button {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.schema-column button:hover,
.schema-column button.selected {
  background: var(--surface-secondary);
}

.schema-field {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.schema-field code,
.schema-column button span,
.empty {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.empty,
.schema-error,
.schema-loading {
  padding: var(--space-3);
}

.schema-error {
  position: absolute;
  z-index: 3;
  right: var(--space-3);
  bottom: var(--space-3);
  max-width: 70%;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--color-error);
  color: var(--color-error);
}

.schema-loading {
  position: absolute;
  z-index: 2;
  right: 0;
  color: var(--text-secondary);
}

.column {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-schema {
  flex: 1;
  min-width: 200px;
}

.resize-handle {
  flex: 0 0 var(--border-width-thin);
  background: var(--border-secondary);
  cursor: col-resize;
  position: relative;
}

/* Invisible larger hit area for easier dragging */
.resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--space-1) * -1);
  right: calc(var(--space-1) * -1);
}

.column-header-area {
  flex-shrink: 0;
  background: var(--surface-secondary);
  border-bottom: var(--table-border-width) solid var(--border-secondary);
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--table-cell-padding);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.column-filter-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.column:hover .column-filter-toggle,
.column-filter-toggle.active {
  opacity: 1;
}

.column-filter-toggle:hover {
  color: var(--text-primary);
}

.column-filter-toggle.active {
  color: var(--color-accent);
}

.column-filter-row {
  padding: 0 var(--space-2) var(--space-1);
}

.column-filter-input {
  width: 100%;
  padding: 3px var(--space-2);
  border: 1px solid var(--border-secondary);
  background: var(--surface-primary);
  font-family: var(--font-family-mono);
  font-size: 11px;
  color: var(--text-primary);
  outline: none;
}

.column-filter-input:focus {
  border-color: var(--color-accent);
}

.column-filter-input::placeholder {
  color: var(--text-tertiary);
}

.column-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  /* Performance: allow browser to optimize rendering */
  contain: strict;
}

/* Virtual scroll container */
.column-content.virtual-scroll {
  position: relative;
}

.virtual-scroll-spacer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
}

.item {
  /* Performance: skip rendering off-screen items */
  content-visibility: auto;
  contain-intrinsic-size: auto 26px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  user-select: none;
}

/* Engine badge uses global .engine-badge from style.css */

.item:hover {
  background: var(--table-row-stripe-bg);
}

.item.selected {
  background: var(--table-row-hover-bg);
}

.item-name {
  flex: 1;
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.table-metadata-pane {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-3);
  border-top: var(--table-border-width) solid var(--border-secondary);
  background: var(--surface-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
}

.metadata-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.metadata-label {
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
}

.metadata-value {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.schema-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  gap: var(--space-2);
  cursor: pointer;
  /* Performance: skip rendering off-screen items */
  content-visibility: auto;
  contain-intrinsic-size: auto 26px;
}

.schema-field:hover {
  background: var(--table-row-stripe-bg);
}

.schema-field.selected {
  background: var(--table-row-hover-bg);
}

.field-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.field-name {
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.field-type {
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.loading {
  padding: var(--space-3);
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-size-body-sm);
}

.query-button {
  padding: 2px 6px;
  background: var(--surface-secondary);
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: var(--text-primary);
  opacity: 0;
  transition: opacity 0.1s ease;
  flex-shrink: 0;
}

.query-button.visible {
  opacity: 0.7;
}

.query-button:hover {
  opacity: 1;
  background: var(--surface-tertiary);
}

/* Analytics button in schema fields - uses CSS :hover for performance */
.field-info .analytics-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.field-info .analytics-btn svg {
  width: 10px;
  height: 10px;
}

/* Show analytics button on row hover (CSS-only, no JS state) */
.schema-field:hover .analytics-btn {
  opacity: 1;
}

.field-info .analytics-btn:hover {
  color: var(--text-primary);
}

.scroll-spacer {
  flex-shrink: 0;
}
</style>
