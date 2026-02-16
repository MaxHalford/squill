<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted, nextTick, watch } from 'vue'
import BaseBox from './BaseBox.vue'
import { useBigQueryStore } from '../stores/bigquery'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useSchemaStore } from '../stores/bigquerySchema'
import { getTypeCategory } from '../utils/typeUtils'
import { DATABASE_INFO, type DatabaseEngine } from '../types/database'
import type { BigQueryDataset, BigQueryTable } from '../types/bigquery'
import type { PostgresTableInfo } from '../stores/postgres'
import type { SnowflakeDatabaseInfo, SnowflakeSchemaInfo, SnowflakeTableInfo } from '../stores/snowflake'


// Schema browser item types for the column navigation
interface BrowserItem {
  id: string
  name: string
  type: string
  rowCount?: number
  schemaName?: string
  databaseName?: string
}

interface SchemaField {
  name: string
  type: string
}

const bigqueryStore = useBigQueryStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
const schemaStore = useSchemaStore()

// ResizeObserver for virtual scroll container
let columnsResizeObserver: ResizeObserver | null = null

onMounted(async () => {
  // Set up resize observer for virtual scroll container
  columnsResizeObserver = new ResizeObserver(() => {
    updateColumnsContainerHeight()
  })
})

// Inject canvas zoom for resize handle dragging
const canvasZoom = ref(1)
try {
  const injectedZoom = inject('canvasZoom', ref(1))
  if (injectedZoom) {
    canvasZoom.value = injectedZoom.value
  }
} catch {
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

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'query-table', 'show-column-analytics'])

// Column navigation state
const selectedProject = ref<string | null>(null)
const selectedDataset = ref<string | null>(null)
const selectedTable = ref<string | null>(null)
// BigQuery-specific: project selection (between connection and dataset)
const selectedBigQueryProject = ref<string | null>(null)
// Snowflake-specific: database and schema selection
const selectedSnowflakeDatabase = ref<string | null>(null)
const selectedSnowflakeSchema = ref<string | null>(null)

// Data cache
const datasets = ref<Record<string, BrowserItem[]>>({}) // { projectId: [datasets] }
const tables = ref<Record<string, BrowserItem[]>>({}) // { datasetId: [tables] }
const schemas = ref<Record<string, SchemaField[]>>({}) // { tableId: schema }
// BigQuery-specific cache
const bigqueryProjectsByConnection = ref<Record<string, { projectId: string; name?: string }[]>>({}) // { connectionId: [projects] }
// Snowflake-specific caches
const snowflakeDatabases = ref<Record<string, SnowflakeDatabaseInfo[]>>({}) // { connectionId: [databases] }
const snowflakeSchemas = ref<Record<string, SnowflakeSchemaInfo[]>>({}) // { connectionId:database: [schemas] }
const snowflakeTables = ref<Record<string, SnowflakeTableInfo[]>>({}) // { connectionId:database.schema: [tables] }

// Per-column filter state
const col1Filter = ref('')
const col2Filter = ref('')
const col3Filter = ref('')
const col4Filter = ref('')
const col5Filter = ref('')
const col1FilterOpen = ref(false)
const col2FilterOpen = ref(false)
const col3FilterOpen = ref(false)
const col4FilterOpen = ref(false)
const col5FilterOpen = ref(false)

// Toggle filter and auto-focus the input
const toggleFilter = (col: number) => {
  const openRefs = [col1FilterOpen, col2FilterOpen, col3FilterOpen, col4FilterOpen, col5FilterOpen]
  const filterRefs = [col1Filter, col2Filter, col3Filter, col4Filter, col5Filter]
  const openRef = openRefs[col - 1]
  openRef.value = !openRef.value
  if (!openRef.value) {
    filterRefs[col - 1].value = ''
  } else {
    nextTick(() => {
      const input = document.querySelector(`.col${col}-filter-input`) as HTMLInputElement
      input?.focus()
    })
  }
}

// Close filter on Escape
const closeFilter = (col: number) => {
  const openRefs = [col1FilterOpen, col2FilterOpen, col3FilterOpen, col4FilterOpen, col5FilterOpen]
  const filterRefs = [col1Filter, col2Filter, col3Filter, col4Filter, col5Filter]
  openRefs[col - 1].value = false
  filterRefs[col - 1].value = ''
}

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
const col4Width = ref(200)

// Resize handle state
const isDraggingHandle = ref<number | null>(null) // null or handle index (1, 2, 3, 4)
const dragStartX = ref(0)
const dragStartWidth = ref(0)

// Column 1: Connections (DuckDB, BigQuery, PostgreSQL, Snowflake)
const projects = computed(() => {
  const items: { id: string; name: string; type: string; connectionId?: string }[] = [
    { id: 'duckdb', name: DATABASE_INFO.duckdb.name, type: 'duckdb' }
  ]

  // Show one entry per BigQuery connection
  const bigqueryConnections = connectionsStore.getConnectionsByType('bigquery')
  bigqueryConnections.forEach(conn => {
    items.push({
      id: conn.id,
      name: conn.email || conn.name || DATABASE_INFO.bigquery.name,
      type: 'bigquery',
      connectionId: conn.id
    })
  })

  // Show all PostgreSQL connections
  const postgresConnections = connectionsStore.getConnectionsByType('postgres')
  postgresConnections.forEach(conn => {
    items.push({
      id: conn.id,
      name: conn.name || conn.database || DATABASE_INFO.postgres.name,
      type: 'postgres',
      connectionId: conn.id
    })
  })

  // Show all Snowflake connections
  const snowflakeConnections = connectionsStore.getConnectionsByType('snowflake')
  snowflakeConnections.forEach(conn => {
    items.push({
      id: conn.id,
      name: conn.name || conn.database || DATABASE_INFO.snowflake.name,
      type: 'snowflake',
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

// Column 2: Datasets (BigQuery), Databases (Snowflake), or Tables (DuckDB/PostgreSQL)
const column2Items = computed((): BrowserItem[] => {
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
    return postgresTables.map((t) => ({
      id: `${t.schemaName}.${t.name}`,
      name: t.schemaName === 'public' ? t.name : `${t.schemaName}.${t.name}`,
      type: t.type || 'table',
      schemaName: t.schemaName
    }))
  } else if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake databases (like BigQuery datasets)
    const databases = snowflakeDatabases.value[selectedProject.value] || []
    return databases.map((db) => ({
      id: db.name,
      name: db.name,
      type: 'database'
    }))
  } else if (selectedProjectType.value === 'bigquery') {
    // Show BigQuery projects for this connection
    const cachedProjects = bigqueryProjectsByConnection.value[selectedProject.value!] || []
    return cachedProjects.map(p => ({
      id: p.projectId,
      name: p.projectId,
      type: 'project'
    }))
  }
  return []
})

// Column 3: Tables (for BigQuery) or Schemas (for Snowflake)
const column3Items = computed(() => {
  if (selectedProject.value === 'duckdb') return []

  if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake schemas when database is selected
    if (!selectedSnowflakeDatabase.value) return []
    const cacheKey = `${selectedProject.value}:${selectedSnowflakeDatabase.value}`
    const schemaList = snowflakeSchemas.value[cacheKey] || []
    return schemaList.map((s) => ({
      id: s.name,
      name: s.name,
      type: 'schema'
    }))
  }

  if (selectedProjectType.value === 'bigquery') {
    // BigQuery: show datasets when project is selected
    if (!selectedBigQueryProject.value) return []
    return datasets.value[selectedBigQueryProject.value] || []
  }

  // Fallback
  if (!selectedDataset.value) return []
  return tables.value[selectedDataset.value] || []
})

// Column 4: Tables (for Snowflake when schema is selected) or Columns
const column4Items = computed((): BrowserItem[] => {
  if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake tables when schema is selected
    if (!selectedSnowflakeSchema.value || !selectedSnowflakeDatabase.value) return []
    const cacheKey = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}`
    const tableList = snowflakeTables.value[cacheKey] || []
    // Use table name as id for selection tracking
    return tableList.map((t) => ({
      id: t.name,
      name: t.name,
      type: t.type || 'table'
    }))
  }

  if (selectedProjectType.value === 'bigquery') {
    // BigQuery: show tables when dataset is selected
    if (!selectedDataset.value) return []
    return tables.value[selectedDataset.value] || []
  }

  // For DuckDB/Postgres, show columns
  if (!selectedTable.value) return []
  let key: string
  if (selectedProject.value === 'duckdb') {
    key = selectedTable.value
  } else if (selectedProjectType.value === 'postgres') {
    key = `${selectedProject.value}:${selectedTable.value}`
  } else {
    key = `${selectedDataset.value}.${selectedTable.value}`
  }
  return (schemas.value[key] || []).map((f) => ({
    id: f.name,
    name: f.name,
    type: f.type
  }))
})

// Column 5: Columns (for Snowflake and BigQuery)
const column5Items = computed((): BrowserItem[] => {
  if (selectedProjectType.value !== 'snowflake' && selectedProjectType.value !== 'bigquery') return []
  if (!selectedTable.value) return []

  let key: string
  if (selectedProjectType.value === 'snowflake') {
    key = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}.${selectedTable.value}`
  } else {
    key = `${selectedDataset.value}.${selectedTable.value}`
  }
  return (schemas.value[key] || []).map((f) => ({
    id: f.name,
    name: f.name,
    type: f.type
  }))
})

// Virtual scrolling for columns list (performance optimization for large tables)
const COLUMN_ITEM_HEIGHT = 32
const COLUMN_BUFFER_SIZE = 10 // Extra items to render above/below viewport
const columnsScrollTop = ref(0)
const columnsContainerHeight = ref(400)
const columnsContainerRef = ref<HTMLElement | null>(null)

// Get the raw column items (either column4Items for non-Snowflake or column5Items for Snowflake)
const rawColumnItems = computed(() => {
  return (selectedProjectType.value === 'snowflake' || selectedProjectType.value === 'bigquery')
    ? column5Items.value
    : column4Items.value
})

// Filtered column items (per-column substring filter)
const filterItems = <T extends { name: string }>(items: T[], query: string): T[] => {
  if (!query) return items
  const q = query.toLowerCase()
  return items.filter(item => item.name.toLowerCase().includes(q))
}

const filteredProjects = computed(() => filterItems(projects.value, col1Filter.value))
const filteredColumn2Items = computed(() => filterItems(column2Items.value, col2Filter.value))
const filteredColumn3Items = computed(() => filterItems(column3Items.value, col3Filter.value))
const filteredColumn4Items = computed(() => filterItems(column4Items.value, col4Filter.value))
const filteredRawColumnItems = computed(() => filterItems(rawColumnItems.value, col5Filter.value))

// Total height of the virtual scroll container
const columnsTotalHeight = computed(() => {
  return filteredRawColumnItems.value.length * COLUMN_ITEM_HEIGHT
})

// Calculate visible items with virtual scrolling
const visibleColumnItems = computed(() => {
  const items = filteredRawColumnItems.value
  if (items.length === 0) return []

  // For small lists (< 100 items), don't virtualize - the overhead isn't worth it
  if (items.length < 100) {
    return items.map((item, index) => ({
      ...item,
      index,
      style: {}
    }))
  }

  const startIndex = Math.max(0, Math.floor(columnsScrollTop.value / COLUMN_ITEM_HEIGHT) - COLUMN_BUFFER_SIZE)
  const visibleCount = Math.ceil(columnsContainerHeight.value / COLUMN_ITEM_HEIGHT)
  const endIndex = Math.min(items.length, startIndex + visibleCount + COLUMN_BUFFER_SIZE * 2)

  return items.slice(startIndex, endIndex).map((item, i) => ({
    ...item,
    index: startIndex + i,
    style: {
      position: 'absolute' as const,
      top: `${(startIndex + i) * COLUMN_ITEM_HEIGHT}px`,
      left: '0',
      right: '0',
      height: `${COLUMN_ITEM_HEIGHT}px`
    }
  }))
})

// Whether to use virtual scrolling (only for large lists)
const useVirtualScroll = computed(() => filteredRawColumnItems.value.length >= 100)

// Handle scroll events for virtual scrolling
const handleColumnsScroll = (e: Event) => {
  const target = e.target as HTMLElement
  columnsScrollTop.value = target.scrollTop
}

// Update container height on resize
const updateColumnsContainerHeight = () => {
  if (columnsContainerRef.value) {
    columnsContainerHeight.value = columnsContainerRef.value.clientHeight
  }
}

// Select connection (column 1)
const selectProject = async (projectId: string) => {
  selectedProject.value = projectId
  selectedBigQueryProject.value = null
  selectedDataset.value = null
  selectedTable.value = null
  selectedSnowflakeDatabase.value = null
  selectedSnowflakeSchema.value = null
  col2Filter.value = ''; col2FilterOpen.value = false
  col3Filter.value = ''; col3FilterOpen.value = false
  col4Filter.value = ''; col4FilterOpen.value = false
  col5Filter.value = ''; col5FilterOpen.value = false

  const project = projects.value.find(p => p.id === projectId)

  if (projectId === 'duckdb') {
    return
  }

  if (project?.type === 'postgres') {
    if (!tables.value[projectId]) {
      await loadPostgresTables(projectId)
    }
  } else if (project?.type === 'snowflake') {
    if (!snowflakeDatabases.value[projectId]) {
      await loadSnowflakeDatabases(projectId)
    }
  } else if (project?.type === 'bigquery') {
    if (!bigqueryProjectsByConnection.value[projectId]) {
      await loadBigQueryProjects(projectId)
    }
  }
}

// Select BigQuery project (column 2 for BigQuery)
const selectBigQueryProject = async (projectId: string) => {
  if (selectedBigQueryProject.value === projectId) return

  selectedBigQueryProject.value = projectId
  selectedDataset.value = null
  selectedTable.value = null
  col3Filter.value = ''; col3FilterOpen.value = false
  col4Filter.value = ''; col4FilterOpen.value = false
  col5Filter.value = ''; col5FilterOpen.value = false

  if (!datasets.value[projectId]) {
    await loadDatasets(projectId)
  }

  // Fetch all schemas for this project if not already loaded (populates schema store
  // for autocomplete). Fire-and-forget to avoid blocking navigation.
  const hasProjectSchemas = Object.keys(schemaStore.bigQuerySchemas).some(
    key => key.startsWith(`${projectId}.`)
  )
  if (!hasProjectSchemas) {
    bigqueryStore.fetchAllSchemas(projectId, selectedProject.value!).catch(err => {
      console.warn(`Could not fetch schemas for ${projectId}:`, err)
    })
  }
}

// Load BigQuery projects for a connection
const loadBigQueryProjects = async (connectionId: string) => {
  loadingDatasets.value[connectionId] = true
  try {
    const fetchedProjects = await bigqueryStore.fetchProjectsWithAnyConnection()
    bigqueryProjectsByConnection.value[connectionId] = fetchedProjects
  } catch (err) {
    console.error('Failed to load BigQuery projects:', err)
  } finally {
    loadingDatasets.value[connectionId] = false
  }
}

// Select dataset
const selectDataset = async (datasetId: string) => {
  selectedDataset.value = datasetId
  selectedTable.value = null
  col4Filter.value = ''; col4FilterOpen.value = false
  col5Filter.value = ''; col5FilterOpen.value = false

  // Load tables for this dataset
  if (!tables.value[datasetId]) {
    await loadTables(datasetId)
  }
}

// Select Snowflake database
const selectSnowflakeDatabase = async (databaseName: string) => {
  selectedSnowflakeDatabase.value = databaseName
  selectedSnowflakeSchema.value = null
  selectedTable.value = null
  col3Filter.value = ''; col3FilterOpen.value = false
  col4Filter.value = ''; col4FilterOpen.value = false
  col5Filter.value = ''; col5FilterOpen.value = false

  // Load schemas for this database
  const cacheKey = `${selectedProject.value}:${databaseName}`
  if (!snowflakeSchemas.value[cacheKey]) {
    await loadSnowflakeSchemas(selectedProject.value!, databaseName)
  }
}

// Select Snowflake schema
const selectSnowflakeSchema = async (schemaName: string) => {
  selectedSnowflakeSchema.value = schemaName
  selectedTable.value = null
  col4Filter.value = ''; col4FilterOpen.value = false
  col5Filter.value = ''; col5FilterOpen.value = false

  // Load tables for this schema
  const cacheKey = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${schemaName}`
  if (!snowflakeTables.value[cacheKey]) {
    await loadSnowflakeTablesForSchema(selectedProject.value!, selectedSnowflakeDatabase.value!, schemaName)
  }
}

// Select table
const selectTable = async (tableId: string) => {
  selectedTable.value = tableId
  selectedColumn.value = null
  col5Filter.value = ''; col5FilterOpen.value = false
  // Reset virtual scroll position when switching tables
  columnsScrollTop.value = 0
  if (columnsContainerRef.value) {
    columnsContainerRef.value.scrollTop = 0
  }

  // Load schema
  let key: string
  if (selectedProject.value === 'duckdb') {
    key = tableId
  } else if (selectedProjectType.value === 'postgres') {
    // For postgres, tableId is already schema.table format
    key = `${selectedProject.value}:${tableId}`
  } else if (selectedProjectType.value === 'snowflake') {
    // For snowflake, use selected database and schema from hierarchical navigation
    key = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}.${tableId}`
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
    datasets.value[projectId] = fetchedDatasets.map((ds: BigQueryDataset) => ({
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
  const bqProject = selectedBigQueryProject.value
  if (!bqProject) return

  loadingTables.value[datasetId] = true
  try {
    // Use the helper that works with any BigQuery connection
    const fetchedTables = await bigqueryStore.fetchTablesWithAnyConnection(datasetId, bqProject)
    tables.value[datasetId] = fetchedTables.map((t: BigQueryTable) => ({
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
    tables.value[connectionId] = fetchedTables.map((t: PostgresTableInfo) => ({
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

// Load Snowflake databases
const loadSnowflakeDatabases = async (connectionId: string) => {
  loadingDatasets.value[connectionId] = true
  try {
    const fetchedDatabases = await snowflakeStore.fetchDatabases(connectionId)
    snowflakeDatabases.value[connectionId] = fetchedDatabases
  } catch (err) {
    console.error('Failed to load Snowflake databases:', err)
  } finally {
    loadingDatasets.value[connectionId] = false
  }
}

// Load Snowflake schemas for a database
const loadSnowflakeSchemas = async (connectionId: string, databaseName: string) => {
  const cacheKey = `${connectionId}:${databaseName}`
  loadingTables.value[cacheKey] = true
  try {
    const fetchedSchemas = await snowflakeStore.fetchSchemas(connectionId, databaseName)
    snowflakeSchemas.value[cacheKey] = fetchedSchemas
  } catch (err) {
    console.error('Failed to load Snowflake schemas:', err)
  } finally {
    loadingTables.value[cacheKey] = false
  }
}

// Load Snowflake tables for a specific schema
const loadSnowflakeTablesForSchema = async (connectionId: string, databaseName: string, schemaName: string) => {
  const cacheKey = `${connectionId}:${databaseName}.${schemaName}`
  loadingTables.value[cacheKey] = true
  try {
    const fetchedTables = await snowflakeStore.fetchTablesForSchema(connectionId, databaseName, schemaName)
    snowflakeTables.value[cacheKey] = fetchedTables.map((t: SnowflakeTableInfo) => ({
      name: t.name,
      databaseName: t.databaseName,
      schemaName: t.schemaName,
      type: t.type
    }))
  } catch (err) {
    console.error('Failed to load Snowflake tables:', err)
  } finally {
    loadingTables.value[cacheKey] = false
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
    loadingSchema.value[tableId] = true
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
      loadingSchema.value[tableId] = false
    }
  } else if (selectedProjectType.value === 'snowflake') {
    // Snowflake schema - use selected database and schema from hierarchical navigation
    if (!selectedSnowflakeDatabase.value || !selectedSnowflakeSchema.value) return
    loadingSchema.value[tableId] = true
    try {
      const columns = await snowflakeStore.fetchColumns(
        selectedProject.value!,
        selectedSnowflakeDatabase.value,
        selectedSnowflakeSchema.value,
        tableId
      )
      schemas.value[key] = columns.map(col => ({
        name: col.name,
        type: col.type
      }))
    } catch (err) {
      console.error('Failed to load Snowflake schema:', err)
    } finally {
      loadingSchema.value[tableId] = false
    }
  } else {
    // BigQuery schema - use helper that works with any BigQuery connection
    if (!selectedDataset.value || !selectedBigQueryProject.value) return

    loadingSchema.value[tableId] = true
    try {
      const schema = await bigqueryStore.fetchTableSchemaWithAnyConnection(selectedDataset.value, tableId, selectedBigQueryProject.value)
      schemas.value[key] = schema

      // Also populate the schema store for autocompletion
      if (selectedBigQueryProject.value && selectedDataset.value) {
        schemaStore.setTableSchema(
          selectedBigQueryProject.value,
          selectedDataset.value,
          tableId,
          schema
        )
      }
    } catch (err) {
      console.error('Failed to load schema:', err)
    } finally {
      loadingSchema.value[tableId] = false
    }
  }
}

// Insert table name into query
const insertTableName = (item: BrowserItem) => {
  let tableName = ''

  if (selectedProject.value === 'duckdb') {
    tableName = item.name
  } else if (selectedProjectType.value === 'postgres') {
    // PostgreSQL: use schema.table or just table if public schema
    tableName = item.schemaName === 'public' ? item.name : `${item.schemaName}.${item.name}`
  } else if (selectedProjectType.value === 'snowflake') {
    // Snowflake: construct full path from hierarchical navigation and wrap each part in double quotes
    const dbName = selectedSnowflakeDatabase.value || item.databaseName
    const schemaName = selectedSnowflakeSchema.value || item.schemaName
    tableName = `"${dbName}"."${schemaName}"."${item.name}"`
  } else if (selectedProjectType.value === 'bigquery') {
    tableName = `\`${selectedBigQueryProject.value}.${selectedDataset.value}.${item.name}\``
  }

  if (tableName) {
    // Copy to clipboard
    navigator.clipboard.writeText(tableName)
  }
}

// Query table - creates a new query box with SELECT * query
const queryTable = (item: BrowserItem) => {
  // Determine engine and build full table name
  let engine: DatabaseEngine
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
  } else if (selectedProjectType.value === 'snowflake') {
    engine = 'snowflake'
    // For snowflake, construct full path from hierarchical navigation and wrap each part in double quotes
    const dbName = selectedSnowflakeDatabase.value || item.databaseName
    const schemaName = selectedSnowflakeSchema.value || item.schemaName
    const rawName = `${dbName}.${schemaName}.${item.name}`
    fullTableName = `"${dbName}"."${schemaName}"."${item.name}"`
    connectionId = selectedProject.value!
    // Emit with separate boxName (unquoted) for Snowflake
    emit('query-table', {
      tableName: fullTableName,
      boxName: rawName,
      engine: engine,
      connectionId: connectionId
    })
    return
  } else {
    engine = 'bigquery'
    fullTableName = `${selectedBigQueryProject.value}.${selectedDataset.value}.${item.name}`
    connectionId = selectedProject.value!
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
  } else if (handleIndex === 4) {
    dragStartWidth.value = col4Width.value
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
  } else if (isDraggingHandle.value === 4) {
    col4Width.value = newWidth
  }
}

const handleResizeEnd = () => {
  isDraggingHandle.value = null
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', handleResizeEnd)
}

// Column analytics state
const selectedColumn = ref<string | null>(null)
const hoveredTableItem = ref<string | null>(null)

// Cleanup resize observer on unmount
onUnmounted(() => {
  if (columnsResizeObserver) {
    columnsResizeObserver.disconnect()
    columnsResizeObserver = null
  }
})

// Watch for columnsContainerRef changes to set up resize observer
watch(columnsContainerRef, (newRef, oldRef) => {
  if (oldRef && columnsResizeObserver) {
    columnsResizeObserver.unobserve(oldRef)
  }
  if (newRef && columnsResizeObserver) {
    columnsResizeObserver.observe(newRef)
    updateColumnsContainerHeight()
  }
})

const schemaBrowserRef = ref<HTMLElement | null>(null)

// Scroll selected items into view
const scrollSelectedIntoView = () => {
  if (!schemaBrowserRef.value) return
  // Scroll selected items (tables, datasets, etc.)
  const selectedItems = schemaBrowserRef.value.querySelectorAll('.item.selected')
  selectedItems.forEach(item => {
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
  // Scroll selected column
  const selectedColumnEl = schemaBrowserRef.value.querySelector('.schema-field.selected')
  if (selectedColumnEl) {
    selectedColumnEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}


// Check if type is unsupported for analytics (binary/json)
const isUnsupportedType = (typeStr: string): boolean => {
  const category = getTypeCategory(typeStr)
  return category === 'binary' || category === 'json'
}

// Get columns for current table
const getCurrentTableColumns = (): string[] => {
  if (!selectedTable.value) return []
  let key: string
  if (selectedProject.value === 'duckdb') {
    key = selectedTable.value
  } else if (selectedProjectType.value === 'postgres') {
    key = `${selectedProject.value}:${selectedTable.value}`
  } else if (selectedProjectType.value === 'snowflake') {
    key = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}.${selectedTable.value}`
  } else {
    key = `${selectedDataset.value}.${selectedTable.value}`
  }
  const schemaFields = schemas.value[key] || []
  return schemaFields.map((f: { name: string }) => f.name)
}

// Build table connection info for current selection (reuses queryTable logic pattern)
const buildTableConnectionInfo = () => {
  if (!selectedTable.value) return null

  let engine: DatabaseEngine
  let tableName: string
  let quotedTableName: string
  let connectionId: string | undefined

  if (selectedProject.value === 'duckdb') {
    engine = 'duckdb'
    tableName = selectedTable.value
    quotedTableName = `"${tableName}"`
  } else if (selectedProjectType.value === 'postgres') {
    engine = 'postgres'
    // selectedTable.value is already schema.table format
    const [schemaName, tblName] = selectedTable.value.split('.')
    tableName = selectedTable.value
    quotedTableName = `${schemaName}."${tblName}"`
    connectionId = selectedProject.value!
  } else if (selectedProjectType.value === 'snowflake') {
    engine = 'snowflake'
    const dbName = selectedSnowflakeDatabase.value
    const schemaName = selectedSnowflakeSchema.value
    tableName = `${dbName}.${schemaName}.${selectedTable.value}`
    quotedTableName = `"${dbName}"."${schemaName}"."${selectedTable.value}"`
    connectionId = selectedProject.value!
  } else {
    engine = 'bigquery'
    tableName = `${selectedBigQueryProject.value}.${selectedDataset.value}.${selectedTable.value}`
    quotedTableName = `\`${tableName}\``
    connectionId = selectedProject.value!
  }

  return {
    engine,
    tableName,
    quotedTableName,
    connectionId,
    originalQuery: `SELECT * FROM ${quotedTableName}`
  }
}

// Handle show analytics button click
const handleShowAnalytics = (event: MouseEvent, field: { name: string; type: string }) => {
  event.stopPropagation()

  const typeCategory = getTypeCategory(field.type)
  if (typeCategory === 'binary' || typeCategory === 'json') return

  const tableInfo = buildTableConnectionInfo()
  if (!tableInfo) return

  emit('show-column-analytics', {
    columnName: field.name,
    columnType: field.type,
    typeCategory,
    tableName: tableInfo.tableName,
    clickX: event.clientX,
    clickY: event.clientY,
    sourceEngine: tableInfo.engine,
    originalQuery: tableInfo.originalQuery,
    connectionId: tableInfo.connectionId,
    availableColumns: getCurrentTableColumns()
  })
}

// Navigation info for Cmd+click table navigation from query editor
interface TableNavigationInfo {
  connectionType: string
  connectionId?: string
  tableName: string
  projectId?: string
  datasetId?: string
  databaseName?: string
  schemaName?: string
}

// Navigate to a table from external request (e.g., Cmd+click in query editor)
const navigateToTable = async (info: TableNavigationInfo) => {
  if (info.connectionType === 'duckdb') {
    // DuckDB doesn't have qualified names, but handle gracefully
    await selectProject('duckdb')
    // For DuckDB, tableName might be schema.table format, use last part
    const tableOnly = info.tableName.includes('.') ? info.tableName.split('.').pop()! : info.tableName
    await selectTable(tableOnly)
  } else if (info.connectionType === 'bigquery') {
    const bqConnections = connectionsStore.getConnectionsByType('bigquery')
    const connId = info.connectionId || (bqConnections.length > 0 ? bqConnections[0].id : null)
    if (connId) {
      await selectProject(connId)
    }
    if (info.projectId) {
      await selectBigQueryProject(info.projectId)
    }
    if (info.datasetId) {
      await selectDataset(info.datasetId)
    }
    await selectTable(info.tableName)
  } else if (info.connectionType === 'postgres') {
    if (info.connectionId) {
      await selectProject(info.connectionId)
    }
    // For postgres, construct schema.table format if schemaName provided
    const fullTableName = info.schemaName
      ? `${info.schemaName}.${info.tableName}`
      : info.tableName
    await selectTable(fullTableName)
  } else if (info.connectionType === 'snowflake') {
    if (info.connectionId) {
      await selectProject(info.connectionId)
    }
    if (info.databaseName) {
      await selectSnowflakeDatabase(info.databaseName)
    }
    if (info.schemaName) {
      await selectSnowflakeSchema(info.schemaName)
    }
    await selectTable(info.tableName)
  }

  // Clear column selection
  selectedColumn.value = null

  // Scroll selected items into view after DOM updates
  await nextTick()
  scrollSelectedIntoView()
}

defineExpose({
  navigateToTable
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
    initial-name="Schema browser"
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div
      ref="schemaBrowserRef"
      class="schema-browser"
    >
      <!-- Column 1: Connections -->
      <div
        class="column"
        :style="{ width: `${col1Width}px` }"
      >
        <div class="column-header-area">
          <div class="column-header">
            <span class="column-header-label">Connections</span>
            <button
              class="column-filter-toggle"
              :class="{ active: col1FilterOpen || col1Filter }"
              @click.stop="toggleFilter(1)"
              @mousedown.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div v-if="col1FilterOpen" class="column-filter-row">
            <input
              v-model="col1Filter"
              class="column-filter-input col1-filter-input"
              type="text"
              placeholder="Filter..."
              @keydown.escape="closeFilter(1)"
              @mousedown.stop
              @click.stop
            >
          </div>
        </div>
        <div class="column-content">
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            :class="['item', { selected: selectedProject === project.id }]"
            @click="selectProject(project.id)"
          >
            <span
              class="engine-badge"
              :style="{
                background: DATABASE_INFO[project.type as DatabaseEngine].color,
                color: DATABASE_INFO[project.type as DatabaseEngine].textColor
              }"
            >
              {{ DATABASE_INFO[project.type as DatabaseEngine].shortName }}
            </span>
            <span class="item-name">{{ project.name }}</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 1 -->
      <div
        class="resize-handle"
        @mousedown="handleResizeStart($event, 1)"
      />

      <!-- Column 2: Datasets (BigQuery), Databases (Snowflake), or Tables (DuckDB/PostgreSQL) -->
      <div
        v-if="selectedProject"
        class="column"
        :style="{ width: `${col2Width}px` }"
      >
        <div class="column-header-area">
          <div class="column-header">
            <span class="column-header-label">{{ selectedProjectType === 'bigquery' ? 'Projects' : selectedProjectType === 'snowflake' ? 'Databases' : 'Tables' }}</span>
            <button
              class="column-filter-toggle"
              :class="{ active: col2FilterOpen || col2Filter }"
              @click.stop="toggleFilter(2)"
              @mousedown.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div v-if="col2FilterOpen" class="column-filter-row">
            <input
              v-model="col2Filter"
              class="column-filter-input col2-filter-input"
              type="text"
              placeholder="Filter..."
              @keydown.escape="closeFilter(2)"
              @mousedown.stop
              @click.stop
            >
          </div>
        </div>
        <div class="column-content">
          <div
            v-if="loadingDatasets[selectedProject] || loadingTables[selectedProject]"
            class="loading"
          >
            Retrieving...
          </div>
          <div
            v-for="item in filteredColumn2Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProjectType === 'bigquery' ? selectedBigQueryProject === item.id :
                selectedProjectType === 'snowflake' ? selectedSnowflakeDatabase === item.id :
                selectedTable === item.id
            }]"
            @click="selectedProjectType === 'bigquery' ? selectBigQueryProject(item.id) :
              selectedProjectType === 'snowflake' ? selectSnowflakeDatabase(item.id) :
              selectTable(item.id)"
            @dblclick="selectedProjectType !== 'bigquery' && selectedProjectType !== 'snowflake' ? insertTableName(item) : null"
            @mouseenter="hoveredTableItem = item.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProjectType !== 'bigquery' && selectedProjectType !== 'snowflake'"
              v-tooltip="'Query this table'"
              class="query-button"
              :class="{ visible: hoveredTableItem === item.id }"
              @click.stop="queryTable(item)"
            >
              ▶
            </button>
            <span
              v-if="item.rowCount"
              class="item-meta"
            >{{ item.rowCount }} rows</span>
          </div>
        </div>
      </div>

      <!-- Resize handle 2 -->
      <div
        v-if="selectedProject"
        class="resize-handle"
        @mousedown="handleResizeStart($event, 2)"
      />

      <!-- Column 3: BigQuery Datasets or Snowflake Schemas -->
      <div
        v-if="(selectedBigQueryProject && selectedProjectType === 'bigquery') || (selectedSnowflakeDatabase && selectedProjectType === 'snowflake')"
        class="column"
        :style="{ width: `${col3Width}px` }"
      >
        <div class="column-header-area">
          <div class="column-header">
            <span class="column-header-label">{{ selectedProjectType === 'bigquery' ? 'Datasets' : 'Schemas' }}</span>
            <button
              class="column-filter-toggle"
              :class="{ active: col3FilterOpen || col3Filter }"
              @click.stop="toggleFilter(3)"
              @mousedown.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div v-if="col3FilterOpen" class="column-filter-row">
            <input
              v-model="col3Filter"
              class="column-filter-input col3-filter-input"
              type="text"
              placeholder="Filter..."
              @keydown.escape="closeFilter(3)"
              @mousedown.stop
              @click.stop
            >
          </div>
        </div>
        <div class="column-content">
          <div
            v-if="selectedProjectType === 'bigquery' && selectedBigQueryProject && loadingDatasets[selectedBigQueryProject]"
            class="loading"
          >
            Retrieving...
          </div>
          <div
            v-if="selectedProjectType === 'snowflake' && loadingTables[`${selectedProject}:${selectedSnowflakeDatabase}`]"
            class="loading"
          >
            Retrieving...
          </div>
          <div
            v-for="item in filteredColumn3Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProjectType === 'bigquery' ? selectedDataset === item.id :
                selectedProjectType === 'snowflake' ? selectedSnowflakeSchema === item.id :
                selectedTable === item.id
            }]"
            @click="selectedProjectType === 'bigquery' ? selectDataset(item.id) :
              selectedProjectType === 'snowflake' ? selectSnowflakeSchema(item.id) :
              selectTable(item.id)"
            @dblclick="selectedProjectType !== 'snowflake' && selectedProjectType !== 'bigquery' ? insertTableName(item) : null"
            @mouseenter="hoveredTableItem = item.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProjectType !== 'snowflake' && selectedProjectType !== 'bigquery'"
              v-tooltip="'Query this table'"
              class="query-button"
              :class="{ visible: hoveredTableItem === item.id }"
              @click.stop="queryTable(item)"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 3 -->
      <div
        v-if="(selectedBigQueryProject && selectedProjectType === 'bigquery') || (selectedSnowflakeDatabase && selectedProjectType === 'snowflake')"
        class="resize-handle"
        @mousedown="handleResizeStart($event, 3)"
      />

      <!-- Column 4: Tables (Snowflake when schema is selected, BigQuery when dataset is selected) -->
      <div
        v-if="(selectedSnowflakeSchema && selectedProjectType === 'snowflake') || (selectedDataset && selectedProjectType === 'bigquery')"
        class="column"
        :style="{ width: `${col4Width}px` }"
      >
        <div class="column-header-area">
          <div class="column-header">
            <span class="column-header-label">Tables</span>
            <button
              class="column-filter-toggle"
              :class="{ active: col4FilterOpen || col4Filter }"
              @click.stop="toggleFilter(4)"
              @mousedown.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div v-if="col4FilterOpen" class="column-filter-row">
            <input
              v-model="col4Filter"
              class="column-filter-input col4-filter-input"
              type="text"
              placeholder="Filter..."
              @keydown.escape="closeFilter(4)"
              @mousedown.stop
              @click.stop
            >
          </div>
        </div>
        <div class="column-content">
          <div
            v-if="selectedProjectType === 'snowflake' && loadingTables[`${selectedProject}:${selectedSnowflakeDatabase}.${selectedSnowflakeSchema}`]"
            class="loading"
          >
            Retrieving...
          </div>
          <div
            v-if="selectedProjectType === 'bigquery' && selectedDataset && loadingTables[selectedDataset]"
            class="loading"
          >
            Retrieving...
          </div>
          <div
            v-for="table in filteredColumn4Items"
            :key="table.id"
            :class="['item', { selected: selectedTable === table.id }]"
            @click="selectTable(table.id)"
            @dblclick="insertTableName(table)"
            @mouseenter="hoveredTableItem = table.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ table.name }}</span>
            <button
              v-tooltip="'Query this table'"
              class="query-button"
              :class="{ visible: hoveredTableItem === table.id }"
              @click.stop="queryTable(table)"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 4 (between Tables and Columns) -->
      <div
        v-if="(selectedSnowflakeSchema && selectedProjectType === 'snowflake') || (selectedDataset && selectedProjectType === 'bigquery')"
        class="resize-handle"
        @mousedown="handleResizeStart($event, 4)"
      />

      <!-- Column 4 (DuckDB/Postgres) / Column 5 (Snowflake/BigQuery): Columns -->
      <div
        v-if="selectedTable"
        class="column column-schema"
      >
        <div class="column-header-area">
          <div class="column-header">
            <span class="column-header-label">Columns</span>
            <button
              class="column-filter-toggle"
              :class="{ active: col5FilterOpen || col5Filter }"
              @click.stop="toggleFilter(5)"
              @mousedown.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div v-if="col5FilterOpen" class="column-filter-row">
            <input
              v-model="col5Filter"
              class="column-filter-input col5-filter-input"
              type="text"
              placeholder="Filter..."
              @keydown.escape="closeFilter(5)"
              @mousedown.stop
              @click.stop
            >
          </div>
        </div>
        <div
          ref="columnsContainerRef"
          class="column-content"
          :class="{ 'virtual-scroll': useVirtualScroll }"
          @scroll="handleColumnsScroll"
        >
          <div
            v-if="loadingSchema[selectedTable]"
            class="loading"
          >
            Retrieving...
          </div>
          <!-- Virtual scroll spacer - creates the full scrollable height -->
          <div
            v-if="useVirtualScroll"
            class="virtual-scroll-spacer"
            :style="{ height: `${columnsTotalHeight}px` }"
          />
          <!-- Render only visible items when virtualizing -->
          <div
            v-for="field in visibleColumnItems"
            :key="field.name"
            :class="['schema-field', { selected: selectedColumn === field.name }]"
            :style="useVirtualScroll ? field.style : {}"
            @click="selectedColumn = selectedColumn === field.name ? null : field.name"
          >
            <span class="field-info">
              <span class="field-name">{{ field.name }}</span>
              <button
                v-if="!isUnsupportedType(field.type)"
                v-tooltip="'View column analytics'"
                class="analytics-btn"
                @click.stop="handleShowAnalytics($event, field)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 20V10M12 20V4M6 20v-6" />
                </svg>
              </button>
            </span>
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
  overflow-x: auto;
  overflow-y: hidden;
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
  contain-intrinsic-size: auto 32px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
}

/* Engine badge uses global .engine-badge from style.css */

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
  align-items: center;
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
  cursor: pointer;
  /* Performance: skip rendering off-screen items */
  content-visibility: auto;
  contain-intrinsic-size: auto 32px;
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
</style>
