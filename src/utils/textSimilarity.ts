/**
 * Text similarity utilities for SQL query analysis
 * Uses n-grams and Jaccard similarity to find relevant schema items
 */

/**
 * Extract character-level n-grams from a string
 * @param text - Input string
 * @param n - Size of n-grams (default 2 for bigrams)
 * @returns Set of n-grams
 */
export function extractNgrams(text: string, n: number = 2): Set<string> {
  // Normalize: lowercase, keep only alphanumeric and underscores
  const normalized = text.toLowerCase().replace(/[^a-z0-9_]/g, '')
  const ngrams = new Set<string>()

  for (let i = 0; i <= normalized.length - n; i++) {
    ngrams.add(normalized.slice(i, i + n))
  }

  return ngrams
}

/**
 * Calculate Jaccard similarity between two sets
 * @returns Similarity score between 0 and 1
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0
  if (setA.size === 0 || setB.size === 0) return 0

  let intersectionSize = 0
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++
  }

  const unionSize = setA.size + setB.size - intersectionSize
  return intersectionSize / unionSize
}

// SQL keywords to exclude when extracting identifiers
const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'on', 'and', 'or', 'not',
  'in', 'is', 'null', 'like', 'between', 'order', 'by', 'group',
  'having', 'limit', 'offset', 'as', 'inner', 'left', 'right',
  'outer', 'cross', 'union', 'all', 'distinct', 'case', 'when',
  'then', 'else', 'end', 'asc', 'desc', 'true', 'false', 'insert',
  'update', 'delete', 'create', 'drop', 'alter', 'table', 'index',
  'values', 'set', 'into', 'with', 'count', 'sum', 'avg', 'min', 'max',
  'over', 'partition', 'row', 'rows', 'range', 'unbounded', 'preceding',
  'following', 'current', 'first', 'last', 'nulls', 'filter', 'within',
  'array', 'struct', 'unnest', 'exists', 'any', 'some', 'cast', 'coalesce',
  'ifnull', 'nullif', 'if', 'extract', 'date', 'timestamp', 'interval',
  'year', 'month', 'day', 'hour', 'minute', 'second', 'using', 'natural',
  'full', 'except', 'intersect', 'rollup', 'cube', 'grouping', 'sets',
])

/**
 * Extract identifiers (table/column names) from a SQL query
 * Excludes SQL keywords and string literals
 */
export function extractQueryIdentifiers(query: string): string[] {
  // Remove string literals (single and double quoted)
  let cleaned = query.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
  // Remove line comments
  cleaned = cleaned.replace(/--.*$/gm, '')
  // Remove block comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove backticks (but keep content)
  cleaned = cleaned.replace(/`/g, '')

  const identifiers: string[] = []
  const pattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g

  let match
  while ((match = pattern.exec(cleaned)) !== null) {
    const word = match[0]
    if (!SQL_KEYWORDS.has(word.toLowerCase())) {
      identifiers.push(word)
    }
  }

  return identifiers
}

/**
 * Schema item representing a table with its columns
 */
export interface SchemaItem {
  tableName: string
  columns: { name: string; type: string }[]
}

/**
 * Schema item with similarity score
 */
export interface ScoredSchemaItem extends SchemaItem {
  score: number
}

/**
 * Filter schema items by relevance to a query using n-gram Jaccard similarity
 * @param query - The SQL query to analyze
 * @param schema - Array of schema items to filter
 * @param threshold - Minimum similarity score to include (default 0.4)
 * @returns Filtered schema items with scores, sorted by relevance
 */
export function filterSchemaByRelevance(
  query: string,
  schema: SchemaItem[],
  threshold: number = 0.4
): ScoredSchemaItem[] {
  const queryIdentifiers = extractQueryIdentifiers(query)

  // Build combined n-gram set from all query identifiers
  const queryNgrams = new Set<string>()
  for (const id of queryIdentifiers) {
    for (const ngram of extractNgrams(id)) {
      queryNgrams.add(ngram)
    }
  }

  // If no identifiers found, return empty array
  if (queryNgrams.size === 0) {
    return []
  }

  // Score each table
  const scored: ScoredSchemaItem[] = []

  for (const item of schema) {
    // Build n-gram set from table name and all column names
    const itemNgrams = new Set<string>()
    for (const ngram of extractNgrams(item.tableName)) {
      itemNgrams.add(ngram)
    }
    for (const col of item.columns) {
      for (const ngram of extractNgrams(col.name)) {
        itemNgrams.add(ngram)
      }
    }

    const score = jaccardSimilarity(queryNgrams, itemNgrams)

    if (score >= threshold) {
      scored.push({ ...item, score })
    }
  }

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score)
}
