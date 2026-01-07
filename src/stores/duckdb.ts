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

// Convert DuckDB/Arrow values to JSON-serializable types
const serializeDuckDBValue = (value: any): any => {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(serializeDuckDBValue)
  if (typeof value === 'object' && value !== null) {
    // Handle plain objects (structs, maps)
    const result: Record<string, any> = {}
    for (const key of Object.keys(value)) {
      result[key] = serializeDuckDBValue(value[key])
    }
    return result
  }
  return value
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

  // Execute DuckDB query and store results as a table using CTAS
  // This is more efficient than runQuery + storeResults as it avoids
  // converting Arrow to JS objects and back to SQL INSERT statements
  const runQueryWithStorage = async (
    query: string,
    boxName: string,
    boxId: number | null = null
  ): Promise<QueryResult> => {
    if (!isInitialized.value) {
      await initialize()
    }

    await loadTablesMetadata()

    const tableName = sanitizeTableName(boxName)
    const startTime = performance.now()

    try {
      // Use CREATE OR REPLACE TABLE AS to store results directly
      // This avoids the Arrow → JS → SQL INSERT roundtrip
      await conn.value!.query(`CREATE OR REPLACE TABLE ${tableName} AS (${query})`)

      // Now select from the created table to get results for display
      const result = await conn.value!.query(`SELECT * FROM ${tableName}`)
      const endTime = performance.now()

      // Convert Arrow result to array of objects for display
      const rows = result.toArray().map(row => {
        const obj: Record<string, any> = {}
        result.schema.fields.forEach((field) => {
          obj[field.name] = serializeDuckDBValue(row[field.name])
        })
        return obj
      })

      // Update metadata
      const columns = result.schema.fields.map(f => f.name)
      tables.value[tableName] = {
        rowCount: rows.length,
        columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId
      }

      return {
        rows,
        stats: {
          executionTimeMs: Math.round(endTime - startTime),
          rowCount: rows.length,
          engine: 'duckdb'
        }
      }
    } catch (err: any) {
      console.error('DuckDB query with storage failed:', err)
      throw new Error(`DuckDB query failed: ${err.message}`)
    }
  }

  // Check if table exists
  const tableExists = (tableName: string): boolean => {
    return tableName in tables.value
  }

  // Query a page of data from a table with optional sorting
  // Used for efficient pagination without loading all data into JS
  const queryTablePage = async (
    tableName: string,
    page: number,
    pageSize: number,
    sortColumn?: string | null,
    sortDirection?: 'asc' | 'desc'
  ): Promise<{ rows: Record<string, any>[], columns: string[] }> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const offset = (page - 1) * pageSize

    // Build query with optional sorting
    let query = `SELECT * FROM ${tableName}`
    if (sortColumn) {
      const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
      // Quote column name to handle special characters
      query += ` ORDER BY "${sortColumn}" ${direction}`
    }
    query += ` LIMIT ${pageSize} OFFSET ${offset}`

    try {
      const result = await conn.value!.query(query)
      const columns = result.schema.fields.map(f => f.name)
      const rows = result.toArray().map(row => {
        const obj: Record<string, any> = {}
        columns.forEach(col => {
          obj[col] = serializeDuckDBValue(row[col])
        })
        return obj
      })

      return { rows, columns }
    } catch (err: any) {
      console.error('DuckDB page query failed:', err)
      throw new Error(`Failed to query table page: ${err.message}`)
    }
  }

  // Get column names for a table
  const getTableColumns = async (tableName: string): Promise<string[]> => {
    if (!isInitialized.value) {
      await initialize()
    }

    try {
      // Query with LIMIT 0 to get schema without data
      const result = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      return result.schema.fields.map(f => f.name)
    } catch (err: any) {
      console.error('Failed to get table columns:', err)
      throw new Error(`Failed to get columns for ${tableName}: ${err.message}`)
    }
  }

  // Get total row count for a table
  const getTableRowCount = async (tableName: string): Promise<number> => {
    if (!isInitialized.value) {
      await initialize()
    }

    // First check metadata cache
    const metadata = tables.value[tableName]
    if (metadata?.rowCount !== undefined) {
      return metadata.rowCount
    }

    // Fallback to COUNT(*) query
    try {
      const result = await conn.value!.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      const rows = result.toArray()
      return Number(rows[0]?.count || 0)
    } catch (err: any) {
      console.error('Failed to get row count:', err)
      return 0
    }
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

  // Export a table to various formats using DuckDB's native COPY command
  type ExportFormat = 'csv' | 'json' | 'parquet' | 'xlsx'

  const exportTable = async (
    tableName: string,
    format: ExportFormat,
    _filename: string,
    sortColumn?: string | null,
    sortDirection?: 'asc' | 'desc'
  ): Promise<Blob> => {
    if (!isInitialized.value) {
      await initialize()
    }

    // Build query with optional sorting
    let selectQuery = `SELECT * FROM ${tableName}`
    if (sortColumn) {
      const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
      selectQuery += ` ORDER BY "${sortColumn}" ${direction}`
    }

    // Generate temp filename for DuckDB's virtual filesystem
    const tempFile = `_export_${Date.now()}.${format}`

    try {
      // Build COPY command based on format
      let copyCommand: string
      switch (format) {
        case 'csv':
          copyCommand = `COPY (${selectQuery}) TO '${tempFile}' (FORMAT CSV, HEADER true)`
          break
        case 'json':
          copyCommand = `COPY (${selectQuery}) TO '${tempFile}' (FORMAT JSON, ARRAY true)`
          break
        case 'parquet':
          copyCommand = `COPY (${selectQuery}) TO '${tempFile}' (FORMAT PARQUET, COMPRESSION zstd)`
          break
        case 'xlsx':
          copyCommand = `COPY (${selectQuery}) TO '${tempFile}' (FORMAT XLSX, HEADER true)`
          break
        default:
          throw new Error(`Unsupported export format: ${format}`)
      }

      // Execute COPY command
      await conn.value!.query(copyCommand)

      // Get the file buffer from DuckDB's virtual filesystem
      const buffer = await db.value!.copyFileToBuffer(tempFile)

      // Clean up temp file
      await db.value!.dropFile(tempFile)

      // Create blob with appropriate MIME type
      const mimeTypes: Record<ExportFormat, string> = {
        csv: 'text/csv;charset=utf-8',
        json: 'application/json;charset=utf-8',
        parquet: 'application/vnd.apache.parquet',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }

      // Create a new Uint8Array copy to ensure ArrayBuffer compatibility
      const arrayBuffer = new Uint8Array(buffer).buffer as ArrayBuffer
      return new Blob([arrayBuffer], { type: mimeTypes[format] })
    } catch (err: any) {
      // Try to clean up temp file on error
      try {
        await db.value!.dropFile(tempFile)
      } catch {
        // Ignore cleanup errors
      }
      console.error(`Failed to export table as ${format}:`, err)
      throw new Error(`Failed to export as ${format.toUpperCase()}: ${err.message}`)
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
    runQueryWithStorage,
    queryTablePage,
    getTableColumns,
    getTableRowCount,
    tableExists,
    sanitizeTableName,
    loadTablesMetadata,
    renameTable,
    loadCsvFile,
    exportTable
  }
})
