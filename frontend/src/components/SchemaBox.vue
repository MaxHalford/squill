<script setup lang="ts">
import { ref, computed, inject, onMounted, nextTick } from 'vue'
import BaseBox from './BaseBox.vue'
import { useBigQueryStore } from '../stores/bigquery'
import { useConnectionsStore } from '../stores/connections'
import { useDuckDBStore } from '../stores/duckdb'
import { usePostgresStore } from '../stores/postgres'
import { useSnowflakeStore } from '../stores/snowflake'
import { useSchemaStore } from '../stores/bigquerySchema'
import { getTypeCategory } from '../utils/typeUtils'
import { DATABASE_INFO, type DatabaseEngine } from '../types/database'
import { collectSchemaForConnection } from '../utils/schemaAdapter'

const bigqueryStore = useBigQueryStore()
const connectionsStore = useConnectionsStore()
const duckdbStore = useDuckDBStore()
const postgresStore = usePostgresStore()
const snowflakeStore = useSnowflakeStore()
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

const emit = defineEmits(['select', 'update:position', 'update:size', 'delete', 'maximize', 'update:name', 'query-table', 'show-column-analytics'])

// Column navigation state
const selectedProject = ref<string | null>(null)
const selectedDataset = ref<string | null>(null)
const selectedTable = ref<string | null>(null)
// Snowflake-specific: database and schema selection
const selectedSnowflakeDatabase = ref<string | null>(null)
const selectedSnowflakeSchema = ref<string | null>(null)

// Data cache
const datasets = ref<Record<string, any[]>>({}) // { projectId: [datasets] }
const tables = ref<Record<string, any[]>>({}) // { datasetId: [tables] }
const schemas = ref<Record<string, any[]>>({}) // { tableId: schema }
// Snowflake-specific caches
const snowflakeDatabases = ref<Record<string, any[]>>({}) // { connectionId: [databases] }
const snowflakeSchemas = ref<Record<string, any[]>>({}) // { connectionId:database: [schemas] }
const snowflakeTables = ref<Record<string, any[]>>({}) // { connectionId:database.schema: [tables] }

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
  } else if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake databases (like BigQuery datasets)
    const databases = snowflakeDatabases.value[selectedProject.value] || []
    return databases.map((db: any) => ({
      id: db.name,
      name: db.name,
      type: 'database'
    }))
  } else {
    // Show BigQuery datasets
    return datasets.value[selectedProject.value] || []
  }
})

// Column 3: Tables (for BigQuery) or Schemas (for Snowflake)
const column3Items = computed(() => {
  if (selectedProject.value === 'duckdb') return []

  if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake schemas when database is selected
    if (!selectedSnowflakeDatabase.value) return []
    const cacheKey = `${selectedProject.value}:${selectedSnowflakeDatabase.value}`
    const schemaList = snowflakeSchemas.value[cacheKey] || []
    return schemaList.map((s: any) => ({
      id: s.name,
      name: s.name,
      type: 'schema'
    }))
  }

  // BigQuery: show tables when dataset is selected
  if (!selectedDataset.value) return []
  return tables.value[selectedDataset.value] || []
})

// Column 4: Tables (for Snowflake when schema is selected) or Columns
const column4Items = computed(() => {
  if (selectedProjectType.value === 'snowflake') {
    // Show Snowflake tables when schema is selected
    if (!selectedSnowflakeSchema.value || !selectedSnowflakeDatabase.value) return []
    const cacheKey = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}`
    const tableList = snowflakeTables.value[cacheKey] || []
    // Use table name as id for selection tracking
    return tableList.map((t: any) => ({
      id: t.name,
      name: t.name,
      type: t.type || 'table'
    }))
  }

  // For other types, show columns
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

// Column 5: Columns (for Snowflake only)
const column5Items = computed(() => {
  if (selectedProjectType.value !== 'snowflake') return []
  if (!selectedTable.value) return []
  const key = `${selectedProject.value}:${selectedSnowflakeDatabase.value}.${selectedSnowflakeSchema.value}.${selectedTable.value}`
  return schemas.value[key] || []
})


// Select project
const selectProject = async (projectId: string) => {
  selectedProject.value = projectId
  selectedDataset.value = null
  selectedTable.value = null
  // Reset Snowflake-specific selections
  selectedSnowflakeDatabase.value = null
  selectedSnowflakeSchema.value = null

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
  } else if (project?.type === 'snowflake') {
    // Load Snowflake databases (hierarchical navigation)
    if (!snowflakeDatabases.value[projectId]) {
      await loadSnowflakeDatabases(projectId)
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

// Select Snowflake database
const selectSnowflakeDatabase = async (databaseName: string) => {
  selectedSnowflakeDatabase.value = databaseName
  selectedSnowflakeSchema.value = null
  selectedTable.value = null

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
    snowflakeTables.value[cacheKey] = fetchedTables.map((t: any) => ({
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
  } else if (selectedProjectType.value === 'snowflake') {
    // Snowflake schema - use selected database and schema from hierarchical navigation
    if (!selectedSnowflakeDatabase.value || !selectedSnowflakeSchema.value) return
    loadingSchema.value[key] = true
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
  } else if (selectedProjectType.value === 'snowflake') {
    // Snowflake: construct full path from hierarchical navigation and wrap each part in double quotes
    const dbName = selectedSnowflakeDatabase.value || item.databaseName
    const schemaName = selectedSnowflakeSchema.value || item.schemaName
    tableName = `"${dbName}"."${schemaName}"."${item.name}"`
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
const hoveredField = ref<string | null>(null)
const selectedColumn = ref<string | null>(null)
const hoveredTableItem = ref<string | null>(null)

// Search state
interface SearchResult {
  connectionId: string
  connectionName: string
  connectionType: DatabaseEngine
  tableName: string
  displayName: string
  matchedColumns: string[]
  // Navigation path info
  projectId?: string
  datasetId?: string
  schemaName?: string
  databaseName?: string
}

const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const schemaBrowserRef = ref<HTMLElement | null>(null)

// Computed search results
const searchResults = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return []

  const results: SearchResult[] = []

  // Search DuckDB
  const duckdbSchema = collectSchemaForConnection('duckdb')
  for (const item of duckdbSchema) {
    const tableMatches = item.tableName.toLowerCase().includes(query)
    const matchedColumns = item.columns
      .filter(col => col.name.toLowerCase().includes(query))
      .map(col => col.name)

    if (tableMatches || matchedColumns.length > 0) {
      results.push({
        connectionId: 'duckdb',
        connectionName: DATABASE_INFO.duckdb.name,
        connectionType: 'duckdb',
        tableName: item.tableName,
        displayName: item.tableName,
        matchedColumns
      })
    }
  }

  // Search BigQuery
  const bigquerySchema = collectSchemaForConnection('bigquery')
  for (const item of bigquerySchema) {
    const parts = item.tableName.split('.')
    if (parts.length !== 3) continue
    const [projectId, datasetId, tableOnly] = parts

    const tableMatches = tableOnly.toLowerCase().includes(query) ||
                         item.tableName.toLowerCase().includes(query)
    const matchedColumns = item.columns
      .filter(col => col.name.toLowerCase().includes(query))
      .map(col => col.name)

    if (tableMatches || matchedColumns.length > 0) {
      results.push({
        connectionId: 'bigquery',
        connectionName: DATABASE_INFO.bigquery.name,
        connectionType: 'bigquery',
        tableName: item.tableName,
        displayName: `${datasetId}.${tableOnly}`,
        matchedColumns,
        projectId,
        datasetId
      })
    }
  }

  // Search PostgreSQL connections
  const postgresConnections = connectionsStore.getConnectionsByType('postgres')
  for (const conn of postgresConnections) {
    const schema = collectSchemaForConnection('postgres', conn.id)
    for (const item of schema) {
      const tableMatches = item.tableName.toLowerCase().includes(query)
      const matchedColumns = item.columns
        .filter(col => col.name.toLowerCase().includes(query))
        .map(col => col.name)

      if (tableMatches || matchedColumns.length > 0) {
        const parts = item.tableName.split('.')
        const schemaName = parts.length === 2 ? parts[0] : 'public'

        results.push({
          connectionId: conn.id,
          connectionName: conn.name || conn.database || DATABASE_INFO.postgres.name,
          connectionType: 'postgres',
          tableName: item.tableName,
          displayName: item.tableName,
          matchedColumns,
          schemaName
        })
      }
    }
  }

  // Search Snowflake connections
  const snowflakeConnections = connectionsStore.getConnectionsByType('snowflake')
  for (const conn of snowflakeConnections) {
    const schema = collectSchemaForConnection('snowflake', conn.id)
    for (const item of schema) {
      const parts = item.tableName.split('.')
      if (parts.length !== 3) continue
      const [databaseName, schemaName, tableOnly] = parts

      const tableMatches = tableOnly.toLowerCase().includes(query) ||
                           item.tableName.toLowerCase().includes(query)
      const matchedColumns = item.columns
        .filter(col => col.name.toLowerCase().includes(query))
        .map(col => col.name)

      if (tableMatches || matchedColumns.length > 0) {
        results.push({
          connectionId: conn.id,
          connectionName: conn.name || conn.database || DATABASE_INFO.snowflake.name,
          connectionType: 'snowflake',
          tableName: item.tableName,
          displayName: `${schemaName}.${tableOnly}`,
          matchedColumns,
          databaseName,
          schemaName
        })
      }
    }
  }

  // Limit results and sort by table name match first, then column matches
  return results
    .sort((a, b) => {
      const aTableMatch = a.displayName.toLowerCase().includes(query) ? 1 : 0
      const bTableMatch = b.displayName.toLowerCase().includes(query) ? 1 : 0
      if (bTableMatch !== aTableMatch) return bTableMatch - aTableMatch
      return a.displayName.localeCompare(b.displayName)
    })
    .slice(0, 50)
})

// Group search results by connection
const groupedSearchResults = computed(() => {
  const groups: Record<string, { connectionName: string; connectionType: DatabaseEngine; results: SearchResult[] }> = {}

  for (const result of searchResults.value) {
    if (!groups[result.connectionId]) {
      groups[result.connectionId] = {
        connectionName: result.connectionName,
        connectionType: result.connectionType,
        results: []
      }
    }
    groups[result.connectionId].results.push(result)
  }

  return groups
})

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

// Navigate to a search result
const navigateToSearchResult = async (result: SearchResult) => {
  // Clear search
  searchQuery.value = ''

  if (result.connectionType === 'duckdb') {
    await selectProject('duckdb')
    await selectTable(result.tableName)
  } else if (result.connectionType === 'bigquery') {
    await selectProject(result.projectId!)
    await selectDataset(result.datasetId!)
    const tableOnly = result.tableName.split('.')[2]
    await selectTable(tableOnly)
  } else if (result.connectionType === 'postgres') {
    await selectProject(result.connectionId)
    await selectTable(result.tableName)
  } else if (result.connectionType === 'snowflake') {
    await selectProject(result.connectionId)
    await selectSnowflakeDatabase(result.databaseName!)
    await selectSnowflakeSchema(result.schemaName!)
    const tableOnly = result.tableName.split('.')[2]
    await selectTable(tableOnly)
  }

  // Select the first matched column if any
  if (result.matchedColumns.length > 0) {
    selectedColumn.value = result.matchedColumns[0]
  } else {
    selectedColumn.value = null
  }

  // Scroll selected items into view after DOM updates
  await nextTick()
  scrollSelectedIntoView()
}

// Clear search
const clearSearch = () => {
  searchQuery.value = ''
  searchInputRef.value?.focus()
}

// Highlight matching text in search results
const highlightMatch = (text: string, query: string): string => {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  return text.replace(regex, '<mark class="search-highlight">$1</mark>')
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
    tableName = `${selectedProject.value}.${selectedDataset.value}.${selectedTable.value}`
    quotedTableName = `\`${tableName}\``
    // Find a BigQuery connection to use
    const bigqueryConnections = connectionsStore.getConnectionsByType('bigquery')
    if (bigqueryConnections.length > 0) {
      connectionId = bigqueryConnections[0].id
    }
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
  // Clear any active search
  searchQuery.value = ''

  if (info.connectionType === 'duckdb') {
    // DuckDB doesn't have qualified names, but handle gracefully
    await selectProject('duckdb')
    // For DuckDB, tableName might be schema.table format, use last part
    const tableOnly = info.tableName.includes('.') ? info.tableName.split('.').pop()! : info.tableName
    await selectTable(tableOnly)
  } else if (info.connectionType === 'bigquery') {
    if (info.projectId) {
      await selectProject(info.projectId)
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
    :initial-name="initialName"
    :show-header-name="false"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <!-- Search Bar -->
    <div class="search-container">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="search-input"
        type="text"
        placeholder="Search tables and columns..."
        @keydown.escape="clearSearch"
      />
      <button v-if="searchQuery" class="clear-search-btn" @click="clearSearch">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <!-- Search Results Dropdown -->
      <div v-if="searchQuery && searchResults.length > 0" class="search-results" @wheel.stop>
        <template v-for="(group, connectionId) in groupedSearchResults" :key="connectionId">
          <div class="search-group-header">
            <span
              class="engine-badge"
              :style="{
                background: DATABASE_INFO[group.connectionType].color,
                color: DATABASE_INFO[group.connectionType].textColor
              }"
            >
              {{ DATABASE_INFO[group.connectionType].shortName }}
            </span>
            <span class="search-group-name">{{ group.connectionName }}</span>
          </div>
          <div
            v-for="result in group.results"
            :key="result.tableName"
            class="search-result-item"
            @click="navigateToSearchResult(result)"
          >
            <span class="search-result-table" v-html="highlightMatch(result.displayName, searchQuery)"></span>
            <span v-if="result.matchedColumns.length > 0" class="search-result-columns">
              <span v-html="highlightMatch(result.matchedColumns.slice(0, 3).join(', '), searchQuery)"></span>{{ result.matchedColumns.length > 3 ? '...' : '' }}
            </span>
          </div>
        </template>
      </div>

      <!-- No Results -->
      <div v-if="searchQuery && searchResults.length === 0" class="search-no-results">
        No tables or columns match "{{ searchQuery }}"
      </div>
    </div>

    <div ref="schemaBrowserRef" class="schema-browser">
      <!-- Column 1: Connections -->
      <div class="column" :style="{ width: `${col1Width}px` }">
        <div class="column-header">Connections</div>
        <div class="column-content">
          <div
            v-for="project in projects"
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
      <div class="resize-handle" @mousedown="handleResizeStart($event, 1)"></div>

      <!-- Column 2: Datasets (BigQuery), Databases (Snowflake), or Tables (DuckDB/PostgreSQL) -->
      <div v-if="selectedProject" class="column" :style="{ width: `${col2Width}px` }">
        <div class="column-header">
          {{ selectedProjectType === 'bigquery' ? 'Datasets' : selectedProjectType === 'snowflake' ? 'Databases' : 'Tables' }}
        </div>
        <div class="column-content">
          <div v-if="loadingDatasets[selectedProject] || loadingTables[selectedProject]" class="loading">Retrieving...</div>
          <div
            v-for="item in column2Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProjectType === 'bigquery' ? selectedDataset === item.id :
                        selectedProjectType === 'snowflake' ? selectedSnowflakeDatabase === item.id :
                        selectedTable === item.id
            }]"
            @click="selectedProjectType === 'bigquery' ? selectDataset(item.id) :
                    selectedProjectType === 'snowflake' ? selectSnowflakeDatabase(item.id) :
                    selectTable(item.id)"
            @dblclick="selectedProjectType !== 'bigquery' && selectedProjectType !== 'snowflake' ? insertTableName(item) : null"
            @mouseenter="hoveredTableItem = item.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProjectType !== 'bigquery' && selectedProjectType !== 'snowflake'"
              class="query-button"
              :class="{ visible: hoveredTableItem === item.id }"
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

      <!-- Column 3: BigQuery Tables or Snowflake Schemas -->
      <div v-if="(selectedDataset && selectedProjectType === 'bigquery') || (selectedSnowflakeDatabase && selectedProjectType === 'snowflake')" class="column" :style="{ width: `${col3Width}px` }">
        <div class="column-header">{{ selectedProjectType === 'snowflake' ? 'Schemas' : 'Tables' }}</div>
        <div class="column-content">
          <div v-if="selectedProjectType === 'bigquery' && selectedDataset && loadingTables[selectedDataset]" class="loading">Retrieving...</div>
          <div v-if="selectedProjectType === 'snowflake' && loadingTables[`${selectedProject}:${selectedSnowflakeDatabase}`]" class="loading">Retrieving...</div>
          <div
            v-for="item in column3Items"
            :key="item.id"
            :class="['item', {
              selected: selectedProjectType === 'snowflake' ? selectedSnowflakeSchema === item.id : selectedTable === item.id
            }]"
            @click="selectedProjectType === 'snowflake' ? selectSnowflakeSchema(item.id) : selectTable(item.id)"
            @dblclick="selectedProjectType !== 'snowflake' ? insertTableName(item) : null"
            @mouseenter="hoveredTableItem = item.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ item.name }}</span>
            <button
              v-if="selectedProjectType !== 'snowflake'"
              class="query-button"
              :class="{ visible: hoveredTableItem === item.id }"
              @click.stop="queryTable(item)"
              v-tooltip="'Query this table'"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 3 -->
      <div v-if="(selectedDataset && selectedProjectType === 'bigquery') || (selectedSnowflakeDatabase && selectedProjectType === 'snowflake')" class="resize-handle" @mousedown="handleResizeStart($event, 3)"></div>

      <!-- Column 4: Snowflake Tables (when schema is selected) -->
      <div v-if="selectedSnowflakeSchema && selectedProjectType === 'snowflake'" class="column" :style="{ width: `${col4Width}px` }">
        <div class="column-header">Tables</div>
        <div class="column-content">
          <div v-if="loadingTables[`${selectedProject}:${selectedSnowflakeDatabase}.${selectedSnowflakeSchema}`]" class="loading">Retrieving...</div>
          <div
            v-for="table in column4Items"
            :key="table.id"
            :class="['item', { selected: selectedTable === table.id }]"
            @click="selectTable(table.id)"
            @dblclick="insertTableName(table)"
            @mouseenter="hoveredTableItem = table.id"
            @mouseleave="hoveredTableItem = null"
          >
            <span class="item-name">{{ table.name }}</span>
            <button
              class="query-button"
              :class="{ visible: hoveredTableItem === table.id }"
              @click.stop="queryTable(table)"
              v-tooltip="'Query this table'"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <!-- Resize handle 4 (between Snowflake Tables and Columns) -->
      <div v-if="selectedSnowflakeSchema && selectedProjectType === 'snowflake'" class="resize-handle" @mousedown="handleResizeStart($event, 4)"></div>

      <!-- Column 4 (non-Snowflake) / Column 5 (Snowflake): Columns -->
      <div v-if="selectedTable" class="column column-schema">
        <div class="column-header">Columns</div>
        <div class="column-content">
          <div v-if="loadingSchema[selectedTable]" class="loading">Retrieving...</div>
          <div
            v-for="field in (selectedProjectType === 'snowflake' ? column5Items : column4Items)"
            :key="field.name"
            :class="['schema-field', { selected: selectedColumn === field.name }]"
            @click="selectedColumn = selectedColumn === field.name ? null : field.name"
            @mouseenter="hoveredField = field.name"
            @mouseleave="hoveredField = null"
          >
            <span class="field-info">
              <span class="field-name">{{ field.name }}</span>
              <button
                v-if="!isUnsupportedType(field.type)"
                class="analytics-btn"
                :class="{ visible: hoveredField === field.name }"
                @click.stop="handleShowAnalytics($event, field)"
                v-tooltip="'View column analytics'"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 20V10M12 20V4M6 20v-6"/>
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
/* Search Container */
.search-container {
  position: relative;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-secondary);
  border-bottom: var(--table-border-width) solid var(--border-primary);
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  padding-right: 32px;
  border: var(--border-width-thin) solid var(--border-secondary);
  background: var(--surface-primary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: var(--border-primary);
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.clear-search-btn {
  position: absolute;
  right: var(--space-4);
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-search-btn:hover {
  color: var(--text-primary);
}

/* Search Results Dropdown */
.search-results {
  position: absolute;
  top: 100%;
  left: var(--space-3);
  right: var(--space-3);
  max-height: 400px;
  overflow-y: auto;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  z-index: 100;
}

.search-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-secondary);
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
}

.search-group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: background 0.1s;
}

.search-result-item:hover {
  background: var(--table-row-hover-bg);
}

.search-result-table {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
}

.search-result-columns {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.search-result-columns::before {
  content: 'Columns: ';
  color: var(--text-tertiary);
}

:deep(.search-highlight) {
  background: var(--color-warning-bg, #fef3c7);
  color: var(--text-primary);
  border-radius: 2px;
  padding: 0 1px;
}

.search-no-results {
  position: absolute;
  top: 100%;
  left: var(--space-3);
  right: var(--space-3);
  padding: var(--space-3);
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-size-body-sm);
  z-index: 100;
}

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
  border-radius: 3px;
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

/* Analytics button in schema fields */
.field-info .analytics-btn {
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
  transition: opacity 0.1s ease;
}

.field-info .analytics-btn svg {
  width: 10px;
  height: 10px;
}

.field-info .analytics-btn.visible {
  opacity: 1;
}

.field-info .analytics-btn:hover {
  color: var(--text-primary);
}
</style>
