import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { sanitizeFileName, generateUniqueTableName } from '../utils/sqlSanitize'

export interface CsvLoadResult {
  tableName: string
  rowCount: number
  columns: string[]
  originalFileName: string
}

export async function loadCsvWithDuckDB(
  file: File,
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  existingTables: Record<string, any>
): Promise<CsvLoadResult> {
  // 1. Generate unique table name
  const tableName = generateUniqueTableName(file.name, existingTables)

  // 2. Read file as ArrayBuffer
  const buffer = await readFileAsArrayBuffer(file)

  // 3. Register file with DuckDB (sanitize filename to prevent path traversal)
  const safeFileName = sanitizeFileName(file.name)
  const virtualPath = `/${safeFileName}`
  await db.registerFileBuffer(virtualPath, new Uint8Array(buffer))

  try {
    // 4. Create table using DuckDB's read_csv_auto
    await conn.query(`
      CREATE TABLE ${tableName} AS
      SELECT * FROM read_csv_auto('${virtualPath}')
    `)

    // 5. Query metadata
    const countResult = await conn.query(`SELECT COUNT(*) as count FROM ${tableName}`)
    const rowCount = Number(countResult.toArray()[0].count)

    const schemaResult = await conn.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = '${tableName}'
      ORDER BY ordinal_position
    `)
    const columns = schemaResult.toArray().map(row => row.column_name as string)

    return {
      tableName,
      rowCount,
      columns,
      originalFileName: file.name.replace(/\.csv$/i, '')
    }
  } finally {
    // 6. Clean up registered file
    try {
      await db.dropFile(virtualPath)
    } catch (err) {
      console.warn('Failed to drop file:', err)
    }
  }
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
