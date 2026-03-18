export function generateSelectQuery(
  tableName: string,
  _engine?: string
): string {
  return `SELECT *\nFROM ${tableName}`
}

export function generateQueryBoxName(tableName: string): string {
  // Extract simple table name (last part after dots)
  const simpleName = tableName.split('.').pop()?.replace(/`/g, '') || tableName
  return simpleName
}
