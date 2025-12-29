import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { loadCsvWithDuckDB } from '../services/csvHandler'

interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
}

interface QueryResult {
  rows: Record<string, any>[]
  stats: {
    executionTimeMs: number
    rowCount: number
    engine: 'duckdb'
  }
}

export const useDuckDBStore = defineStore('duckdb', () => {
  // DuckDB instances
  const db = ref<AsyncDuckDB | null>(null)
  const conn = ref<AsyncDuckDBConnection | null>(null)
  const isInitialized = ref(false)
  const isInitializing = ref(false)
  const initError = ref<string | null>(null)

  // Track available tables (table name -> metadata)
  const tables = ref<Record<string, TableMetadata>>({})

  // Reactive trigger for table schema changes
  const schemaVersion = ref(0)

  // Initialize DuckDB with IndexedDB persistence
  const initialize = async () => {
    if (isInitialized.value || isInitializing.value) return

    isInitializing.value = true
    initError.value = null

    try {
      // Use manual bundle resolution to work with Vite
      const MANUAL_BUNDLES = {
        mvp: {
          mainModule: new URL('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm', import.meta.url).href,
          mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).href,
        },
        eh: {
          mainModule: new URL('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', import.meta.url).href,
          mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).href,
        },
      }

      // Select bundle (prefer eh for better performance)
      const bundle = MANUAL_BUNDLES.eh

      // Create worker
      const worker = new Worker(bundle.mainWorker, { type: 'module' })
      const logger = new duckdb.ConsoleLogger()

      // Initialize database
      db.value = new duckdb.AsyncDuckDB(logger, worker)
      await db.value.instantiate(bundle.mainModule)

      // Create connection
      conn.value = await db.value.connect()

      // Load existing tables metadata
      await loadTablesMetadata()

      isInitialized.value = true
      console.log('DuckDB initialized successfully')
    } catch (err: any) {
      console.error('DuckDB initialization failed:', err)
      initError.value = err.message
      throw err
    } finally {
      isInitializing.value = false
    }
  }

  // Load metadata about existing tables
  const loadTablesMetadata = async () => {
    if (!conn.value) return

    try {
      const result = await conn.value.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
      `)

      const tableList = result.toArray()

      // Load row count for each table
      for (const row of tableList) {
        const tableName = row.table_name as string
        try {
          const countResult = await conn.value.query(`SELECT COUNT(*) as count FROM ${tableName}`)
          const countData = countResult.toArray()
          const rowCount = countData[0]?.count || 0

          // Merge with existing metadata to preserve boxId and originalBoxName
          tables.value[tableName] = {
            ...(tables.value[tableName] || {}), // Preserve existing metadata
            rowCount: Number(rowCount),
            lastUpdated: Date.now()
          }
        } catch (err) {
          console.warn(`Failed to get row count for ${tableName}:`, err)
        }
      }

    } catch (err) {
      console.warn('Failed to load tables metadata:', err)
    }
  }

  // Sanitize box name for use as table name
  const sanitizeTableName = (boxName: string): string => {
    return boxName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  }

  // Infer DuckDB type from JavaScript value
  const inferDuckDBType = (value: any): string => {
    if (value === null || value === undefined) return 'VARCHAR'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE'
    }
    if (typeof value === 'boolean') return 'BOOLEAN'
    if (value instanceof Date) return 'TIMESTAMP'
    // Check for date/timestamp strings
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return 'TIMESTAMP'
    }
    return 'VARCHAR'
  }

  // Format value for SQL INSERT
  const formatValueForSQL = (value: any): string | number | boolean => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    // Escape single quotes and wrap in quotes
    return `'${String(value).replace(/'/g, "''")}'`
  }

  // Store BigQuery results as DuckDB table
  const storeResults = async (boxName: string, results: Record<string, any>[], boxId: number | null = null): Promise<string | null> => {
    if (!isInitialized.value) {
      await initialize()
    }

    if (!results || results.length === 0) {
      console.log('No results to store')
      return null
    }

    const tableName = sanitizeTableName(boxName)

    try {
      // Drop existing table if exists
      await conn.value!.query(`DROP TABLE IF EXISTS ${tableName}`)

      // Infer schema from first row
      const columns = Object.keys(results[0])
      const columnDefs = columns.map(col => {
        const sampleValue = results[0][col]
        const type = inferDuckDBType(sampleValue)
        return `"${col}" ${type}`
      }).join(', ')

      // Create table
      await conn.value!.query(`CREATE TABLE ${tableName} (${columnDefs})`)

      // Insert data in batches
      const BATCH_SIZE = 1000
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE)
        const values = batch.map(row => {
          const vals = columns.map(col => formatValueForSQL(row[col])).join(', ')
          return `(${vals})`
        }).join(', ')

        await conn.value!.query(`INSERT INTO ${tableName} VALUES ${values}`)
      }

      // Update metadata
      tables.value[tableName] = {
        rowCount: results.length,
        columns: columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId: boxId // Store box ID for dependency tracking
      }

      return tableName
    } catch (err: any) {
      console.error(`Failed to store results for ${boxName}:`, err)
      throw new Error(`Failed to store results in DuckDB: ${err.message}`)
    }
  }

  // Execute DuckDB query
  const runQuery = async (query: string): Promise<QueryResult> => {
    if (!isInitialized.value) {
      await initialize()
    }

    // Refresh table metadata before executing to ensure we have the latest
    await loadTablesMetadata()

    const startTime = performance.now()

    try {
      const result = await conn.value!.query(query)
      const endTime = performance.now()

      // Convert Arrow result to array of objects
      const rows = result.toArray().map(row => {
        const obj: Record<string, any> = {}
        result.schema.fields.forEach((field) => {
          obj[field.name] = row[field.name]
        })
        return obj
      })

      return {
        rows,
        stats: {
          executionTimeMs: Math.round(endTime - startTime),
          rowCount: rows.length,
          engine: 'duckdb'
        }
      }
    } catch (err: any) {
      console.error('DuckDB query failed:', err)
      throw new Error(`DuckDB query failed: ${err.message}`)
    }
  }

  // Check if table exists
  const tableExists = (tableName: string): boolean => {
    return tableName in tables.value
  }

  // Get list of all table names
  const getTableNames = computed(() => Object.keys(tables.value))

  // Get fresh table names by reloading from database
  const getFreshTableNames = async (): Promise<string[]> => {
    if (!isInitialized.value) {
      return []
    }
    await loadTablesMetadata()
    return Object.keys(tables.value)
  }

  // Get the original box name for a table
  const getTableBoxName = (tableName: string): string | null => {
    const tableInfo = tables.value[tableName]
    return tableInfo?.originalBoxName || null
  }

  // Get the box ID for a table
  const getTableBoxId = (tableName: string): number | null => {
    const tableInfo = tables.value[tableName]
    return tableInfo?.boxId || null
  }

  // Update the boxId association for a table
  const updateTableBoxId = (tableName: string, boxId: number | null) => {
    if (tables.value[tableName]) {
      tables.value[tableName].boxId = boxId
    }
  }

  // Rename a table (dependencies will break and need manual update)
  const renameTable = async (oldName: string, newName: string) => {
    const oldTableName = sanitizeTableName(oldName)
    const newTableName = sanitizeTableName(newName)

    // If names are the same after sanitization, nothing to do
    if (oldTableName === newTableName) return

    if (!isInitialized.value) {
      await initialize()
    }

    try {
      // Check if old table exists
      if (!tables.value[oldTableName]) {
        console.log(`Table ${oldTableName} does not exist yet, nothing to rename`)
        return
      }

      // Use ALTER TABLE to rename
      await conn.value!.query(`ALTER TABLE ${oldTableName} RENAME TO ${newTableName}`)

      // Update metadata
      tables.value[newTableName] = {
        ...tables.value[oldTableName],
        originalBoxName: newName
      }
      delete tables.value[oldTableName]

      // Increment schema version to trigger dependency recalculation
      schemaVersion.value++

      console.log(`✅ Renamed DuckDB table: ${oldTableName} -> ${newTableName}`)
      console.log(`⚠️  Dependent queries may need manual updates`)
    } catch (err: any) {
      console.error(`Failed to rename table from ${oldTableName} to ${newTableName}:`, err)
      throw new Error(`Failed to rename table: ${err.message}`)
    }
  }

  // Load CSV file into DuckDB
  const loadCsvFile = async (
    file: File,
    boxId: number | null = null
  ): Promise<string | null> => {
    if (!isInitialized.value) {
      await initialize()
    }

    try {
      // Load CSV using DuckDB's native file loading
      const result = await loadCsvWithDuckDB(
        file,
        db.value! as any,
        conn.value! as any,
        tables.value
      )

      // Update metadata store (table already created by DuckDB)
      tables.value[result.tableName] = {
        rowCount: result.rowCount,
        columns: result.columns,
        lastUpdated: Date.now(),
        originalBoxName: result.originalFileName,
        boxId: boxId
      }

      // Trigger reactive updates
      schemaVersion.value++

      console.log(`✅ Loaded CSV as table: ${result.tableName} (${result.rowCount} rows)`)

      return result.tableName
    } catch (err: any) {
      console.error(`Failed to load CSV ${file.name}:`, err)
      throw new Error(`Failed to load CSV: ${err.message}`)
    }
  }

  return {
    isInitialized,
    isInitializing,
    initError,
    tables,
    schemaVersion,
    getTableNames,
    getFreshTableNames,
    getTableBoxName,
    getTableBoxId,
    updateTableBoxId,
    initialize,
    storeResults,
    runQuery,
    tableExists,
    sanitizeTableName,
    loadTablesMetadata,
    renameTable,
    loadCsvFile
  }
})
