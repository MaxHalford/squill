export function generateSelectQuery(
  tableName: string,
  _engine: 'bigquery' | 'duckdb',
  limit: number = 100
): string {
  let escapedName = tableName

  return `SELECT *\nFROM ${escapedName}\nLIMIT ${limit}`
}

export function generateQueryBoxName(tableName: string): string {
  // Extract simple table name (last part after dots)
  const simpleName = tableName.split('.').pop()?.replace(/`/g, '') || tableName
  return simpleName
}
