<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import BaseBox from './BaseBox.vue'
import { useAuthStore } from '../stores/auth'
import { useCanvasStore } from '../stores/canvas'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { useSchemaStore } from '../stores/schema'

const authStore = useAuthStore()
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const schemaStore = useSchemaStore()

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

const props = defineProps({
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
const selectedProject = ref(null)
const selectedDataset = ref(null)
const selectedTable = ref(null)

// Data cache
const datasets = ref({}) // { projectId: [datasets] }
const tables = ref({}) // { datasetId: [tables] }
const schemas = ref({}) // { tableId: schema }

// Loading states
const loadingDatasets = ref({})
const loadingTables = ref({})
const loadingSchema = ref({})

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

// Column 1: Projects (including DuckDB)
const projects = computed(() => {
  const items = [{ id: 'duckdb', name: 'DuckDB', type: 'duckdb' }]

  // Only show BigQuery project if there's an active BigQuery connection
  if (connectionsStore.activeConnection?.type === 'bigquery' && canvasStore.activeProjectId) {
    items.push({
      id: canvasStore.activeProjectId,
      name: canvasStore.activeProjectId,
      type: 'bigquery'
    })
  }

  return items
})

// Column 2: Datasets or Tables (depending on selected project)
const column2Items = computed(() => {
  if (!selectedProject.value) return []

  if (selectedProject.value === 'duckdb') {
    // Show DuckDB tables directly
    return Object.keys(duckdbStore.tables).map(tableName => ({
      id: tableName,
      name: tableName,
      type: 'table',
      rowCount: duckdbStore.tables[tableName].rowCount
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
  const key = selectedProject.value === 'duckdb'
    ? selectedTable.value
    : `${selectedDataset.value}.${selectedTable.value}`
  return schemas.value[key] || []
})

// Select project
const selectProject = async (projectId) => {
  selectedProject.value = projectId
  selectedDataset.value = null
  selectedTable.value = null

  // Load datasets for BigQuery projects
  if (projectId !== 'duckdb' && !datasets.value[projectId]) {
    await loadDatasets(projectId)
  }
}

// Select dataset
const selectDataset = async (datasetId) => {
  selectedDataset.value = datasetId
  selectedTable.value = null

  // Load tables for this dataset
  if (!tables.value[datasetId]) {
    await loadTables(datasetId)
  }
}

// Select table
const selectTable = async (tableId) => {
  selectedTable.value = tableId

  // Load schema
  const key = selectedProject.value === 'duckdb'
    ? tableId
    : `${selectedDataset.value}.${tableId}`

  if (!schemas.value[key]) {
    await loadSchema(tableId, key)
  }
}

// Load BigQuery datasets
const loadDatasets = async (projectId) => {
  if (!authStore.isAuthenticated || connectionsStore.isActiveTokenExpired) return

  loadingDatasets.value[projectId] = true
  try {
    const fetchedDatasets = await authStore.fetchDatasets()
    datasets.value[projectId] = fetchedDatasets.map(ds => ({
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
const loadTables = async (datasetId) => {
  if (!authStore.isAuthenticated || connectionsStore.isActiveTokenExpired) return

  loadingTables.value[datasetId] = true
  try {
    const fetchedTables = await authStore.fetchTables(datasetId)
    tables.value[datasetId] = fetchedTables.map(t => ({
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

// Load table schema
const loadSchema = async (tableId, key) => {
  if (selectedProject.value === 'duckdb') {
    // DuckDB schema
    const table = duckdbStore.tables[tableId]
    if (table && table.columns) {
      schemas.value[key] = table.columns.map(col => ({
        name: col,
        type: 'VARCHAR' // Simplified for now
      }))
    }
  } else {
    // BigQuery schema
    if (!authStore.isAuthenticated || connectionsStore.isActiveTokenExpired) return

    loadingSchema.value[key] = true
    try {
      const schema = await authStore.fetchTableSchema(selectedDataset.value, tableId)
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
const insertTableName = (item) => {
  let tableName = ''

  if (selectedProject.value === 'duckdb') {
    tableName = item.name
  } else if (item.type === 'table') {
    tableName = `\`${selectedProject.value}.${selectedDataset.value}.${item.name}\``
  }

  if (tableName) {
    // Copy to clipboard
    navigator.clipboard.writeText(tableName)
  }
}

// Query table - creates a new query box with SELECT * query
const queryTable = (item) => {
  // Determine engine and build full table name
  const engine = selectedProject.value === 'duckdb' ? 'duckdb' : 'bigquery'

  let fullTableName = ''
  if (selectedProject.value === 'duckdb') {
    fullTableName = item.name
  } else {
    // BigQuery: project.dataset.table
    fullTableName = `${selectedProject.value}.${selectedDataset.value}.${item.name}`
  }

  // Emit event to parent with table info
  emit('query-table', {
    tableName: fullTableName,
    engine: engine
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
        <div class="column-header">Projects</div>
        <div class="column-content">
          <div
            v-for="project in projects"
            :key="project.id"
            :class="['item', { selected: selectedProject === project.id }]"
            @click="selectProject(project.id)"
          >
            <span class="item-name">{{ project.name }}</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 1 -->
      <div class="resize-handle" @mousedown="handleResizeStart($event, 1)"></div>

      <!-- Column 2: Datasets or DuckDB Tables -->
      <div v-if="selectedProject" class="column" :style="{ width: `${col2Width}px` }">
        <div class="column-header">
          {{ selectedProject === 'duckdb' ? 'Tables' : 'Datasets' }}
        </div>
        <div class="column-content">
          <div v-if="loadingDatasets[selectedProject]" class="loading">Loading...</div>
          <div
            v-for="item in column2Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProject === 'duckdb' ? selectedTable === item.id : selectedDataset === item.id
            }]"
            @click="selectedProject === 'duckdb' ? selectTable(item.id) : selectDataset(item.id)"
            @dblclick="selectedProject === 'duckdb' ? insertTableName(item) : null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProject === 'duckdb' && selectedTable === item.id"
              class="query-button"
              @click.stop="queryTable(item)"
              title="Query this table"
            >
              ▶
            </button>
            <span v-if="item.rowCount" class="item-meta">{{ item.rowCount }} rows</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 2 -->
      <div v-if="selectedProject" class="resize-handle" @mousedown="handleResizeStart($event, 2)"></div>

      <!-- Column 3: BigQuery Tables -->
      <div v-if="selectedDataset && selectedProject !== 'duckdb'" class="column" :style="{ width: `${col3Width}px` }">
        <div class="column-header">Tables</div>
        <div class="column-content">
          <div v-if="loadingTables[selectedDataset]" class="loading">Loading...</div>
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
              title="Query this table"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 3 -->
      <div v-if="selectedDataset && selectedProject !== 'duckdb'" class="resize-handle" @mousedown="handleResizeStart($event, 3)"></div>

      <!-- Column 4: Schema -->
      <div v-if="selectedTable" class="column column-schema">
        <div class="column-header">Schema</div>
        <div class="column-content">
          <div v-if="loadingSchema[selectedTable]" class="loading">Loading...</div>
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
  background: var(--surface-primary);
  border-bottom: var(--table-border-width) solid var(--border-primary);
  font-size: var(--font-size-body-sm);
  font-weight: bold;
  color: var(--text-primary);
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
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
  transition: background 0.1s ease, font-weight 0.1s ease;
}

.item:hover {
  background: var(--table-row-stripe-bg);
}

.item.selected {
  background: var(--table-row-stripe-bg);
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
