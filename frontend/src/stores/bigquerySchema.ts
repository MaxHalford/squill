import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { SchemaStateSchema } from '../utils/storageSchemas'

const STORAGE_KEY = 'squill-schemas'

// BigQuery schema structure
export interface BigQuerySchema {
  project: string
  dataset: string
  table: string
  columns: Array<{ name: string; type: string }>
}

interface SchemaState {
  bigQuerySchemas: Record<string, Array<{ name: string; type: string }>>
}

export const useSchemaStore = defineStore('schema', () => {
  // Store BigQuery schemas by fully qualified table name
  // Key format: "project.dataset.table"
  const bigQuerySchemas = ref<Record<string, Array<{ name: string; type: string }>>>({})

  // Schema version for reactive updates
  const schemaVersion = ref(0)

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return

      const parsed = JSON.parse(saved)
      const result = SchemaStateSchema.safeParse(parsed)

      if (result.success) {
        bigQuerySchemas.value = result.data.bigQuerySchemas
      } else {
        console.warn('Invalid schema cache, clearing:', result.error.issues)
        bigQuerySchemas.value = {}
      }
    } catch (error) {
      console.error('Failed to load schema state:', error)
    }
  }

  // Save state to localStorage
  const saveState = () => {
    try {
      const state: SchemaState = {
        bigQuerySchemas: bigQuerySchemas.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save schema state:', error)
    }
  }

  // Load initial state
  loadState()

  // Watch for changes and auto-save
  watch(bigQuerySchemas, () => {
    saveState()
  }, { deep: true })

  // Add or update a table schema
  const setTableSchema = (project: string, dataset: string, table: string, columns: Array<{ name: string; type: string }>) => {
    const key = `${project}.${dataset}.${table}`
    bigQuerySchemas.value[key] = columns
    schemaVersion.value++
  }

  // Remove a table schema
  const removeTableSchema = (project: string, dataset: string, table: string) => {
    const key = `${project}.${dataset}.${table}`
    delete bigQuerySchemas.value[key]
    schemaVersion.value++
  }

  // Clear all schemas
  const clearSchemas = () => {
    bigQuerySchemas.value = {}
    schemaVersion.value++
  }

  // Get all table names for a project.dataset
  const getTablesForDataset = (project: string, dataset: string): string[] => {
    const prefix = `${project}.${dataset}.`
    return Object.keys(bigQuerySchemas.value)
      .filter(key => key.startsWith(prefix))
      .map(key => key.split('.')[2]) // Extract table name
  }

  return {
    bigQuerySchemas,
    schemaVersion,
    setTableSchema,
    removeTableSchema,
    clearSchemas,
    getTablesForDataset
  }
})
