/**
 * ClickHouse HTTP client — talks directly to ClickHouse from the browser.
 *
 * Uses the ClickHouse HTTP interface (POST to host:port with SQL in body).
 * Auth via Basic header. Response in JSON format includes metadata and stats.
 */

export interface ClickHouseCredentials {
  host: string
  port: number
  username: string
  password: string
  database: string | null
  secure: boolean
}

export interface ClickHouseQueryResult {
  rows: Record<string, unknown>[]
  schema: { name: string; type: string }[]
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface ClickHousePaginatedQueryResult {
  rows: Record<string, unknown>[]
  columns: { name: string; type: string }[]
  totalRows: number | null
  hasMore: boolean
  nextOffset: number
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface ClickHouseDatabaseInfo {
  name: string
}

export interface ClickHouseTableInfo {
  databaseName: string
  name: string
  type: 'table' | 'view'
}

export interface ClickHouseColumnInfo {
  name: string
  type: string
  nullable: boolean
}

interface ClickHouseJSONResponse {
  meta: { name: string; type: string }[]
  data: Record<string, unknown>[]
  rows: number
  statistics: { elapsed: number; rows_read: number; bytes_read: number }
}

/**
 * Create a ClickHouse HTTP client for the given credentials.
 */
export function createClickHouseHttpClient(credentials: ClickHouseCredentials) {
  const { host, port, username, password, database, secure } = credentials
  const baseUrl = `${secure ? 'https' : 'http'}://${host}:${port}`
  const authHeader = `Basic ${btoa(`${username}:${password}`)}`

  /**
   * Execute a SQL query against ClickHouse and return parsed JSON response.
   */
  async function query(
    sql: string,
    signal?: AbortSignal | null,
  ): Promise<ClickHouseJSONResponse> {
    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'X-ClickHouse-Format': 'JSON',
    }
    if (database) {
      headers['X-ClickHouse-Database'] = database
    }

    let response: Response
    try {
      response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: sql,
        signal: signal ?? undefined,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      // Network error — likely CORS or connectivity
      throw new Error(
        `Cannot reach ClickHouse at ${baseUrl}. ` +
        'If this is a self-hosted instance, ensure CORS is enabled in your ClickHouse config ' +
        '(set http_options_response headers for Access-Control-Allow-Origin).',
        { cause: err },
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      // ClickHouse returns error details as plain text
      throw new Error(text || `ClickHouse query failed (HTTP ${response.status})`)
    }

    return response.json()
  }

  return {
    /**
     * Test the connection by running SELECT 1.
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
      try {
        await query('SELECT 1')
        return { success: true, message: 'Connection successful' }
      } catch (err) {
        return {
          success: false,
          message: err instanceof Error ? err.message : 'Connection failed',
        }
      }
    },

    /**
     * Execute a query, returning rows + schema + stats.
     */
    async runQuery(
      sql: string,
      signal?: AbortSignal | null,
    ): Promise<ClickHouseQueryResult> {
      const start = performance.now()
      const data = await query(sql, signal)
      return {
        rows: data.data,
        schema: data.meta.map(m => ({ name: m.name, type: m.type })),
        stats: {
          executionTimeMs: Math.round(performance.now() - start),
          rowCount: data.rows,
        },
      }
    },

    /**
     * Execute a query with LIMIT/OFFSET pagination.
     * On first call (offset=0), also runs a COUNT query for total rows.
     */
    async runQueryPaginated(
      sql: string,
      batchSize: number = 5000,
      offset: number = 0,
      includeCount: boolean = true,
      signal?: AbortSignal | null,
    ): Promise<ClickHousePaginatedQueryResult> {
      const start = performance.now()

      // Fetch the page
      const paginatedSql = `SELECT * FROM (${sql}) AS _sq LIMIT ${batchSize} OFFSET ${offset}`
      const data = await query(paginatedSql, signal)

      // Optionally get total count
      let totalRows: number | null = null
      if (includeCount && offset === 0) {
        try {
          const countData = await query(`SELECT count() AS cnt FROM (${sql}) AS _sq`, signal)
          totalRows = Number(countData.data[0]?.cnt ?? 0)
        } catch {
          // Count failed — proceed without total
        }
      }

      const rowCount = data.rows
      const hasMore = rowCount === batchSize

      return {
        rows: data.data,
        columns: data.meta.map(m => ({ name: m.name, type: m.type })),
        totalRows,
        hasMore,
        nextOffset: offset + rowCount,
        stats: {
          executionTimeMs: Math.round(performance.now() - start),
          rowCount,
        },
      }
    },

    /**
     * List databases (excluding system databases).
     */
    async fetchDatabases(): Promise<ClickHouseDatabaseInfo[]> {
      const data = await query('SHOW DATABASES')
      return data.data
        .map(row => ({ name: String(row.name) }))
        .filter(db => !['system', 'INFORMATION_SCHEMA', 'information_schema'].includes(db.name))
    },

    /**
     * List all tables across all user databases.
     */
    async fetchTables(): Promise<ClickHouseTableInfo[]> {
      const data = await query(
        `SELECT database, name, engine FROM system.tables
         WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
         ORDER BY database, name`,
      )
      return data.data.map(row => ({
        databaseName: String(row.database),
        name: String(row.name),
        type: (String(row.engine).toLowerCase().includes('view') ? 'view' : 'table') as 'table' | 'view',
      }))
    },

    /**
     * List columns for a specific table.
     */
    async fetchColumns(
      databaseName: string,
      tableName: string,
    ): Promise<ClickHouseColumnInfo[]> {
      const data = await query(`DESCRIBE TABLE \`${databaseName}\`.\`${tableName}\``)
      return data.data.map(row => ({
        name: String(row.name),
        type: String(row.type),
        nullable: String(row.type).startsWith('Nullable'),
      }))
    },

    /**
     * Fetch all columns for all tables (for autocomplete).
     * Returns a map of "database.table" -> columns.
     */
    async fetchAllColumns(): Promise<Record<string, ClickHouseColumnInfo[]>> {
      const data = await query(
        `SELECT database, table, name, type
         FROM system.columns
         WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
         ORDER BY database, table, position`,
      )

      const result: Record<string, ClickHouseColumnInfo[]> = {}
      for (const row of data.data) {
        const key = `${row.database}.${row.table}`
        if (!result[key]) result[key] = []
        result[key].push({
          name: String(row.name),
          type: String(row.type),
          nullable: String(row.type).startsWith('Nullable'),
        })
      }
      return result
    },

    /**
     * Fetch metadata for a specific table (row count, size, engine).
     */
    async fetchTableMetadata(
      databaseName: string,
      tableName: string,
    ): Promise<{ rowCount: number | null; sizeBytes: number | null; engine: string | null }> {
      const data = await query(
        `SELECT total_rows, total_bytes, engine
         FROM system.tables
         WHERE database = '${databaseName}' AND name = '${tableName}'`,
      )
      const row = data.data[0]
      return {
        rowCount: row?.total_rows != null ? Number(row.total_rows) : null,
        sizeBytes: row?.total_bytes != null ? Number(row.total_bytes) : null,
        engine: row?.engine ? String(row.engine) : null,
      }
    },
  }
}
