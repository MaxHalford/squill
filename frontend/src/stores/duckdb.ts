import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { loadCsvWithDuckDB } from '../services/csvHandler'
import { sanitizeTableName } from '../utils/sqlSanitize'
import { mapBigQueryTypeToDuckDB } from '../utils/bigqueryConversion'
import type { DatabaseEngine } from '../types/database'

interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
}

// JSON-serializable value type for query results
type SerializableValue = string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue }

interface QueryResult {
  rows: Record<string, SerializableValue>[]
  stats: {
    executionTimeMs: number
    rowCount: number
    engine: 'duckdb'
  }
  columns?: string[]
  columnTypes?: Record<string, string>
}

// Schema field type from remote databases (BigQuery, etc.)
export interface ColumnSchema {
  name: string
  type: string
}

// Extract error message from unknown error type
const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unknown error'
}

// Convert DuckDB/Arrow values to JSON-serializable types
// Arrow types implement toJSON(), so we leverage JSON.stringify/parse for clean conversion
const serializeDuckDBValue = (value: unknown): SerializableValue => {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value) // BigInt not supported by JSON
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  // Use JSON round-trip to leverage Arrow's built-in toJSON() methods
  // This handles Structs, Lists, Maps, Dates, etc. correctly
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

export const useDuckDBStore = defineStore('duckdb', () => {
  // DuckDB instances
  const db = ref<AsyncDuckDB | null>(null)
  const conn = ref<AsyncDuckDBConnection | null>(null)
  const isInitialized = ref(false)
  const isInitializing = ref(false)
  const initError = ref<string | null>(null)

  // Track initialization promise for concurrent callers to await
  let initPromise: Promise<void> | null = null

  // Track available tables (table name -> metadata)
  const tables = ref<Record<string, TableMetadata>>({})

  // Reactive trigger for table schema changes
  const schemaVersion = ref(0)

  // Initialize DuckDB with IndexedDB persistence
  const initialize = async (): Promise<void> => {
    // Already initialized
    if (isInitialized.value) return

    // Initialization in progress - return existing promise so callers can await it
    if (initPromise) return initPromise

    // Start initialization
    initPromise = (async () => {
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
      } catch (err: unknown) {
        console.error('DuckDB initialization failed:', err)
        initError.value = getErrorMessage(err)
        // Reset promise on failure so retry is possible
        initPromise = null
        throw err
      } finally {
        isInitializing.value = false
      }
    })()

    return initPromise
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

  // Store query results as DuckDB table using JSON import
  // For BigQuery: applies explicit type casts since BigQuery REST API returns strings
  // For other engines: lets DuckDB infer types (they return properly typed data)
  const storeResults = async (
    boxName: string,
    results: Record<string, unknown>[],
    boxId: number | null = null,
    schema?: ColumnSchema[],
    sourceEngine?: DatabaseEngine
  ): Promise<string | null> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const tableName = sanitizeTableName(boxName)

    // Handle empty results: create an empty table with schema if available
    if (!results || results.length === 0) {
      try {
        await conn.value!.query(`DROP TABLE IF EXISTS ${tableName}`)

        if (schema && schema.length > 0) {
          // Create empty table with proper column types from schema
          const columnDefs = schema.map(col => {
            const duckdbType = sourceEngine === 'bigquery'
              ? mapBigQueryTypeToDuckDB(col.type)
              : 'VARCHAR'
            return `"${col.name}" ${duckdbType}`
          }).join(', ')
          await conn.value!.query(`CREATE TABLE ${tableName} (${columnDefs})`)
        } else {
          // No schema available - create a minimal empty table
          await conn.value!.query(`CREATE TABLE ${tableName} (_empty VARCHAR)`)
        }

        tables.value[tableName] = {
          rowCount: 0,
          columns: schema?.map(c => c.name) || [],
          lastUpdated: Date.now(),
          originalBoxName: boxName,
          boxId: boxId
        }

        return tableName
      } catch (err: unknown) {
        console.error(`Failed to create empty table for ${boxName}:`, err)
        throw new Error(`Failed to store results in DuckDB: ${getErrorMessage(err)}`)
      }
    }

    const jsonFileName = `${tableName}.json`
    // Preserve original column order from the first result row
    const columns = Object.keys(results[0])

    try {
      // Drop existing table if exists
      await conn.value!.query(`DROP TABLE IF EXISTS ${tableName}`)

      // Register JSON data
      await db.value!.registerFileText(jsonFileName, JSON.stringify(results))

      // BigQuery-specific: apply explicit type casts
      // BigQuery REST API returns all values as strings, so we need to cast
      // timestamps, dates, etc. to proper types for DuckDB
      if (sourceEngine === 'bigquery' && schema && schema.length > 0) {
        const schemaMap = new Map(schema.map(s => [s.name, s.type]))

        // Build column definitions with BigQuery-specific type casts
        const columnDefs = columns.map(col => {
          const sourceType = schemaMap.get(col)
          const duckdbType = sourceType ? mapBigQueryTypeToDuckDB(sourceType) : 'VARCHAR'
          // Cast JSON string values to proper DuckDB types
          if (duckdbType === 'TIMESTAMP') {
            return `"${col}"::TIMESTAMP AS "${col}"`
          } else if (duckdbType === 'DATE') {
            return `"${col}"::DATE AS "${col}"`
          } else if (duckdbType === 'TIME') {
            return `"${col}"::TIME AS "${col}"`
          } else if (duckdbType === 'JSON') {
            return `to_json("${col}") AS "${col}"`
          }
          return `"${col}"`
        }).join(', ')

        await conn.value!.query(
          `CREATE TABLE ${tableName} AS SELECT ${columnDefs} FROM read_json_auto('${jsonFileName}')`
        )
      } else {
        // Other engines (Postgres, Snowflake, etc.): let DuckDB infer types
        // These databases return properly typed JSON that DuckDB can handle
        const columnList = columns.map(c => `"${c}"`).join(', ')
        await conn.value!.query(
          `CREATE TABLE ${tableName} AS SELECT ${columnList} FROM read_json_auto('${jsonFileName}')`
        )
      }

      await db.value!.dropFile(jsonFileName)

      // Update metadata
      tables.value[tableName] = {
        rowCount: results.length,
        columns: columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId: boxId
      }

      return tableName
    } catch (err: unknown) {
      console.error(`Failed to store results for ${boxName}:`, err)
      throw new Error(`Failed to store results in DuckDB: ${getErrorMessage(err)}`)
    }
  }

  // Append rows to an existing table (for pagination)
  // Uses JSON import with INSERT INTO ... SELECT for simplicity
  const appendResults = async (
    tableName: string,
    rows: Record<string, unknown>[],
    _schema?: ColumnSchema[]  // Kept for API compatibility, but not used
  ): Promise<number> => {
    if (!isInitialized.value) {
      await initialize()
    }

    if (!rows || rows.length === 0) {
      return 0
    }

    const tempJsonFile = `_temp_append_${tableName}.json`

    try {
      // Register JSON and insert via temp table to match existing schema
      await db.value!.registerFileText(tempJsonFile, JSON.stringify(rows))
      await conn.value!.query(`INSERT INTO ${tableName} SELECT * FROM read_json_auto('${tempJsonFile}')`)
      await db.value!.dropFile(tempJsonFile)

      // Update metadata with new row count
      const countResult = await conn.value!.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      const countData = countResult.toArray()
      const newRowCount = Number(countData[0]?.count || 0)

      if (tables.value[tableName]) {
        tables.value[tableName].rowCount = newRowCount
        tables.value[tableName].lastUpdated = Date.now()
      }

      return rows.length
    } catch (err: unknown) {
      console.error(`Failed to append results to ${tableName}:`, err)
      throw new Error(`Failed to append results to DuckDB: ${getErrorMessage(err)}`)
    }
  }

  // Store results from Arrow IPC stream (optimized for large datasets)
  // This is much faster than storeResults() for large result sets as it
  // avoids JSON parsing and SQL INSERT statements
  const storeResultsFromArrow = async (
    boxName: string,
    arrowStream: ReadableStream<Uint8Array>,
    boxId: number | null = null
  ): Promise<{ tableName: string; rowCount: number; columns: string[] }> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const tableName = sanitizeTableName(boxName)
    const startTime = performance.now()

    try {
      // Drop existing table if exists
      await conn.value!.query(`DROP TABLE IF EXISTS ${tableName}`)

      // Read Arrow IPC stream and insert into DuckDB
      const reader = arrowStream.getReader()
      let isFirstChunk = true

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        if (value && value.length > 0) {
          // insertArrowFromIPCStream handles schema on first chunk
          // and appends data on subsequent chunks
          await conn.value!.insertArrowFromIPCStream(value, {
            name: tableName,
            create: isFirstChunk,
          })
          isFirstChunk = false
        }
      }

      // Get table metadata after insertion
      const countResult = await conn.value!.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      const countData = countResult.toArray()
      const rowCount = Number(countData[0]?.count || 0)

      // Get column names from schema
      const schemaResult = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      const columns = schemaResult.schema.fields.map(f => f.name)

      const endTime = performance.now()
      console.log(`Arrow ingestion completed in ${Math.round(endTime - startTime)}ms: ${rowCount} rows`)

      // Update metadata
      tables.value[tableName] = {
        rowCount,
        columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId
      }

      // Trigger reactive updates
      schemaVersion.value++

      return { tableName, rowCount, columns }
    } catch (err: unknown) {
      console.error(`Failed to store Arrow results for ${boxName}:`, err)
      throw new Error(`Failed to store Arrow results in DuckDB: ${getErrorMessage(err)}`)
    }
  }

  // Execute DuckDB query and store results as a table using CTAS
  // Returns only metadata - data stays in DuckDB and is fetched page-by-page
  // by ResultsTable via queryTablePage() for optimal memory usage
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
      // Use CREATE OR REPLACE TABLE AS to store results directly in DuckDB
      await conn.value!.query(`CREATE OR REPLACE TABLE ${tableName} AS (${query})`)

      const endTime = performance.now()

      // Get row count without transferring data
      const countResult = await conn.value!.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      const countData = countResult.toArray()
      const rowCount = Number(countData[0]?.count || 0)

      // Get schema (columns + types) without fetching any data
      const schemaResult = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      const columns = schemaResult.schema.fields.map(f => f.name)
      const columnTypes: Record<string, string> = {}
      schemaResult.schema.fields.forEach(f => {
        columnTypes[f.name] = f.type.toString()
      })

      // Update metadata
      tables.value[tableName] = {
        rowCount,
        columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId
      }

      // Trigger reactive updates for dependent components
      schemaVersion.value++

      // Return empty rows - ResultsTable will fetch via queryTablePage()
      return {
        rows: [],
        stats: {
          executionTimeMs: Math.round(endTime - startTime),
          rowCount,
          engine: 'duckdb'
        },
        columns,
        columnTypes
      }
    } catch (err: unknown) {
      console.error('DuckDB query with storage failed:', err)
      throw new Error(`DuckDB query failed: ${getErrorMessage(err)}`)
    }
  }

  // Run a query without storing results (for analytics, etc.)
  const runQuery = async (query: string): Promise<QueryResult> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const startTime = performance.now()

    try {
      const result = await conn.value!.query(query)
      const endTime = performance.now()

      // Convert Arrow result to array of objects
      const rows = result.toArray().map(row => {
        const obj: Record<string, SerializableValue> = {}
        result.schema.fields.forEach((field) => {
          obj[field.name] = serializeDuckDBValue(row[field.name])
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
    } catch (err: unknown) {
      console.error('DuckDB query failed:', err)
      throw new Error(`DuckDB query failed: ${getErrorMessage(err)}`)
    }
  }

  // Check if table exists
  const tableExists = (tableName: string): boolean => {
    return tableName in tables.value
  }

  // Query a page of data from a table
  // Used for efficient pagination without loading all data into JS
  const queryTablePage = async (
    tableName: string,
    page: number,
    pageSize: number
  ): Promise<{ rows: Record<string, SerializableValue>[], columns: string[], columnTypes: Record<string, string> }> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const offset = (page - 1) * pageSize
    const query = `SELECT * FROM ${tableName} LIMIT ${pageSize} OFFSET ${offset}`

    try {
      const result = await conn.value!.query(query)
      const columns = result.schema.fields.map(f => f.name)
      const columnTypes: Record<string, string> = {}
      result.schema.fields.forEach(f => {
        columnTypes[f.name] = f.type.toString()
      })
      const rows = result.toArray().map(row => {
        const obj: Record<string, SerializableValue> = {}
        columns.forEach(col => {
          obj[col] = serializeDuckDBValue(row[col])
        })
        return obj
      })

      return { rows, columns, columnTypes }
    } catch (err: unknown) {
      console.error('DuckDB page query failed:', err)
      throw new Error(`Failed to query table page: ${getErrorMessage(err)}`)
    }
  }

  // Get column names for a table
  const getTableColumns = async (tableName: string): Promise<string[]> => {
    if (!isInitialized.value) {
      await initialize()
    }

    try {
      const result = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      return result.schema.fields.map(f => f.name)
    } catch (err: unknown) {
      console.error('Failed to get table columns:', err)
      throw new Error(`Failed to get columns for ${tableName}: ${getErrorMessage(err)}`)
    }
  }

  // Get table schema (column names and types) for appending data
  const getTableSchema = async (tableName: string): Promise<{ name: string; type: string }[]> => {
    if (!isInitialized.value) {
      await initialize()
    }

    try {
      const result = await conn.value!.query(`SELECT * FROM "${tableName}" LIMIT 0`)
      return result.schema.fields.map(f => ({
        name: f.name,
        type: f.type.toString()
      }))
    } catch (err: unknown) {
      console.error('Failed to get table schema:', err)
      throw new Error(`Failed to get schema for ${tableName}: ${getErrorMessage(err)}`)
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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      console.error(`Failed to rename table from ${oldTableName} to ${newTableName}:`, err)
      throw new Error(`Failed to rename table: ${getErrorMessage(err)}`)
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
      // Type assertions needed due to DuckDB WASM type version mismatches
      const result = await loadCsvWithDuckDB(
        file,
        db.value! as AsyncDuckDB,
        conn.value! as AsyncDuckDBConnection,
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
    } catch (err: unknown) {
      console.error(`Failed to load CSV ${file.name}:`, err)
      throw new Error(`Failed to load CSV: ${getErrorMessage(err)}`)
    }
  }

  // Export a table to various formats using DuckDB's native COPY command
  type ExportFormat = 'csv' | 'json' | 'parquet' | 'xlsx'

  const exportTable = async (
    tableName: string,
    format: ExportFormat,
    _filename: string
  ): Promise<Blob> => {
    if (!isInitialized.value) {
      await initialize()
    }

    const selectQuery = `SELECT * FROM ${tableName}`

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
    } catch (err: unknown) {
      // Try to clean up temp file on error
      try {
        await db.value!.dropFile(tempFile)
      } catch {
        // Ignore cleanup errors
      }
      console.error(`Failed to export table as ${format}:`, err)
      throw new Error(`Failed to export as ${format.toUpperCase()}: ${getErrorMessage(err)}`)
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
    appendResults,
    storeResultsFromArrow,
    runQueryWithStorage,
    runQuery,
    queryTablePage,
    getTableColumns,
    getTableSchema,
    getTableRowCount,
    tableExists,
    sanitizeTableName,
    loadTablesMetadata,
    renameTable,
    loadCsvFile,
    exportTable
  }
})
