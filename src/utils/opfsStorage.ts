export const SQUILL_DUCKDB_FILE = 'squill.duckdb'

/** Remove the DuckDB database and its sidecar files without touching other origin files. */
export async function deleteSquillDuckDBFiles(root: FileSystemDirectoryHandle): Promise<void> {
  for await (const name of root.keys()) {
    if (name === SQUILL_DUCKDB_FILE || name.startsWith(`${SQUILL_DUCKDB_FILE}.`)) {
      await root.removeEntry(name, { recursive: true })
    }
  }
}
