<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import ResizableBox from './ResizableBox.vue'
import { useAuthStore } from '../stores/auth'
import { useCanvasStore } from '../stores/canvas'

const authStore = useAuthStore()
const canvasStore = useCanvasStore()

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 400 },
  initialHeight: { type: Number, default: 600 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialName: { type: String, default: 'Schema Browser' },
  database: { type: String, default: 'bigquery' }
})

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name'])

// Editable name state
const isEditingName = ref(false)
const boxName = ref(props.initialName)
const nameInputRef = ref(null)

// Schema browsing state
const selectedDataset = ref(null)
const datasets = ref([])
const tables = ref({}) // { datasetId: [tables] }
const expandedTables = ref({}) // { tableId: true/false }
const tableSchemas = ref({}) // { tableId: schema }

const isLoadingDatasets = ref(false)
const isLoadingTables = ref({})
const isLoadingSchema = ref({})
const error = ref(null)

// Watch for prop changes
watch(() => props.initialName, (newName) => {
  boxName.value = newName
})

// Load datasets
const loadDatasets = async () => {
  if (!authStore.isAuthenticated) {
    error.value = 'Please sign in to browse schema'
    return
  }

  if (!canvasStore.selectedProject) {
    error.value = 'Please select a project'
    return
  }

  isLoadingDatasets.value = true
  error.value = null

  try {
    const fetchedDatasets = await authStore.fetchDatasets()
    datasets.value = fetchedDatasets.map(ds => ({
      id: ds.datasetReference.datasetId,
      name: ds.datasetReference.datasetId
    }))
  } catch (err) {
    error.value = err.message || 'Failed to load datasets'
  } finally {
    isLoadingDatasets.value = false
  }
}

// Toggle dataset (load tables)
const toggleDataset = async (datasetId) => {
  if (selectedDataset.value === datasetId) {
    selectedDataset.value = null
    return
  }

  selectedDataset.value = datasetId

  // Load tables if not already loaded
  if (!tables.value[datasetId]) {
    await loadTables(datasetId)
  }
}

// Load tables for a dataset
const loadTables = async (datasetId) => {
  isLoadingTables.value[datasetId] = true
  error.value = null

  try {
    const fetchedTables = await authStore.fetchTables(datasetId)
    tables.value[datasetId] = fetchedTables.map(t => ({
      id: t.tableReference.tableId,
      name: t.tableReference.tableId,
      type: t.type
    }))
  } catch (err) {
    error.value = err.message || 'Failed to load tables'
  } finally {
    isLoadingTables.value[datasetId] = false
  }
}

// Toggle table schema
const toggleTableSchema = async (datasetId, tableId) => {
  const key = `${datasetId}.${tableId}`

  if (expandedTables.value[key]) {
    expandedTables.value[key] = false
    return
  }

  expandedTables.value[key] = true

  // Load schema if not already loaded
  if (!tableSchemas.value[key]) {
    await loadTableSchema(datasetId, tableId, key)
  }
}

// Load table schema
const loadTableSchema = async (datasetId, tableId, key) => {
  isLoadingSchema.value[key] = true
  error.value = null

  try {
    const schema = await authStore.fetchTableSchema(datasetId, tableId)
    tableSchemas.value[key] = schema
  } catch (err) {
    error.value = err.message || 'Failed to load schema'
  } finally {
    isLoadingSchema.value[key] = false
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

const handleSelect = () => {
  emit('select')
}

const handleUpdatePosition = (newPosition) => {
  emit('update:position', newPosition)
}

const handleUpdateSize = (newSize) => {
  emit('update:size', newSize)
}

const handleMaximize = (e) => {
  e.stopPropagation()
  emit('maximize')
}

const handleDelete = (e) => {
  e.stopPropagation()
  emit('delete')
}

// Load datasets on mount if authenticated and BigQuery
onMounted(() => {
  if (props.database === 'bigquery' && authStore.isAuthenticated && canvasStore.selectedProject) {
    loadDatasets()
  }
})
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
        <button
          class="header-btn maximize-btn"
          @click="handleMaximize"
          title="Maximize"
        >⛶</button>
        <button
          class="header-btn delete-btn"
          @click="handleDelete"
          title="Delete"
        >✕</button>
      </div>
    </template>

    <div class="schema-browser">
      <!-- Error Banner -->
      <div v-if="error" class="error-banner">
        {{ error }}
      </div>

      <!-- Loading State -->
      <div v-if="isLoadingDatasets" class="loading-state">
        Loading datasets...
      </div>

      <!-- Empty State -->
      <div v-else-if="datasets.length === 0 && !error" class="empty-state">
        <div v-if="!authStore.isAuthenticated">
          Sign in to browse schema
        </div>
        <div v-else-if="!canvasStore.selectedProject">
          Select a project to browse schema
        </div>
        <div v-else>
          No datasets found
        </div>
      </div>

      <!-- Datasets List -->
      <div v-else class="datasets-list">
        <div v-for="dataset in datasets" :key="dataset.id" class="dataset-item">
          <button
            class="dataset-header"
            @click="toggleDataset(dataset.id)"
          >
            <span class="caret">{{ selectedDataset === dataset.id ? '▼' : '▶' }}</span>
            <span class="dataset-name">{{ dataset.name }}</span>
          </button>

          <!-- Tables List -->
          <div v-if="selectedDataset === dataset.id" class="tables-list">
            <div v-if="isLoadingTables[dataset.id]" class="loading-message">
              Loading tables...
            </div>
            <div v-else-if="!tables[dataset.id] || tables[dataset.id].length === 0" class="empty-message">
              No tables found
            </div>
            <div v-else v-for="table in tables[dataset.id]" :key="table.id" class="table-item">
              <button
                class="table-header"
                @click="toggleTableSchema(dataset.id, table.id)"
              >
                <span class="caret">{{ expandedTables[`${dataset.id}.${table.id}`] ? '▼' : '▶' }}</span>
                <span class="table-name">{{ table.name }}</span>
                <span class="table-type">{{ table.type }}</span>
              </button>

              <!-- Columns List -->
              <div v-if="expandedTables[`${dataset.id}.${table.id}`]" class="columns-list">
                <div v-if="isLoadingSchema[`${dataset.id}.${table.id}`]" class="loading-message">
                  Loading schema...
                </div>
                <div v-else-if="tableSchemas[`${dataset.id}.${table.id}`]" class="columns">
                  <div
                    v-for="(column, index) in tableSchemas[`${dataset.id}.${table.id}`]"
                    :key="index"
                    class="column-item"
                  >
                    <span class="column-name">{{ column.name }}</span>
                    <span class="column-type">{{ column.type }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ResizableBox>
</template>

<style scoped>
.schema-browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-primary);
}

.error-banner {
  padding: var(--space-2) var(--space-3);
  background: var(--color-error-bg);
  border-bottom: var(--border-width-thin) solid var(--border-error);
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
  font-weight: bold;
  flex-shrink: 0;
}

.loading-state,
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  text-align: center;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

.datasets-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.dataset-item {
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.dataset-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  text-align: left;
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: background 0.1s;
}

.dataset-header:hover {
  background: var(--surface-secondary);
}

.caret {
  font-size: 10px;
  width: 12px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.dataset-name {
  font-weight: 600;
  font-family: var(--font-family-mono);
}

.tables-list {
  background: var(--surface-secondary);
  border-top: var(--border-width-thin) solid var(--border-secondary);
}

.table-item {
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.table-item:last-child {
  border-bottom: none;
}

.table-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) + 20px);
  background: transparent;
  border: none;
  text-align: left;
  font-size: var(--font-size-body-sm);
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: background 0.1s;
}

.table-header:hover {
  background: var(--surface-tertiary);
}

.table-name {
  flex: 1;
  font-family: var(--font-family-mono);
  font-weight: 500;
}

.table-type {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
}

.columns-list {
  background: var(--surface-primary);
  padding: var(--space-1) 0;
}

.loading-message,
.empty-message {
  padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) + 40px);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  font-style: italic;
}

.columns {
  padding-left: calc(var(--space-3) + 40px);
}

.column-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-caption);
}

.column-name {
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  font-weight: 500;
}

.column-type {
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  text-transform: uppercase;
  font-size: 10px;
}

/* Header name container */
.box-name-container {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-right: auto;
}

.box-name {
  cursor: pointer;
  user-select: none;
  line-height: var(--line-height-tight);
  height: 16px;
  display: inline-block;
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
  margin: 0;
  min-width: 100px;
  max-width: 400px;
  line-height: var(--line-height-tight);
  height: 14px;
  display: inline-block;
}

/* Header buttons */
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
  border: var(--border-width-thin) solid var(--text-inverse);
  color: var(--text-inverse);
  cursor: pointer;
  font-size: var(--font-size-body);
  padding: 0;
  line-height: 1;
  transition: all 0.2s;
  outline: none;
}

.header-btn:focus {
  outline: none;
}

.header-btn:hover {
  background: var(--text-inverse);
  color: var(--surface-inverse);
}

.delete-btn:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: var(--text-inverse);
}
</style>
