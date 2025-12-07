<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import BaseBox from './BaseBox.vue'
import { useBigQueryStore } from '../stores/bigquery'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSchemaStore } from '../stores/bigquerySchema'

const bigqueryStore = useBigQueryStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const schemaStore = useSchemaStore()

// Load BigQuery projects on mount if we have BQ connections but no projects loaded
onMounted(async () => {
  const bigqueryConnections = connectionsStore.getConnectionsByType('bigquery')
  if (bigqueryConnections.length > 0 && bigqueryStore.projects.length === 0) {
    try {
      await bigqueryStore.fetchProjectsWithAnyConnection()
    } catch (err) {
      console.warn('Failed to load BigQuery projects:', err)
    }
  }
})

// Inject canvas zoom for resize handle dragging
const canvasZoom = ref(1)
try {
  const injectedZoom = inject('canvasZoom', ref(1))
  if (injectedZoom) {
    canvasZoom.value = injectedZoom.value
  }
} catch (e) {
  // Use default zoom if injection fails
}

defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 800 },
  initialHeight: { type: Number, default: 600 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialName: { type: String, default: 'Schema Browser' }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'query-table'])

// Column navigation state
const selectedProject = ref<string | null>(null)
const selectedDataset = ref<string | null>(null)
const selectedTable = ref<string | null>(null)

// Data cache
const datasets = ref<Record<string, any[]>>({}) // { projectId: [datasets] }
const tables = ref<Record<string, any[]>>({}) // { datasetId: [tables] }
const schemas = ref<Record<string, any[]>>({}) // { tableId: schema }

// Loading states
const loadingDatasets = ref<Record<string, boolean>>({})
const loadingTables = ref<Record<string, boolean>>({})
const loadingSchema = ref<Record<string, boolean>>({})

// Column widths (resizable)
const MIN_COLUMN_WIDTH = 120
const MAX_COLUMN_WIDTH = 500
const col1Width = ref(200)
const col2Width = ref(200)
const col3Width = ref(200)

// Resize handle state
const isDraggingHandle = ref<number | null>(null) // null or handle index (1, 2, 3)
const dragStartX = ref(0)
const dragStartWidth = ref(0)

// Column 1: Projects (including DuckDB, BigQuery, and PostgreSQL connections)
const projects = computed(() => {
  const items: { id: string; name: string; type: string; connectionId?: string }[] = [
    { id: 'duckdb', name: 'DuckDB', type: 'duckdb' }
  ]

  // Show all BigQuery projects if we have any BigQuery connections and projects loaded
  // (projects are loaded during OAuth callback and persist)
  const bigqueryConnections = connectionsStore.getConnectionsByType('bigquery')
  if (bigqueryConnections.length > 0 && bigqueryStore.projects.length > 0) {
    bigqueryStore.projects.forEach(project => {
      items.push({
        id: project.projectId,
        name: project.name || project.projectId,
        type: 'bigquery'
      })
    })
  }

  // Show all PostgreSQL connections
  const postgresConnections = connectionsStore.getConnectionsByType('postgres')
  postgresConnections.forEach(conn => {
    items.push({
      id: conn.id,
      name: conn.name || conn.database || 'PostgreSQL',
      type: 'postgres',
      connectionId: conn.id
    })
  })

  return items
})

// Get selected project type
const selectedProjectType = computed(() => {
  if (!selectedProject.value) return null
  if (selectedProject.value === 'duckdb') return 'duckdb'
  const project = projects.value.find(p => p.id === selectedProject.value)
  return project?.type || 'bigquery'
})

// Column 2: Datasets or Tables (depending on selected project)
const column2Items = computed(() => {
  if (!selectedProject.value) return []

  if (selectedProject.value === 'duckdb') {
    // Show DuckDB tables directly (filter out internal analytics tables)
    return Object.keys(duckdbStore.tables)
      .filter(tableName => !tableName.startsWith('_analytics_'))
      .map(tableName => ({
        id: tableName,
        name: tableName,
        type: 'table',
        rowCount: duckdbStore.tables[tableName].rowCount
      }))
  } else if (selectedProjectType.value === 'postgres') {
    // Show PostgreSQL tables directly (grouped by schema)
    const postgresTables = tables.value[selectedProject.value] || []
    return postgresTables.map((t: any) => ({
      id: `${t.schemaName}.${t.name}`,
      name: t.schemaName === 'public' ? t.name : `${t.schemaName}.${t.name}`,
      type: t.type || 'table',
      schemaName: t.schemaName
    }))
  } else {
    // Show BigQuery datasets
    return datasets.value[selectedProject.value] || []
  }
})

// Column 3: Tables (for BigQuery datasets only)
const column3Items = computed(() => {
  if (!selectedDataset.value || selectedProject.value === 'duckdb') return []
  return tables.value[selectedDataset.value] || []
})

// Column 4: Schema (for selected table)
const column4Items = computed(() => {
  if (!selectedTable.value) return []
  let key: string
  if (selectedProject.value === 'duckdb') {
    key = selectedTable.value
  } else if (selectedProjectType.value === 'postgres') {
    key = `${selectedProject.value}:${selectedTable.value}`
  } else {
    key = `${selectedDataset.value}.${selectedTable.value}`
  }
  return schemas.value[key] || []
})

// Select project
const selectProject = async (projectId: string) => {
  selectedProject.value = projectId
  selectedDataset.value = null
  selectedTable.value = null

  const project = projects.value.find(p => p.id === projectId)

  if (projectId === 'duckdb') {
    // DuckDB tables already loaded
    return
  }

  if (project?.type === 'postgres') {
    // Load PostgreSQL tables
    if (!tables.value[projectId]) {
      await loadPostgresTables(projectId)
    }
  } else {
    // Load BigQuery datasets
    if (!datasets.value[projectId]) {
      await loadDatasets(projectId)
    }
  }
}

// Select dataset
const selectDataset = async (datasetId: string) => {
  selectedDataset.value = datasetId
  selectedTable.value = null

  // Load tables for this dataset
  if (!tables.value[datasetId]) {
    await loadTables(datasetId)
  }
}

// Select table
const selectTable = async (tableId: string) => {
  selectedTable.value = tableId

  // Load schema
  let key: string
  if (selectedProject.value === 'duckdb') {
    key = tableId
  } else if (selectedProjectType.value === 'postgres') {
    // For postgres, tableId is already schema.table format
    key = `${selectedProject.value}:${tableId}`
  } else {
    key = `${selectedDataset.value}.${tableId}`
  }

  if (!schemas.value[key]) {
    await loadSchema(tableId, key)
  }
}

// Load BigQuery datasets
const loadDatasets = async (projectId: string) => {
  loadingDatasets.value[projectId] = true
  try {
    // Use the helper that works with any BigQuery connection
    const fetchedDatasets = await bigqueryStore.fetchDatasetsWithAnyConnection(projectId)
    datasets.value[projectId] = fetchedDatasets.map((ds: any) => ({
      id: ds.datasetReference.datasetId,
      name: ds.datasetReference.datasetId,
      type: 'dataset'
    }))
  } catch (err) {
    console.error('Failed to load datasets:', err)
  } finally {
    loadingDatasets.value[projectId] = false
  }
}

// Load BigQuery tables
const loadTables = async (datasetId: string) => {
  if (!selectedProject.value) return

  loadingTables.value[datasetId] = true
  try {
    // Use the helper that works with any BigQuery connection
    const fetchedTables = await bigqueryStore.fetchTablesWithAnyConnection(datasetId, selectedProject.value)
    tables.value[datasetId] = fetchedTables.map((t: any) => ({
      id: t.tableReference.tableId,
      name: t.tableReference.tableId,
      type: 'table'
    }))
  } catch (err) {
    console.error('Failed to load tables:', err)
  } finally {
    loadingTables.value[datasetId] = false
  }
}

// Load PostgreSQL tables
const loadPostgresTables = async (connectionId: string) => {
  loadingTables.value[connectionId] = true
  try {
    const fetchedTables = await postgresStore.fetchTables(connectionId)
    tables.value[connectionId] = fetchedTables.map((t: any) => ({
      id: `${t.schemaName}.${t.name}`,
      name: t.name,
      schemaName: t.schemaName,
      type: t.type
    }))
  } catch (err) {
    console.error('Failed to load PostgreSQL tables:', err)
  } finally {
    loadingTables.value[connectionId] = false
  }
}

// Load table schema
const loadSchema = async (tableId: string, key: string) => {
  if (selectedProject.value === 'duckdb') {
    // DuckDB schema
    const table = duckdbStore.tables[tableId]
    if (table && table.columns) {
      schemas.value[key] = table.columns.map(col => ({
        name: col,
        type: 'VARCHAR' // Simplified for now
      }))
    }
  } else if (selectedProjectType.value === 'postgres') {
    // PostgreSQL schema
    loadingSchema.value[key] = true
    try {
      // tableId is in format schema.table
      const [schemaName, tableName] = tableId.split('.')
      const columns = await postgresStore.fetchColumns(selectedProject.value!, schemaName, tableName)
      schemas.value[key] = columns.map(col => ({
        name: col.name,
        type: col.type
      }))
    } catch (err) {
      console.error('Failed to load PostgreSQL schema:', err)
    } finally {
      loadingSchema.value[key] = false
    }
  } else {
    // BigQuery schema - use helper that works with any BigQuery connection
    if (!selectedDataset.value || !selectedProject.value) return

    loadingSchema.value[key] = true
    try {
      const schema = await bigqueryStore.fetchTableSchemaWithAnyConnection(selectedDataset.value, tableId, selectedProject.value)
      schemas.value[key] = schema

      // Also populate the schema store for autocompletion
      if (selectedProject.value && selectedDataset.value) {
        schemaStore.setTableSchema(
          selectedProject.value,
          selectedDataset.value,
          tableId,
          schema
        )
      }
    } catch (err) {
      console.error('Failed to load schema:', err)
    } finally {
      loadingSchema.value[key] = false
    }
  }
}

// Insert table name into query
const insertTableName = (item: any) => {
  let tableName = ''

  if (selectedProject.value === 'duckdb') {
    tableName = item.name
  } else if (selectedProjectType.value === 'postgres') {
    // PostgreSQL: use schema.table or just table if public schema
    tableName = item.schemaName === 'public' ? item.name : `${item.schemaName}.${item.name}`
  } else if (item.type === 'table') {
    tableName = `\`${selectedProject.value}.${selectedDataset.value}.${item.name}\``
  }

  if (tableName) {
    // Copy to clipboard
    navigator.clipboard.writeText(tableName)
  }
}

// Query table - creates a new query box with SELECT * query
const queryTable = (item: any) => {
  // Determine engine and build full table name
  let engine: 'duckdb' | 'bigquery' | 'postgres'
  let fullTableName = ''
  let connectionId: string | undefined

  if (selectedProject.value === 'duckdb') {
    engine = 'duckdb'
    fullTableName = item.name
  } else if (selectedProjectType.value === 'postgres') {
    engine = 'postgres'
    // For postgres, use schema.table format (item.id is already schema.table)
    fullTableName = item.id || `${item.schemaName}.${item.name}`
    connectionId = selectedProject.value!
  } else {
    engine = 'bigquery'
    // BigQuery: project.dataset.table
    fullTableName = `${selectedProject.value}.${selectedDataset.value}.${item.name}`
  }

  // Emit event to parent with table info
  emit('query-table', {
    tableName: fullTableName,
    engine: engine,
    connectionId: connectionId
  })
}

// Handle column resize
const handleResizeStart = (e: MouseEvent, handleIndex: number) => {
  e.preventDefault()
  e.stopPropagation()

  isDraggingHandle.value = handleIndex
  dragStartX.value = e.clientX

  // Store the starting width of the column being resized
  if (handleIndex === 1) {
    dragStartWidth.value = col1Width.value
  } else if (handleIndex === 2) {
    dragStartWidth.value = col2Width.value
  } else if (handleIndex === 3) {
    dragStartWidth.value = col3Width.value
  }

  // Add global listeners
  window.addEventListener('mousemove', handleResizeMove)
  window.addEventListener('mouseup', handleResizeEnd)
}

const handleResizeMove = (e: MouseEvent) => {
  if (isDraggingHandle.value === null) return

  const deltaX = (e.clientX - dragStartX.value) / canvasZoom.value
  const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, dragStartWidth.value + deltaX))

  if (isDraggingHandle.value === 1) {
    col1Width.value = newWidth
  } else if (isDraggingHandle.value === 2) {
    col2Width.value = newWidth
  } else if (isDraggingHandle.value === 3) {
    col3Width.value = newWidth
  }
}

const handleResizeEnd = () => {
  isDraggingHandle.value = null
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', handleResizeEnd)
}
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
    :show-header-name="false"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="schema-browser">
      <!-- Column 1: Projects -->
      <div class="column" :style="{ width: `${col1Width}px` }">
        <div class="column-header">Connections</div>
        <div class="column-content">
          <div
            v-for="project in projects"
            :key="project.id"
            :class="['item', { selected: selectedProject === project.id }]"
            @click="selectProject(project.id)"
          >
            <span class="db-type-badge" :data-type="project.type">
              {{ project.type === 'bigquery' ? 'BQ' : project.type === 'postgres' ? 'PG' : 'DK' }}
            </span>
            <span class="item-name">{{ project.name }}</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 1 -->
      <div class="resize-handle" @mousedown="handleResizeStart($event, 1)"></div>

      <!-- Column 2: Datasets (BigQuery) or Tables (DuckDB/PostgreSQL) -->
      <div v-if="selectedProject" class="column" :style="{ width: `${col2Width}px` }">
        <div class="column-header">
          {{ selectedProjectType === 'bigquery' ? 'Datasets' : 'Tables' }}
        </div>
        <div class="column-content">
          <div v-if="loadingDatasets[selectedProject] || loadingTables[selectedProject]" class="loading">Retrieving...</div>
          <div
            v-for="item in column2Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProjectType === 'bigquery' ? selectedDataset === item.id : selectedTable === item.id
            }]"
            @click="selectedProjectType === 'bigquery' ? selectDataset(item.id) : selectTable(item.id)"
            @dblclick="selectedProjectType !== 'bigquery' ? insertTableName(item) : null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProjectType !== 'bigquery' && selectedTable === item.id"
              class="query-button"
              @click.stop="queryTable(item)"
              v-tooltip="'Query this table'"
            >
              ▶
            </button>
            <span v-if="item.rowCount" class="item-meta">{{ item.rowCount }} rows</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 2 -->
      <div v-if="selectedProject" class="resize-handle" @mousedown="handleResizeStart($event, 2)"></div>

      <!-- Column 3: BigQuery Tables (only for BigQuery, since DuckDB and Postgres show tables directly in column 2) -->
      <div v-if="selectedDataset && selectedProjectType === 'bigquery'" class="column" :style="{ width: `${col3Width}px` }">
        <div class="column-header">Tables</div>
        <div class="column-content">
          <div v-if="loadingTables[selectedDataset]" class="loading">Retrieving...</div>
          <div
            v-for="table in column3Items"
            :key="table.id"
            :class="['item', { selected: selectedTable === table.id }]"
            @click="selectTable(table.id)"
            @dblclick="insertTableName(table)"
          >
            <span class="item-name">{{ table.name }}</span>
            <button
              v-if="selectedTable === table.id"
              class="query-button"
              @click.stop="queryTable(table)"
              v-tooltip="'Query this table'"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 3 -->
      <div v-if="selectedDataset && selectedProjectType === 'bigquery'" class="resize-handle" @mousedown="handleResizeStart($event, 3)"></div>

      <!-- Column 4: Schema -->
      <div v-if="selectedTable" class="column column-schema">
        <div class="column-header">Schema</div>
        <div class="column-content">
          <div v-if="loadingSchema[selectedTable]" class="loading">Retrieving...</div>
          <div v-for="field in column4Items" :key="field.name" class="schema-field">
            <span class="field-name">{{ field.name }}</span>
            <span class="field-type">{{ field.type }}</span>
          </div>
        </div>
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
  overflow: hidden;
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
  background: var(--border-primary);
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

.column-header {
  padding: var(--table-cell-padding);
  background: var(--surface-secondary);
  border-bottom: var(--table-border-width) solid var(--border-primary);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.column-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
}

/* Database type badge */
.db-type-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.db-type-badge[data-type="duckdb"] {
  background: var(--color-duckdb);
  color: black;
}

.db-type-badge[data-type="bigquery"] {
  background: var(--color-bigquery);
  color: white;
}

.db-type-badge[data-type="postgres"] {
  background: var(--color-postgres);
  color: white;
}

.item:hover {
  background: var(--table-row-stripe-bg);
}

.item.selected {
  background: var(--table-row-hover-bg);
  font-weight: 500;
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

.schema-field {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
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
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  color: var(--text-primary);
  opacity: 0.7;
  transition: opacity 0.2s ease;
  flex-shrink: 0;
}

.query-button:hover {
  opacity: 1;
  background: var(--surface-tertiary);
}
</style>
