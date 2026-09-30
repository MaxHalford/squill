import { describe, expect, it, vi } from 'vitest'
import { deleteSquillDuckDBFiles } from './opfsStorage'

describe('DuckDB OPFS cleanup', () => {
  it('deletes the database and sidecars without deleting unrelated origin files', async () => {
    const removeEntry = vi.fn(async () => undefined)
    const root = {
      async *keys() {
        yield 'squill.duckdb'
        yield 'squill.duckdb.wal'
        yield 'other-app.db'
        yield 'squill.duckdb-backup'
      },
      removeEntry,
    } as unknown as FileSystemDirectoryHandle

    await deleteSquillDuckDBFiles(root)

    expect(removeEntry).toHaveBeenCalledTimes(2)
    expect(removeEntry).toHaveBeenCalledWith('squill.duckdb', { recursive: true })
    expect(removeEntry).toHaveBeenCalledWith('squill.duckdb.wal', { recursive: true })
  })
})
