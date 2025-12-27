<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import ResizableBox from './ResizableBox.vue'
import { useAuthStore } from '../stores/auth'
import { useCanvasStore } from '../stores/canvas'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'

const authStore = useAuthStore()
const canvasStore = useCanvasStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()

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

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name'])

// Editable name state
const isEditingName = ref(false)
const boxName = ref(props.initialName)
const nameInputRef = ref(null)

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

watch(() => props.initialName, (newName) => {
  boxName.value = newName
})

// Column 1: Projects (including DuckDB)
const projects = computed(() => {
  const items = [{ id: 'duckdb', name: 'DuckDB', type: 'duckdb' }]

  if (canvasStore.activeProjectId) {
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

// Handle name editing
const startEditingName = (e) => {
  e.stopPropagation()
  isEditingName.value = true
  nextTick(() => {
    if (nameInputRef.value) {
      nameInputRef.value.focus()
      nameInputRef.value.select()
    }
  })
}

const finishEditingName = () => {
  isEditingName.value = false
  if (boxName.value.trim()) {
    emit('update:name', boxName.value.trim())
  } else {
    boxName.value = props.initialName
  }
}

const handleNameKeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishEditingName()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    boxName.value = props.initialName
    isEditingName.value = false
  }
}

const handleSelect = () => emit('select')
const handleUpdatePosition = (newPosition) => emit('update:position', newPosition)
const handleUpdateSize = (newSize) => emit('update:size', newSize)
const handleMaximize = (e) => {
  e.stopPropagation()
  emit('maximize')
}
const handleDelete = (e) => {
  e.stopPropagation()
  emit('delete')
}
</script>

<template>
  <ResizableBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    @select="handleSelect"
    @update:position="handleUpdatePosition"
    @update:size="handleUpdateSize"
  >
    <template #header>
      <div class="box-name-container">
        <input
          v-if="isEditingName"
          ref="nameInputRef"
          v-model="boxName"
          @blur="finishEditingName"
          @keydown="handleNameKeydown"
          @click.stop
          class="name-input"
          type="text"
        />
        <span
          v-else
          class="box-name"
          @dblclick="startEditingName"
          title="Double-click to edit"
        >{{ boxName }}</span>
      </div>
      <div class="header-buttons">
        <button class="header-btn maximize-btn" @click="handleMaximize" title="Maximize">⛶</button>
        <button class="header-btn delete-btn" @click="handleDelete" title="Delete">✕</button>
      </div>
    </template>

    <div class="schema-browser">
      <!-- Column 1: Projects -->
      <div class="column">
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

      <!-- Column 2: Datasets or DuckDB Tables -->
      <div v-if="selectedProject" class="column">
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
            <span v-if="item.rowCount" class="item-meta">{{ item.rowCount }} rows</span>
          </div>
        </div>
      </div>

      <!-- Column 3: BigQuery Tables -->
      <div v-if="selectedDataset && selectedProject !== 'duckdb'" class="column">
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
          </div>
        </div>
      </div>

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
  </ResizableBox>
</template>

<style scoped>
/* Header */
.box-name-container {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-right: auto;
}

.box-name {
  cursor: pointer;
  user-select: none;
}

.box-name:hover {
  opacity: 0.7;
}

.name-input {
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font-size: inherit;
  font-family: inherit;
  font-weight: inherit;
  padding: 0;
  min-width: 100px;
}

.header-buttons {
  display: flex;
  gap: var(--space-1);
}

.header-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-inverse);
  cursor: pointer;
  font-size: var(--font-size-body-lg);
  padding: 0;
  outline: none;
  transition: all 0.2s;
}

.header-btn:hover {
  background: var(--text-inverse);
  color: var(--surface-inverse);
}

.delete-btn:hover {
  background: var(--color-error);
  color: var(--text-inverse);
}

/* Schema Browser - Column View */
.schema-browser {
  display: flex;
  height: 100%;
  background: var(--surface-primary);
  overflow: hidden;
}

.column {
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  border-right: var(--border-width-thin) solid var(--border-primary);
  overflow: hidden;
}

.column-schema {
  flex: 1;
  border-right: none;
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
</style>
