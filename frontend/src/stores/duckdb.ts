import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { DataType as ArrowDataType } from 'apache-arrow'
import { loadCsvWithDuckDB } from '../services/csvHandler'
import { sanitizeTableName, sanitizeFileName, escapeSqlString } from '../utils/sqlSanitize'
import { mapBigQueryTypeToDuckDB } from '../utils/bigqueryConversion'
import { buildDuckDBSchema, type SchemaNamespace } from '../utils/schemaBuilder'
import type { SchemaItem } from '../utils/textSimilarity'
import type { DatabaseEngine } from '../types/database'

interface TableMetadata {
  rowCount: number
  columns?: string[]
  lastUpdated: number
  originalBoxName?: string
  boxId?: number | null
  // Native column types from the source database (Postgres, BigQuery, Snowflake).
  // When present, these are served back to the UI instead of DuckDB/Arrow types.
  nativeColumnTypes?: Record<string, string>
  // True for DuckDB query results stored as views (not real tables).
  // These should not appear in the schema browser.
  isView?: boolean
}

/** Row in the _schemas DuckDB table */
export interface SchemaRow {
  connection_type: string
  connection_id: string
  catalog: string | null
  schema_name: string
  table_name: string
  column_name: string
  column_type: string
  is_nullable: boolean
}

/** Internal tables that should be hidden from user-visible table lists */
const INTERNAL_TABLES = new Set(['_schemas'])

/** Group column rows by table name (shared by loadTablesMetadata and loadAttachedTablesMetadata) */
const groupColumnsByTable = (colRows: { table_name: unknown; column_name: unknown }[]): Map<string, string[]> => {
  const result = new Map<string, string[]>()
  for (const row of colRows) {
    const tbl = row.table_name as string
    if (!result.has(tbl)) result.set(tbl, [])
    result.get(tbl)!.push(row.column_name as string)
  }
  return result
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
const serializeDuckDBValue = (value: unknown, fieldType?: { typeId: number; scale?: number }): SerializableValue => {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') {
    // BigInt from DECIMAL: apply scale if available
    if (fieldType && ArrowDataType.isDecimal(fieldType) && fieldType.scale > 0) {
      return Number(value) / Math.pow(10, fieldType.scale)
    }
    return Number(value)
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  // Arrow Decimal types: String(value) gives the unscaled integer.
  // Apply scale divisor to get the correct value.
  if (fieldType && ArrowDataType.isDecimal(fieldType)) {
    const str = String(value)
    if (/^-?\d+$/.test(str)) {
      const raw = Number(str)
      return fieldType.scale > 0 ? raw / Math.pow(10, fieldType.scale) : raw
    }
  }
  // Use JSON round-trip to leverage Arrow's built-in toJSON() methods
  // This handles Structs, Lists, Maps, Dates, etc. correctly
  try {
    const parsed = JSON.parse(JSON.stringify(value))
    // Guard against Arrow types whose toJSON() wraps numbers in quotes
    if (typeof parsed === 'string') {
      const stripped = parsed.replace(/^"|"$/g, '')
      if (/^-?\d+(\.\d+)?$/.test(stripped)) return Number(stripped)
    }
    return parsed
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

  // Schema refresh progress (set by MenuBar, read by Home.vue)
  const schemaRefreshMessage = ref<string | null>(null)

  // Track initialization promise for concurrent callers to await
  let initPromise: Promise<void> | null = null

  // Track available tables (table name -> metadata)
  const tables = ref<Record<string, TableMetadata>>({})

  // Track attached (imported) DuckDB databases: alias → { tables }
  const attachedDatabases = ref<Record<string, {
    tables: Record<string, { rowCount: number, columns: string[] }>
  }>>({})

  // Reactive trigger for table schema changes
  const schemaVersion = ref(0)

  // Cache for getEditorSchema() results, keyed by "connectionType:connectionId"
  const editorSchemaCache = new Map<string, SchemaNamespace>()
  let lastSchemaCacheVersion = -1

  // Initialize DuckDB with OPFS persistence
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

        // Open with OPFS persistence; fall back to in-memory if unavailable
        try {
          await db.value.open({
            path: 'opfs://squill.duckdb',
            accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
          })
          console.log('DuckDB opened with OPFS persistence')
        } catch (err) {
          console.warn('OPFS unavailable, using in-memory DuckDB:', err)
        }

        // Create connection
        conn.value = await db.value.connect()

        // Ensure _schemas table exists (OPFS may already have it from last session)
        await initSchemasTable()

        // Load existing tables metadata
        await loadTablesMetadata()

        isInitialized.value = true
        schemaVersion.value++
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

  const ensureInit = async () => {
    if (!isInitialized.value) await initialize()
  }

  // Load metadata about existing tables (names, row counts, column names)
  const loadTablesMetadata = async () => {
    if (!conn.value) return

    try {
      // Single query: get row counts for local tables only (exclude attached databases)
      const countResult = await conn.value.query(`
        SELECT table_name, estimated_size as row_count
        FROM duckdb_tables()
        WHERE schema_name = 'main' AND database_name = current_database()
      `)
      const countRows = countResult.toArray()

      // Single query: get all columns for local tables only
      const colResult = await conn.value.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'main' AND table_catalog = current_database()
        ORDER BY table_name, ordinal_position
      `)
      const colRows = colResult.toArray()

      const columnsByTable = groupColumnsByTable(colRows)

      const now = Date.now()
      for (const row of countRows) {
        const tableName = row.table_name as string
        if (INTERNAL_TABLES.has(tableName)) continue

        tables.value[tableName] = {
          ...(tables.value[tableName] || {}),
          rowCount: Number(row.row_count || 0),
          columns: columnsByTable.get(tableName) || [],
          lastUpdated: now,
        }
      }
    } catch (err) {
      console.warn('Failed to load tables metadata:', err)
    }
  }

  // Load metadata (tables, row counts, columns) for an attached DuckDB database.
  // Returns table names for caller convenience.
  const loadAttachedTablesMetadata = async (alias: string): Promise<string[]> => {
    if (!conn.value) return []

    try {
      const escapedAlias = alias.replace(/'/g, "''")

      // Get tables and row counts
      const countResult = await conn.value.query(
        `SELECT table_name, estimated_size as row_count FROM duckdb_tables() WHERE database_name = '${escapedAlias}'`
      )
      const countRows = countResult.toArray()

      // Get columns
      const colResult = await conn.value.query(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_catalog = '${escapedAlias}' ORDER BY table_name, ordinal_position`
      )
      const colRows = colResult.toArray()

      const columnsByTable = groupColumnsByTable(colRows)

      const tablesMap: Record<string, { rowCount: number, columns: string[] }> = {}
      for (const row of countRows) {
        const tableName = row.table_name as string
        tablesMap[tableName] = {
          rowCount: Number(row.row_count || 0),
          columns: columnsByTable.get(tableName) || [],
        }
      }

      attachedDatabases.value[alias] = { tables: tablesMap }
      schemaVersion.value++
      return Object.keys(tablesMap)
    } catch (err) {
      console.warn(`Failed to load metadata for attached database ${alias}:`, err)
      return []
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
    await ensureInit()

    const tableName = sanitizeTableName(boxName)

    // Handle empty results: create an empty table with schema if available
    if (!results || results.length === 0) {
      try {
        if (schema && schema.length > 0) {
          // Create empty table with proper column types from schema
          const columnDefs = schema.map(col => {
            const duckdbType = sourceEngine === 'bigquery'
              ? mapBigQueryTypeToDuckDB(col.type)
              : 'VARCHAR'
            return `"${col.name}" ${duckdbType}`
          }).join(', ')
          await conn.value!.query(`CREATE OR REPLACE TABLE ${tableName} (${columnDefs})`)
        } else {
          // No schema available - create a minimal empty table
          await conn.value!.query(`CREATE OR REPLACE TABLE ${tableName} (_empty VARCHAR)`)
        }

        tables.value[tableName] = {
          rowCount: 0,
          columns: schema?.map(c => c.name) || [],
          lastUpdated: Date.now(),
          originalBoxName: boxName,
          boxId: boxId,
          nativeColumnTypes: schema ? Object.fromEntries(schema.map(c => [c.name, c.type])) : undefined
        }

        return tableName
      } catch (err: unknown) {
        console.error(`Failed to create empty table for ${boxName}:`, err)
        throw new Error(`Failed to store results in DuckDB: ${getErrorMessage(err)}`, { cause: err })
      }
    }

    const jsonFileName = `${tableName}.json`
    // Preserve original column order from the first result row
    const columns = Object.keys(results[0])

    try {
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
          `CREATE OR REPLACE TABLE ${tableName} AS SELECT ${columnDefs} FROM read_json_auto('${jsonFileName}')`
        )
      } else {
        // Other engines (Postgres, Snowflake, etc.): let DuckDB infer types
        // These databases return properly typed JSON that DuckDB can handle
        const columnList = columns.map(c => `"${c}"`).join(', ')
        await conn.value!.query(
          `CREATE OR REPLACE TABLE ${tableName} AS SELECT ${columnList} FROM read_json_auto('${jsonFileName}')`
        )
      }

      await db.value!.dropFile(jsonFileName)

      // Update metadata
      tables.value[tableName] = {
        rowCount: results.length,
        columns: columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId: boxId,
        nativeColumnTypes: schema ? Object.fromEntries(schema.map(c => [c.name, c.type])) : undefined
      }

      return tableName
    } catch (err: unknown) {
      console.error(`Failed to store results for ${boxName}:`, err)
      throw new Error(`Failed to store results in DuckDB: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Append rows to an existing table (for pagination)
  // Uses JSON import with INSERT INTO ... SELECT for simplicity
  const appendResults = async (
    tableName: string,
    rows: Record<string, unknown>[],
    _schema?: ColumnSchema[]  // Kept for API compatibility, but not used
  ): Promise<number> => {
    await ensureInit()

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
      throw new Error(`Failed to append results to DuckDB: ${getErrorMessage(err)}`, { cause: err })
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
    await ensureInit()

    const tableName = sanitizeTableName(boxName)
    const startTime = performance.now()

    try {
      // Drop required here — insertArrowFromIPCStream has no "replace" option
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
      throw new Error(`Failed to store Arrow results in DuckDB: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Execute DuckDB query and store results as a table using CTAS
  // Returns only metadata - data stays in DuckDB and is fetched page-by-page
  // by ResultsTable via queryTablePage() for optimal memory usage
  // Get accurate DuckDB SQL type names via DESCRIBE (e.g. "JSON", "VARCHAR", "BIGINT")
  // rather than Arrow's internal names ("Utf8", "Int64") from f.type.toString()
  const describeTableTypes = async (tableName: string): Promise<Record<string, string>> => {
    const result = await conn.value!.query(`DESCRIBE ${tableName}`)
    const types: Record<string, string> = {}
    result.toArray().forEach(row => {
      types[row.column_name as string] = row.column_type as string
    })
    return types
  }

  const runQueryWithStorage = async (
    query: string,
    boxName: string,
    boxId: number | null = null
  ): Promise<QueryResult> => {
    await ensureInit()

    const tableName = sanitizeTableName(boxName)
    const startTime = performance.now()

    try {
      // Use a VIEW instead of a TABLE — the data is already in DuckDB,
      // so there's no need to duplicate it. ResultsTable can paginate views
      // via queryTablePage() the same way it does tables.
      await conn.value!.query(`CREATE OR REPLACE VIEW ${tableName} AS (${query})`)

      const endTime = performance.now()

      // Get row count via the view (window COUNT avoids a separate query)
      const countResult = await conn.value!.query(`SELECT COUNT(*) as count FROM ${tableName}`)
      const countData = countResult.toArray()
      const rowCount = Number(countData[0]?.count || 0)

      // Get schema (columns + types) — use DESCRIBE for accurate DuckDB SQL type names
      const schemaResult = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      const columns = schemaResult.schema.fields.map(f => f.name)
      const columnTypes = await describeTableTypes(tableName)

      // Update metadata (cache columnTypes so queryTablePage skips DESCRIBE).
      // Mark as view so the schema browser can filter it out.
      tables.value[tableName] = {
        rowCount,
        columns,
        lastUpdated: Date.now(),
        originalBoxName: boxName,
        boxId,
        nativeColumnTypes: columnTypes,
        isView: true,
      }

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
      throw new Error(`DuckDB query failed: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Run a query without storing results (for analytics, etc.)
  const runQuery = async (query: string): Promise<QueryResult> => {
    await ensureInit()

    const startTime = performance.now()

    try {
      const result = await conn.value!.query(query)
      const endTime = performance.now()

      // Convert Arrow result to array of objects
      const rows = result.toArray().map(row => {
        const obj: Record<string, SerializableValue> = {}
        result.schema.fields.forEach((field) => {
          obj[field.name] = serializeDuckDBValue(row[field.name], field.type)
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
      throw new Error(`DuckDB query failed: ${getErrorMessage(err)}`, { cause: err })
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
    await ensureInit()

    const offset = (page - 1) * pageSize
    const query = `SELECT * FROM ${tableName} LIMIT ${pageSize} OFFSET ${offset}`

    try {
      const result = await conn.value!.query(query)
      const columns = result.schema.fields.map(f => f.name)
      // Prefer native source DB types if we have them; fall back to DuckDB DESCRIBE
      const columnTypes = tables.value[tableName]?.nativeColumnTypes
        ?? await describeTableTypes(tableName)
      const fieldTypes: Record<string, unknown> = {}
      result.schema.fields.forEach(f => {
        fieldTypes[f.name] = f.type
      })
      const rows = result.toArray().map(row => {
        const obj: Record<string, SerializableValue> = {}
        columns.forEach(col => {
          obj[col] = serializeDuckDBValue(row[col], fieldTypes[col] as { typeId: number; scale?: number })
        })
        return obj
      })

      return { rows, columns, columnTypes }
    } catch (err: unknown) {
      console.error('DuckDB page query failed:', err)
      throw new Error(`Failed to query table page: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Get column names for a table
  const getTableColumns = async (tableName: string): Promise<string[]> => {
    await ensureInit()

    try {
      const result = await conn.value!.query(`SELECT * FROM ${tableName} LIMIT 0`)
      return result.schema.fields.map(f => f.name)
    } catch (err: unknown) {
      console.error('Failed to get table columns:', err)
      throw new Error(`Failed to get columns for ${tableName}: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Get table schema (column names and types) for appending data
  const getTableSchema = async (tableName: string): Promise<{ name: string; type: string }[]> => {
    await ensureInit()

    try {
      const result = await conn.value!.query(`SELECT * FROM "${tableName}" LIMIT 0`)
      return result.schema.fields.map(f => ({
        name: f.name,
        type: f.type.toString()
      }))
    } catch (err: unknown) {
      console.error('Failed to get table schema:', err)
      throw new Error(`Failed to get schema for ${tableName}: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Get total row count for a table
  const getTableRowCount = async (tableName: string): Promise<number> => {
    await ensureInit()

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

  // Cached DuckDB schema for CodeMirror autocompletion.
  // Computed once per tables change, shared across all QueryPanel instances.
  const duckdbEditorSchema = computed(() => buildDuckDBSchema(tables.value))

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

    await ensureInit()

    try {
      // Check if old table exists
      if (!tables.value[oldTableName]) {
        console.log(`Table ${oldTableName} does not exist yet, nothing to rename`)
        return
      }

      // Use ALTER TABLE/VIEW to rename
      const isView = tables.value[oldTableName]?.isView
      await conn.value!.query(`ALTER ${isView ? 'VIEW' : 'TABLE'} ${oldTableName} RENAME TO ${newTableName}`)

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
      throw new Error(`Failed to rename table: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Garbage-collect orphaned tables and views from local DuckDB.
  // Drops anything not in INTERNAL_TABLES and not owned by a live box.
  const garbageCollect = async (liveBoxIds: Set<number>) => {
    if (!conn.value) return

    try {
      // Query DuckDB directly for all user tables and views in local database
      const result = await conn.value.query(`
        SELECT table_name, table_type FROM information_schema.tables
        WHERE table_schema = 'main' AND table_catalog = current_database()
      `)
      const rows = result.toArray()

      let dropped = 0
      for (const row of rows) {
        const name = row.table_name as string
        const type = row.table_type as string
        if (INTERNAL_TABLES.has(name)) continue

        // Check if any live box owns this table
        const meta = tables.value[name]
        if (meta?.boxId != null && liveBoxIds.has(meta.boxId)) continue

        // Orphaned — drop it
        const kind = type === 'VIEW' ? 'VIEW' : 'TABLE'
        try {
          await conn.value!.query(`DROP ${kind} IF EXISTS "${name.replace(/"/g, '""')}"`)
          delete tables.value[name]
          dropped++
        } catch (err) {
          console.warn(`GC: failed to drop ${name}:`, err)
        }
      }

      if (dropped > 0) {
        schemaVersion.value++
        console.log(`GC: dropped ${dropped} orphaned table(s)/view(s)`)
      }
    } catch (err) {
      console.warn('GC: failed to scan tables:', err)
    }
  }

  // Load CSV file into DuckDB
  const loadCsvFile = async (
    file: File,
    boxId: number | null = null
  ): Promise<string | null> => {
    await ensureInit()

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
      throw new Error(`Failed to load CSV: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // Attach an imported .duckdb file via OPFS
  const attachDuckDBFile = async (file: File): Promise<{ alias: string, tables: string[] }> => {
    await ensureInit()

    // Sanitize filename for OPFS and SQL alias
    const safeName = sanitizeFileName(file.name)
    const alias = safeName.replace(/\.duckdb$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_')

    // Read file once, persist to OPFS, and register with DuckDB's VFS
    const buffer = new Uint8Array(await file.arrayBuffer())

    const root = await navigator.storage.getDirectory()
    const fileHandle = await root.getFileHandle(safeName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(buffer)
    await writable.close()

    // Detach if already attached (re-import)
    try {
      await conn.value!.query(`DETACH "${alias.replace(/"/g, '""')}"`)
    } catch {
      // Not attached — ignore
    }

    await db.value!.registerFileBuffer(safeName, buffer)
    await conn.value!.query(`ATTACH '${safeName.replace(/'/g, "''")}' AS "${alias.replace(/"/g, '""')}" (READ_ONLY)`)

    // Load metadata and get table names in one pass
    const tableNames = await loadAttachedTablesMetadata(alias)

    console.log(`Attached DuckDB file: ${safeName} as "${alias}" with ${tableNames.length} tables`)
    return { alias, tables: tableNames }
  }

  // Re-attach a previously imported DuckDB file (call on startup for persisted connections)
  // opfsFileName is the sanitized filename stored in the connection's database field
  const reattachDuckDBFile = async (opfsFileName: string, alias: string): Promise<boolean> => {
    await ensureInit()
    try {
      // Read file from OPFS and register with DuckDB's VFS
      const root = await navigator.storage.getDirectory()
      const fileHandle = await root.getFileHandle(opfsFileName)
      const file = await fileHandle.getFile()
      const buffer = new Uint8Array(await file.arrayBuffer())
      await db.value!.registerFileBuffer(opfsFileName, buffer)

      await conn.value!.query(`ATTACH '${opfsFileName.replace(/'/g, "''")}' AS "${alias.replace(/"/g, '""')}" (READ_ONLY)`)
      console.log(`Re-attached DuckDB: ${alias}`)

      // Load metadata so schema browser can show tables
      await loadAttachedTablesMetadata(alias)

      return true
    } catch (err: unknown) {
      console.warn(`Failed to re-attach DuckDB ${alias}:`, err)
      return false
    }
  }

  // Export a table to various formats using DuckDB's native COPY command
  type ExportFormat = 'csv' | 'json' | 'parquet' | 'xlsx'

  const exportTable = async (
    tableName: string,
    format: ExportFormat,
    _filename: string
  ): Promise<Blob> => {
    await ensureInit()

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
      throw new Error(`Failed to export as ${format.toUpperCase()}: ${getErrorMessage(err)}`, { cause: err })
    }
  }

  // ---------------------------------------------------------------------------
  // _schemas table: unified schema catalog stored in DuckDB, persisted via OPFS
  // ---------------------------------------------------------------------------

  /** Create _schemas table if it doesn't already exist (OPFS persists it across sessions). */
  const initSchemasTable = async () => {
    if (!conn.value) return
    await conn.value.query(`
      CREATE TABLE IF NOT EXISTS _schemas (
        connection_type VARCHAR NOT NULL,
        connection_id VARCHAR NOT NULL,
        catalog VARCHAR,
        schema_name VARCHAR NOT NULL,
        table_name VARCHAR NOT NULL,
        column_name VARCHAR NOT NULL,
        column_type VARCHAR NOT NULL,
        is_nullable BOOLEAN DEFAULT TRUE
      )
    `)
  }

  const insertSchemaRows = async (rows: SchemaRow[]) => {
    if (!conn.value || !db.value || rows.length === 0) return
    const jsonFile = '_schemas_import.json'
    await db.value.registerFileText(jsonFile, JSON.stringify(rows))
    await conn.value.query(`INSERT INTO _schemas SELECT * FROM read_json_auto('${jsonFile}')`)
    await db.value.dropFile(jsonFile)
  }

  /**
   * Atomically replace all schema rows for a connection.
   * Deletes existing rows, inserts new ones, persists to IDB.
   */
  const replaceConnectionSchemas = async (
    connectionType: string,
    connectionId: string,
    rows: SchemaRow[]
  ) => {
    await ensureInit()

    const safeType = escapeSqlString(connectionType)
    const safeId = escapeSqlString(connectionId)
    await conn.value!.query(
      `DELETE FROM _schemas WHERE connection_type = '${safeType}' AND connection_id = '${safeId}'`
    )

    if (rows.length > 0) {
      await insertSchemaRows(rows)
    }

    schemaVersion.value++
  }

  /**
   * Build a SchemaNamespace from _schemas for CodeMirror autocompletion.
   * Handles BigQuery hierarchical structure, Postgres/Snowflake shortcuts.
   */
  const getEditorSchema = async (
    connectionType: string,
    connectionId: string,
    activeProject?: string
  ): Promise<SchemaNamespace> => {
    if (!isInitialized.value || !conn.value) return {}

    // Invalidate cache when schema data has changed
    if (schemaVersion.value !== lastSchemaCacheVersion) {
      editorSchemaCache.clear()
      lastSchemaCacheVersion = schemaVersion.value
    }

    const cacheKey = `${connectionType}:${connectionId}`
    const cached = editorSchemaCache.get(cacheKey)
    if (cached) return cached

    const safeType = escapeSqlString(connectionType)
    const safeId = escapeSqlString(connectionId)
    const result = await conn.value.query(`
      SELECT catalog, schema_name, table_name, column_name
      FROM _schemas
      WHERE connection_type = '${safeType}' AND connection_id = '${safeId}'
      ORDER BY catalog, schema_name, table_name, column_name
    `)
    const rows = result.toArray()

    // Group columns by table
    const tableColumns = new Map<string, string[]>()
    for (const row of rows) {
      const key = `${row.catalog || ''}\0${row.schema_name}\0${row.table_name}`
      if (!tableColumns.has(key)) tableColumns.set(key, [])
      tableColumns.get(key)!.push(row.column_name as string)
    }

    const schema: SchemaNamespace = {}

    if (connectionType === 'bigquery') {
      // Hierarchical: project → dataset → table → columns
      for (const [key, columns] of tableColumns) {
        const [project, dataset, table] = key.split('\0')
        if (!project || !dataset || !table) continue

        if (!schema[project]) schema[project] = {}
        const projectNs = schema[project] as SchemaNamespace
        if (!projectNs[dataset]) projectNs[dataset] = {}
        const datasetNs = projectNs[dataset] as SchemaNamespace
        datasetNs[table] = columns

        // Add dataset.table shortcut for active project
        if (activeProject && project === activeProject) {
          if (!schema[dataset]) schema[dataset] = {}
          const topDs = schema[dataset] as SchemaNamespace
          if (!topDs[table]) topDs[table] = columns
        }
      }
    } else if (connectionType === 'postgres') {
      // Flat: schema.table → columns, plus unqualified for public
      for (const [key, columns] of tableColumns) {
        const [, schemaName, tableName] = key.split('\0')
        schema[`${schemaName}.${tableName}`] = columns
        if (schemaName === 'public') {
          schema[tableName] = columns
        }
      }
    } else if (connectionType === 'snowflake') {
      // Flat: database.schema.table → columns, plus shortcuts
      for (const [key, columns] of tableColumns) {
        const [dbName, schemaName, tableName] = key.split('\0')
        schema[`${dbName}.${schemaName}.${tableName}`] = columns
        if (!schema[`${schemaName}.${tableName}`]) {
          schema[`${schemaName}.${tableName}`] = columns
        }
        if (schemaName?.toUpperCase() === 'PUBLIC' && !schema[tableName]) {
          schema[tableName] = columns
        }
      }
    }

    editorSchemaCache.set(cacheKey, schema)
    return schema
  }

  /**
   * Get SchemaItem[] from _schemas for AI/LLM context (schemaAdapter replacement).
   */
  const getSchemaItems = async (
    connectionType: string,
    connectionId?: string
  ): Promise<SchemaItem[]> => {
    if (!isInitialized.value || !conn.value) return []

    const safeType = escapeSqlString(connectionType)
    let where = `connection_type = '${safeType}'`
    if (connectionId) {
      const safeId = escapeSqlString(connectionId)
      where += ` AND connection_id = '${safeId}'`
    }

    const result = await conn.value.query(`
      SELECT catalog, schema_name, table_name, column_name, column_type
      FROM _schemas
      WHERE ${where}
      ORDER BY catalog, schema_name, table_name, column_name
    `)
    const rows = result.toArray()

    // Group columns by table
    const tableColumns = new Map<string, Array<{ name: string; type: string }>>()
    for (const row of rows) {
      let tableName: string
      if (connectionType === 'bigquery') {
        tableName = `${row.catalog}.${row.schema_name}.${row.table_name}`
      } else if (connectionType === 'snowflake') {
        tableName = `${row.catalog}.${row.schema_name}.${row.table_name}`
      } else {
        tableName = `${row.schema_name}.${row.table_name}`
      }
      if (!tableColumns.has(tableName)) tableColumns.set(tableName, [])
      tableColumns.get(tableName)!.push({
        name: row.column_name as string,
        type: row.column_type as string,
      })
    }

    return Array.from(tableColumns.entries()).map(([tableName, columns]) => ({
      tableName,
      columns,
    }))
  }

  /**
   * Atomically replace all schema rows for a specific catalog within a connection.
   * Used by BigQuery to update one project's schemas without wiping others.
   */
  const replaceConnectionCatalogSchemas = async (
    connectionType: string,
    connectionId: string,
    catalog: string,
    rows: SchemaRow[]
  ) => {
    await ensureInit()

    const safeType = escapeSqlString(connectionType)
    const safeId = escapeSqlString(connectionId)
    const safeCatalog = escapeSqlString(catalog)
    await conn.value!.query(
      `DELETE FROM _schemas WHERE connection_type = '${safeType}' AND connection_id = '${safeId}' AND catalog = '${safeCatalog}'`
    )

    if (rows.length > 0) {
      await insertSchemaRows(rows)
    }

    schemaVersion.value++
  }

  /**
   * Remove all schema rows for a specific catalog within a connection.
   * Used when deselecting a BigQuery project.
   */
  const removeConnectionCatalogSchemas = async (
    connectionType: string,
    connectionId: string,
    catalog: string
  ) => {
    await ensureInit()

    const safeType = escapeSqlString(connectionType)
    const safeId = escapeSqlString(connectionId)
    const safeCatalog = escapeSqlString(catalog)
    await conn.value!.query(
      `DELETE FROM _schemas WHERE connection_type = '${safeType}' AND connection_id = '${safeId}' AND catalog = '${safeCatalog}'`
    )

    schemaVersion.value++
  }

  /**
   * Upsert schema rows for a single table (delete old rows for that table, insert new).
   * Used when individual table schemas are fetched on demand.
   */
  const upsertTableSchema = async (
    connectionType: string,
    connectionId: string,
    catalog: string | null,
    schemaName: string,
    tableName: string,
    columns: Array<{ name: string; type: string }>
  ) => {
    if (!isInitialized.value || !conn.value) return

    const catalogClause = catalog
      ? `AND catalog = '${escapeSqlString(catalog)}'`
      : `AND catalog IS NULL`
    await conn.value.query(
      `DELETE FROM _schemas WHERE connection_type = '${escapeSqlString(connectionType)}' AND connection_id = '${escapeSqlString(connectionId)}' ${catalogClause} AND schema_name = '${escapeSqlString(schemaName)}' AND table_name = '${escapeSqlString(tableName)}'`
    )

    if (columns.length > 0) {
      const rows = columns.map(col => ({
        connection_type: connectionType,
        connection_id: connectionId,
        catalog,
        schema_name: schemaName,
        table_name: tableName,
        column_name: col.name,
        column_type: col.type,
        is_nullable: true,
      }))
      await insertSchemaRows(rows)
    }

    schemaVersion.value++
  }

  return {
    isInitialized,
    isInitializing,
    initError,
    tables,
    attachedDatabases,
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
    garbageCollect,
    loadCsvFile,
    attachDuckDBFile,
    reattachDuckDBFile,
    loadAttachedTablesMetadata,
    exportTable,
    replaceConnectionSchemas,
    replaceConnectionCatalogSchemas,
    removeConnectionCatalogSchemas,
    upsertTableSchema,
    getEditorSchema,
    getSchemaItems,
    duckdbEditorSchema,
    schemaRefreshMessage,
  }
})
