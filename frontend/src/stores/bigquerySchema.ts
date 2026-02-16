import { ref } from 'vue'
import { defineStore } from 'pinia'
import { loadSchema, saveSchema, clearSchemas as clearSchemasDB } from '../utils/storage'

type ColumnInfo = { name: string; type: string }

// BigQuery schema structure
export interface BigQuerySchema {
  project: string
  dataset: string
  table: string
  columns: ColumnInfo[]
}

export const useSchemaStore = defineStore('schema', () => {
  // Store BigQuery schemas by fully qualified table name
  // Key format: "project.dataset.table"
  const bigQuerySchemas = ref<Record<string, ColumnInfo[]>>({})

  // Schema version for reactive updates
  const schemaVersion = ref(0)

  const loadState = async () => {
    try {
      const data = await loadSchema<Record<string, ColumnInfo[]>>('bigQuerySchemas')
      if (data) {
        bigQuerySchemas.value = data
      }
    } catch (error) {
      console.error('Failed to load schema state:', error)
    }
  }

  const saveState = () => {
    saveSchema('bigQuerySchemas', bigQuerySchemas.value).catch(error => {
      console.error('Failed to save schema state:', error)
    })
  }

  const ready = loadState()

  // Add or update a table schema
  const setTableSchema = (project: string, dataset: string, table: string, columns: ColumnInfo[]) => {
    const key = `${project}.${dataset}.${table}`
    bigQuerySchemas.value[key] = columns
    schemaVersion.value++
    saveState()
  }

  // Bulk-set many table schemas at once (single save + single reactive update)
  const bulkSetTableSchemas = (entries: Array<{ project: string; dataset: string; table: string; columns: ColumnInfo[] }>) => {
    for (const entry of entries) {
      const key = `${entry.project}.${entry.dataset}.${entry.table}`
      bigQuerySchemas.value[key] = entry.columns
    }
    schemaVersion.value++
    saveState()
  }

  // Remove a table schema
  const removeTableSchema = (project: string, dataset: string, table: string) => {
    const key = `${project}.${dataset}.${table}`
    delete bigQuerySchemas.value[key]
    schemaVersion.value++
    saveState()
  }

  // Clear schemas for a specific project only
  const clearProjectSchemas = (project: string) => {
    const prefix = `${project}.`
    let changed = false
    for (const key of Object.keys(bigQuerySchemas.value)) {
      if (key.startsWith(prefix)) {
        delete bigQuerySchemas.value[key]
        changed = true
      }
    }
    if (changed) {
      schemaVersion.value++
      saveState()
    }
  }

  // Atomically replace all schemas for a project (clear old + write new in one update)
  const replaceProjectSchemas = (project: string, entries: Array<{ project: string; dataset: string; table: string; columns: ColumnInfo[] }>) => {
    const prefix = `${project}.`
    for (const key of Object.keys(bigQuerySchemas.value)) {
      if (key.startsWith(prefix)) {
        delete bigQuerySchemas.value[key]
      }
    }
    for (const entry of entries) {
      const key = `${entry.project}.${entry.dataset}.${entry.table}`
      bigQuerySchemas.value[key] = entry.columns
    }
    schemaVersion.value++
    saveState()
  }

  // Clear all schemas
  const clearSchemas = () => {
    bigQuerySchemas.value = {}
    schemaVersion.value++
    clearSchemasDB().catch(error => {
      console.error('Failed to clear schema state:', error)
    })
  }

  // Get all table names for a project.dataset
  const getTablesForDataset = (project: string, dataset: string): string[] => {
    const prefix = `${project}.${dataset}.`
    return Object.keys(bigQuerySchemas.value)
      .filter(key => key.startsWith(prefix))
      .map(key => key.split('.')[2])
  }

  return {
    bigQuerySchemas,
    schemaVersion,
    ready,
    setTableSchema,
    bulkSetTableSchemas,
    replaceProjectSchemas,
    removeTableSchema,
    clearProjectSchemas,
    clearSchemas,
    getTablesForDataset
  }
})
