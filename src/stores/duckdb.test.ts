import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => {
  const statements: string[] = []
  const state = {
    failCreate: false,
    relations: new Set<string>(),
    importedFiles: new Map<string, string>(),
    gcRows: [] as Array<Record<string, unknown>>,
  }

  const result = (rows: Array<Record<string, unknown>> = [], columns: string[] = []) => ({
    toArray: () => rows,
    schema: { fields: columns.map(name => ({ name })) },
  })
  const unescapeSqlString = (value: string) => value.replace(/''/g, "'")
  const unescapeIdentifier = (value: string) => value.replace(/""/g, '"')

  const connection = {
    query: vi.fn(async (sql: string) => {
      const normalized = sql.trim()
      statements.push(normalized)

      if (normalized.includes('FROM pragma_database_size()')) {
        return result([{
          block_size: 262144n,
          total_blocks: 8n,
          free_blocks: 2n,
          wal_size: '512.0 KiB',
          memory_usage: '512.0 KiB',
          memory_limit: '1.0 GiB',
        }])
      }
      if (normalized.includes('FROM duckdb_tables()')) {
        return result([...state.relations].map(table_name => ({ table_name, row_count: 2n })))
      }
      if (normalized.includes('FROM information_schema.columns')) return result()
      if (normalized.includes('FROM information_schema.tables')) {
        if (normalized.includes('table_type')) return result(state.gcRows)
        return result([...state.relations].map(table_name => ({ table_name })))
      }
      if (normalized.startsWith('SELECT') && normalized.includes('FROM _imported_files')) {
        const whereMatch = normalized.match(/WHERE table_name = '((?:''|[^'])*)'/)
        const rows = [...state.importedFiles].map(([table_name, source_file_name]) => ({
          table_name,
          source_file_name,
        }))
        return result(whereMatch
          ? rows.filter(row => row.table_name === unescapeSqlString(whereMatch[1]))
          : rows)
      }
      if (state.failCreate && normalized.startsWith('CREATE TABLE "events" AS')) {
        throw new Error('invalid data')
      }
      const createMatch = normalized.match(/^CREATE TABLE "((?:""|[^"])*)" AS/)
      if (createMatch) state.relations.add(unescapeIdentifier(createMatch[1]))

      const insertRegistryMatch = normalized.match(
        /INSERT INTO _imported_files[\s\S]*?VALUES\s*\(\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'/,
      )
      if (insertRegistryMatch) {
        state.importedFiles.set(
          unescapeSqlString(insertRegistryMatch[1]),
          unescapeSqlString(insertRegistryMatch[2]),
        )
      }

      const dropMatch = normalized.match(/^DROP TABLE IF EXISTS "((?:""|[^"])*)"/)
      if (dropMatch) state.relations.delete(unescapeIdentifier(dropMatch[1]))

      if (normalized === 'DELETE FROM _imported_files') state.importedFiles.clear()
      const deleteRegistryMatch = normalized.match(
        /^DELETE FROM _imported_files WHERE table_name = '((?:''|[^'])*)'/,
      )
      if (deleteRegistryMatch) {
        state.importedFiles.delete(unescapeSqlString(deleteRegistryMatch[1]))
      }

      if (normalized.startsWith('SELECT COUNT(*) AS count')) return result([{ count: 2n }])
      if (/^SELECT \* FROM ".+" LIMIT 0$/.test(normalized)) return result([], ['id', 'name'])
      if (/^DESCRIBE ".+"$/.test(normalized)) {
        return result([
          { column_name: 'id', column_type: 'BIGINT' },
          { column_name: 'name', column_type: 'VARCHAR' },
        ])
      }
      return result()
    }),
  }

  const database = {
    instantiate: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    connect: vi.fn(async () => connection),
    registerFileHandle: vi.fn(async () => undefined),
    dropFile: vi.fn(async () => undefined),
    flushFiles: vi.fn(async () => undefined),
  }

  return { connection, database, state, statements }
})

vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: class {
    instantiate = mocks.database.instantiate
    open = mocks.database.open
    connect = mocks.database.connect
    registerFileHandle = mocks.database.registerFileHandle
    dropFile = mocks.database.dropFile
    flushFiles = mocks.database.flushFiles
  },
  ConsoleLogger: class {},
  DuckDBAccessMode: { READ_WRITE: 3 },
  DuckDBDataProtocol: { BROWSER_FILEREADER: 2 },
}))

import { useDuckDBStore } from './duckdb'

describe('DuckDB local data imports', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.state.failCreate = false
    mocks.state.relations.clear()
    mocks.state.importedFiles.clear()
    mocks.state.gcRows = []
    mocks.statements.length = 0
    vi.clearAllMocks()
    vi.stubGlobal('Worker', class {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('materializes a file, registers metadata, and refreshes usage', async () => {
    const store = useDuckDBStore()
    await store.initialize()
    mocks.statements.length = 0

    const file = new File(['id,name\n1,Ada'], 'Events.csv', { type: 'text/csv' })
    const imported = await store.importLocalDataFile(file)

    expect(imported).toEqual({
      tableName: 'events',
      rowCount: 2,
      columns: ['id', 'name'],
      sourceFileName: 'Events.csv',
      format: 'csv',
    })
    expect(mocks.database.registerFileHandle).toHaveBeenCalledWith(
      expect.stringContaining('_local_import_'),
      file,
      2,
      true,
    )
    expect(mocks.statements).toContainEqual(
      expect.stringMatching(/^CREATE TABLE "events" AS SELECT \* FROM read_csv_auto\('/),
    )
    expect(mocks.statements.some(sql => sql.includes('INSERT INTO _imported_files'))).toBe(true)
    const beginIndex = mocks.statements.indexOf('BEGIN TRANSACTION')
    const createIndex = mocks.statements.findIndex(sql => sql.startsWith('CREATE TABLE "events" AS'))
    const registryIndex = mocks.statements.findIndex(sql => sql.includes('INSERT INTO _imported_files'))
    const commitIndex = mocks.statements.indexOf('COMMIT')
    expect(beginIndex).toBeLessThan(createIndex)
    expect(createIndex).toBeLessThan(registryIndex)
    expect(registryIndex).toBeLessThan(commitIndex)
    expect(store.importedTables).toEqual([{
      tableName: 'events',
      sourceFileName: 'Events.csv',
      rowCount: 2,
    }])
    expect(store.databaseUsage?.browserStorageBytes).toBe(2621440)
    expect(store.databaseUsage?.memoryUsage).toBe('512.0 KiB')
    expect(store.databaseUsageError).toBeNull()
    expect(mocks.database.dropFile).toHaveBeenCalledOnce()
  })

  it('uses unique table names across supported file extensions', async () => {
    const store = useDuckDBStore()
    await store.initialize()

    const first = await store.importLocalDataFile(new File(['a'], 'events.parquet'))
    const second = await store.importLocalDataFile(new File(['{}'], 'events.ndjson'))

    expect(first.tableName).toBe('events')
    expect(second.tableName).toBe('events_1')
    expect(mocks.statements).toContainEqual(
      expect.stringMatching(/^CREATE TABLE "events" AS SELECT \* FROM read_parquet\('/),
    )
    expect(mocks.statements).toContainEqual(
      expect.stringMatching(/^CREATE TABLE "events_1" AS SELECT \* FROM read_json_auto\('/),
    )
  })

  it('rolls back and unregisters the browser file when DuckDB rejects it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = useDuckDBStore()
    await store.initialize()
    mocks.state.failCreate = true

    await expect(store.importLocalDataFile(new File(['bad'], 'events.tsv')))
      .rejects.toThrow('Failed to import events.tsv: invalid data')

    expect(mocks.statements).toContain('ROLLBACK')
    expect(mocks.database.dropFile).toHaveBeenCalledOnce()
    expect(store.tables.events).toBeUndefined()
    expect(mocks.state.importedFiles.has('events')).toBe(false)
  })

  it('removes an imported table and its registry row in one transaction', async () => {
    const store = useDuckDBStore()
    await store.initialize()
    await store.importLocalDataFile(new File(['[]'], 'events.json'))
    const previousSchemaVersion = store.schemaVersion
    mocks.statements.length = 0

    await expect(store.removeImportedTable('events')).resolves.toBe(true)

    expect(mocks.statements).toEqual(expect.arrayContaining([
      'BEGIN TRANSACTION',
      'DROP TABLE IF EXISTS "events"',
      "DELETE FROM _imported_files WHERE table_name = 'events'",
      'COMMIT',
    ]))
    expect(store.tables.events).toBeUndefined()
    expect(store.schemaVersion).toBe(previousSchemaVersion + 1)
    expect(mocks.state.importedFiles.has('events')).toBe(false)
  })

  it('clears only registered imports and preserves other and internal tables', async () => {
    mocks.state.relations = new Set(['import_one', 'import_two', 'query_result', '_schemas', '_imported_files'])
    mocks.state.importedFiles.set('import_one', 'one.csv')
    mocks.state.importedFiles.set('import_two', 'two.jsonl')
    const store = useDuckDBStore()
    await store.initialize()
    mocks.statements.length = 0

    await expect(store.clearImportedTables()).resolves.toBe(2)

    const drops = mocks.statements.filter(sql => sql.startsWith('DROP TABLE'))
    expect(drops).toEqual([
      'DROP TABLE IF EXISTS "import_one"',
      'DROP TABLE IF EXISTS "import_two"',
    ])
    expect(mocks.state.relations).toEqual(new Set(['query_result', '_schemas', '_imported_files']))
    expect(store.tables.query_result).toBeDefined()
  })

  it('retains registered imports during orphan garbage collection', async () => {
    mocks.state.relations.add('events')
    mocks.state.importedFiles.set('events', 'events.csv')
    mocks.state.gcRows = [{ table_name: 'events', table_type: 'BASE TABLE' }]
    const store = useDuckDBStore()
    await store.initialize()
    mocks.statements.length = 0

    await store.garbageCollect(new Set())

    expect(mocks.statements.some(sql => sql.startsWith('DROP TABLE'))).toBe(false)
  })
})
