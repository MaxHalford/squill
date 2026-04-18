/**
 * Snowflake SQL REST API client — talks directly to Snowflake from the browser.
 *
 * Auth flow:
 *   1. POST /session/v1/login-request with username/password → session token
 *   2. Use Authorization: Snowflake Token="..." for all subsequent requests
 *   3. Queries via POST /api/v2/statements
 *   4. Async queries (202) polled with GET /api/v2/statements/{handle}
 */

export interface SnowflakeCredentials {
  account: string
  username: string
  password: string
  warehouse: string | null
  database: string | null
  schemaName: string | null
  role: string | null
}

export interface SnowflakeQueryResult {
  rows: Record<string, unknown>[]
  schema: { name: string; type: string }[]
  stats: {
    executionTimeMs: number
    rowCount: number
  }
}

export interface SnowflakePaginatedQueryResult {
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

export interface SnowflakeDatabaseInfo { name: string }
export interface SnowflakeSchemaInfo { name: string }
export interface SnowflakeTableInfo {
  databaseName: string
  schemaName: string
  name: string
  type: 'table' | 'view'
}
export interface SnowflakeColumnInfo {
  name: string
  type: string
  nullable: boolean
}

// Snowflake SQL API response shapes
interface SFStatementResponse {
  code: string
  statementHandle: string
  statementStatusUrl: string
  message: string
  resultSetMetaData?: {
    numRows: number
    format: string
    rowType: { name: string; type: string; nullable: boolean }[]
    partitionInfo?: { rowCount: number; uncompressedSize: number }[]
  }
  data?: string[][]
  createdOn?: number
}

/**
 * Create a Snowflake REST client for the given credentials.
 */
export function createSnowflakeRestClient(credentials: SnowflakeCredentials) {
  const { account, username, password, warehouse, database, schemaName, role } = credentials
  const baseUrl = `https://${account}.snowflakecomputing.com`
  let sessionToken: string | null = null

  /**
   * Authenticate with username/password to get a session token.
   */
  async function login(): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/session/v1/login-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            LOGIN_NAME: username,
            PASSWORD: password,
            ACCOUNT_NAME: account,
          },
        }),
      })
    } catch {
      throw new Error(
        `Cannot reach Snowflake at ${baseUrl}. ` +
        'Check your account identifier and network connectivity. ' +
        'If you see a CORS error, Snowflake may not allow browser-direct access from this origin.',
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Snowflake login failed (HTTP ${response.status}): ${text}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.message || 'Snowflake authentication failed')
    }
    sessionToken = data.data?.token
    if (!sessionToken) {
      throw new Error('No session token returned from Snowflake')
    }
  }

  /**
   * Ensure we have a valid session token.
   */
  async function ensureAuth(): Promise<string> {
    if (!sessionToken) await login()
    return sessionToken!
  }

  /**
   * Execute a SQL statement via the SQL REST API.
   * Handles 202 (async) responses by polling.
   */
  async function executeStatement(
    sql: string,
    signal?: AbortSignal | null,
  ): Promise<SFStatementResponse> {
    const token = await ensureAuth()

    const body: Record<string, unknown> = { statement: sql, timeout: 60 }
    if (warehouse) body.warehouse = warehouse
    if (database) body.database = database
    if (schemaName) body.schema = schemaName
    if (role) body.role = role

    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/v2/statements`, {
        method: 'POST',
        headers: {
          'Authorization': `Snowflake Token="${token}"`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'SNOWFLAKE',
        },
        body: JSON.stringify(body),
        signal: signal ?? undefined,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      // Re-try once after re-login (token may have expired)
      sessionToken = null
      const freshToken = await ensureAuth()
      response = await fetch(`${baseUrl}/api/v2/statements`, {
        method: 'POST',
        headers: {
          'Authorization': `Snowflake Token="${freshToken}"`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'SNOWFLAKE',
        },
        body: JSON.stringify(body),
        signal: signal ?? undefined,
      })
    }

    if (response.status === 422) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.message || 'Snowflake query error')
    }

    if (!response.ok && response.status !== 202) {
      const errData = await response.json().catch(() => ({}))
      // 401 → re-auth and retry once
      if (response.status === 401) {
        sessionToken = null
        return executeStatement(sql, signal)
      }
      throw new Error(errData.message || `Snowflake API error (HTTP ${response.status})`)
    }

    const data: SFStatementResponse = await response.json()

    // 202 = query still running → poll
    if (response.status === 202 || data.code === '333334') {
      return pollStatement(data.statementHandle, signal)
    }

    return data
  }

  /**
   * Poll for async query completion with exponential backoff.
   */
  async function pollStatement(
    handle: string,
    signal?: AbortSignal | null,
  ): Promise<SFStatementResponse> {
    const baseDelay = 500
    const maxDelay = 5000
    let attempt = 0

    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const delay = Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay)
      await new Promise(r => setTimeout(r, delay))
      attempt++

      const token = await ensureAuth()
      const response = await fetch(`${baseUrl}/api/v2/statements/${handle}`, {
        headers: {
          'Authorization': `Snowflake Token="${token}"`,
          'Accept': 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'SNOWFLAKE',
        },
        signal: signal ?? undefined,
      })

      if (response.status === 202) continue

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.message || 'Polling failed')
      }

      return response.json()
    }
  }

  /**
   * Convert Snowflake's array-of-arrays data format to array-of-objects.
   */
  function parseRows(
    data: string[][] | undefined,
    rowType: { name: string; type: string }[] | undefined,
  ): Record<string, unknown>[] {
    if (!data || !rowType) return []
    return data.map(row => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < rowType.length; i++) {
        const col = rowType[i]
        const val = row[i]
        // Snowflake returns all values as strings; parse numbers
        if (val === null || val === undefined) {
          obj[col.name] = null
        } else if (['fixed', 'real', 'float'].some(t => col.type.toLowerCase().includes(t))) {
          obj[col.name] = Number(val)
        } else if (col.type.toLowerCase() === 'boolean') {
          obj[col.name] = val === 'true' || val === '1'
        } else {
          obj[col.name] = val
        }
      }
      return obj
    })
  }

  return {
    async testConnection(): Promise<{ success: boolean; message: string }> {
      try {
        await executeStatement('SELECT 1')
        return { success: true, message: 'Connection successful' }
      } catch (err) {
        return {
          success: false,
          message: err instanceof Error ? err.message : 'Connection failed',
        }
      }
    },

    async runQuery(
      sql: string,
      signal?: AbortSignal | null,
    ): Promise<SnowflakeQueryResult> {
      const start = performance.now()
      const resp = await executeStatement(sql, signal)
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)
      return {
        rows,
        schema: rowType.map(r => ({ name: r.name, type: r.type })),
        stats: {
          executionTimeMs: Math.round(performance.now() - start),
          rowCount: rows.length,
        },
      }
    },

    async runQueryPaginated(
      sql: string,
      batchSize: number = 5000,
      offset: number = 0,
      includeCount: boolean = true,
      signal?: AbortSignal | null,
    ): Promise<SnowflakePaginatedQueryResult> {
      const start = performance.now()

      const paginatedSql = `SELECT * FROM (${sql}) AS _sq LIMIT ${batchSize} OFFSET ${offset}`
      const resp = await executeStatement(paginatedSql, signal)
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)

      let totalRows: number | null = null
      if (includeCount && offset === 0) {
        try {
          const countResp = await executeStatement(`SELECT COUNT(*) AS cnt FROM (${sql}) AS _sq`, signal)
          const countRows = parseRows(countResp.data, countResp.resultSetMetaData?.rowType)
          totalRows = Number(countRows[0]?.cnt ?? 0)
        } catch {
          // Count failed — proceed without total
        }
      }

      const hasMore = rows.length === batchSize
      return {
        rows,
        columns: rowType.map(r => ({ name: r.name, type: r.type })),
        totalRows,
        hasMore,
        nextOffset: offset + rows.length,
        stats: {
          executionTimeMs: Math.round(performance.now() - start),
          rowCount: rows.length,
        },
      }
    },

    async fetchDatabases(): Promise<SnowflakeDatabaseInfo[]> {
      const resp = await executeStatement('SHOW DATABASES')
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)
      const nameIdx = rowType.findIndex(r => r.name.toLowerCase() === 'name')
      return rows
        .map(r => ({ name: String(Object.values(r)[nameIdx >= 0 ? nameIdx : 1] ?? '') }))
        .filter(d => !['SNOWFLAKE', 'SNOWFLAKE_SAMPLE_DATA'].includes(d.name.toUpperCase()))
    },

    async fetchSchemas(databaseName: string): Promise<SnowflakeSchemaInfo[]> {
      const resp = await executeStatement(`SHOW SCHEMAS IN DATABASE "${databaseName}"`)
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)
      const nameIdx = rowType.findIndex(r => r.name.toLowerCase() === 'name')
      return rows
        .map(r => ({ name: String(Object.values(r)[nameIdx >= 0 ? nameIdx : 1] ?? '') }))
        .filter(s => s.name !== 'INFORMATION_SCHEMA')
    },

    async fetchTables(): Promise<SnowflakeTableInfo[]> {
      // Query INFORMATION_SCHEMA across all non-system databases
      const dbs = await this.fetchDatabases()
      const allTables: SnowflakeTableInfo[] = []

      for (const db of dbs) {
        try {
          const resp = await executeStatement(
            `SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
             FROM "${db.name}".INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA != 'INFORMATION_SCHEMA'
             ORDER BY TABLE_SCHEMA, TABLE_NAME`,
          )
          const rowType = resp.resultSetMetaData?.rowType ?? []
          const rows = parseRows(resp.data, rowType)
          for (const row of rows) {
            allTables.push({
              databaseName: String(row.TABLE_CATALOG ?? db.name),
              schemaName: String(row.TABLE_SCHEMA ?? ''),
              name: String(row.TABLE_NAME ?? ''),
              type: String(row.TABLE_TYPE ?? '').includes('VIEW') ? 'view' : 'table',
            })
          }
        } catch {
          // Skip databases we can't access
        }
      }

      return allTables
    },

    async fetchColumns(
      databaseName: string,
      schemaName: string,
      tableName: string,
    ): Promise<SnowflakeColumnInfo[]> {
      const resp = await executeStatement(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM "${databaseName}".INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${tableName}'
         ORDER BY ORDINAL_POSITION`,
      )
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)
      return rows.map(row => ({
        name: String(row.COLUMN_NAME ?? ''),
        type: String(row.DATA_TYPE ?? ''),
        nullable: String(row.IS_NULLABLE ?? '') === 'YES',
      }))
    },

    async fetchAllColumns(): Promise<Record<string, SnowflakeColumnInfo[]>> {
      const dbs = await this.fetchDatabases()
      const result: Record<string, SnowflakeColumnInfo[]> = {}

      for (const db of dbs) {
        try {
          const resp = await executeStatement(
            `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
             FROM "${db.name}".INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA != 'INFORMATION_SCHEMA'
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
          )
          const rowType = resp.resultSetMetaData?.rowType ?? []
          const rows = parseRows(resp.data, rowType)
          for (const row of rows) {
            const key = `${db.name}.${row.TABLE_SCHEMA}.${row.TABLE_NAME}`
            if (!result[key]) result[key] = []
            result[key].push({
              name: String(row.COLUMN_NAME ?? ''),
              type: String(row.DATA_TYPE ?? ''),
              nullable: String(row.IS_NULLABLE ?? '') === 'YES',
            })
          }
        } catch {
          // Skip inaccessible databases
        }
      }

      return result
    },

    async fetchTableMetadata(
      databaseName: string,
      schemaName: string,
      tableName: string,
    ): Promise<{ rowCount: number | null; sizeBytes: number | null; tableType: string | null }> {
      const resp = await executeStatement(
        `SELECT ROW_COUNT, BYTES, TABLE_TYPE
         FROM "${databaseName}".INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${tableName}'`,
      )
      const rowType = resp.resultSetMetaData?.rowType ?? []
      const rows = parseRows(resp.data, rowType)
      const row = rows[0]
      return {
        rowCount: row?.ROW_COUNT != null ? Number(row.ROW_COUNT) : null,
        sizeBytes: row?.BYTES != null ? Number(row.BYTES) : null,
        tableType: row?.TABLE_TYPE ? String(row.TABLE_TYPE) : null,
      }
    },
  }
}
