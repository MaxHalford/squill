export interface CsvLoadResult {
  tableName: string
  rows: Record<string, any>[]
  columns: string[]
  originalFileName: string
}

export async function parseCSVFile(
  file: File,
  existingTables: Record<string, any>
): Promise<CsvLoadResult> {
  // 1. Read file content
  const content = await readFileAsText(file)

  // 2. Parse CSV
  const rows = parseCSV(content)

  if (rows.length === 0) {
    throw new Error('CSV file is empty or has no data rows')
  }

  // 3. Generate unique table name
  const tableName = generateUniqueTableName(file.name, existingTables)

  // 4. Get column names from first row
  const columns = Object.keys(rows[0])

  return {
    tableName,
    rows,
    columns,
    originalFileName: file.name.replace('.csv', '')
  }
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function parseCSV(content: string): Record<string, any>[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0)

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row')
  }

  // Parse header
  const headers = parseCSVLine(lines[0])

  // Parse data rows
  const rows: Record<string, any>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])

    // Skip rows that don't have the right number of columns
    if (values.length !== headers.length) {
      continue
    }

    const row: Record<string, any> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = convertValue(values[j])
    }
    rows.push(row)
  }

  return rows
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"'
        i++ // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  // Add last field
  result.push(current.trim())

  return result
}

function convertValue(value: string): any {
  // Remove quotes if present
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/""/g, '"')
  }

  // Try to convert to number
  if (value && !isNaN(Number(value))) {
    return Number(value)
  }

  // Return as string
  return value
}

function generateUniqueTableName(
  filename: string,
  existingTables: Record<string, any>
): string {
  // Sanitize filename (remove .csv, lowercase, replace non-alphanumeric)
  const base = filename
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')

  // Find unique name
  let tableName = base
  let counter = 1
  while (tableName in existingTables) {
    tableName = `${base}_${counter}`
    counter++
  }

  return tableName
}
