import { describe, it, expect } from 'vitest'
import {
  extractNgrams,
  jaccardSimilarity,
  extractQueryIdentifiers,
  filterSchemaByRelevance,
  type SchemaItem,
} from './textSimilarity'

// =============================================================================
// N-gram Extraction Tests
// =============================================================================

describe('extractNgrams', () => {
  it('extracts bigrams from simple text', () => {
    expect(extractNgrams('user')).toEqual(new Set(['us', 'se', 'er']))
  })

  it('normalizes text to lowercase', () => {
    expect(extractNgrams('UserName')).toEqual(extractNgrams('username'))
  })

  it('handles underscores correctly', () => {
    const ngrams = extractNgrams('user_id')
    expect(ngrams.has('r_')).toBe(true)
    expect(ngrams.has('_i')).toBe(true)
  })

  it('returns empty set for single character', () => {
    expect(extractNgrams('x').size).toBe(0)
  })

  it('returns empty set for empty string', () => {
    expect(extractNgrams('').size).toBe(0)
  })

  it('strips special characters', () => {
    // Backticks, dots, and other special chars are removed
    const ngrams = extractNgrams('`user`.id')
    expect(ngrams).toEqual(extractNgrams('userid'))
  })

  it('supports custom n-gram size', () => {
    const trigrams = extractNgrams('hello', 3)
    expect(trigrams).toEqual(new Set(['hel', 'ell', 'llo']))
  })
})

// =============================================================================
// Jaccard Similarity Tests
// =============================================================================

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const set = new Set(['ab', 'bc', 'cd'])
    expect(jaccardSimilarity(set, set)).toBe(1)
  })

  it('returns 0 for disjoint sets', () => {
    const setA = new Set(['ab', 'bc'])
    const setB = new Set(['xy', 'yz'])
    expect(jaccardSimilarity(setA, setB)).toBe(0)
  })

  it('calculates correct similarity for partial overlap', () => {
    const setA = new Set(['ab', 'bc'])
    const setB = new Set(['ab', 'xy'])
    // Intersection: {ab} = 1
    // Union: {ab, bc, xy} = 3
    // Similarity = 1/3
    expect(jaccardSimilarity(setA, setB)).toBeCloseTo(1 / 3)
  })

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
  })

  it('returns 0 when one set is empty', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0)
    expect(jaccardSimilarity(new Set(), new Set(['a']))).toBe(0)
  })

  it('is symmetric', () => {
    const setA = new Set(['ab', 'bc', 'cd'])
    const setB = new Set(['bc', 'cd', 'de'])
    expect(jaccardSimilarity(setA, setB)).toBe(jaccardSimilarity(setB, setA))
  })
})

// =============================================================================
// Query Identifier Extraction Tests
// =============================================================================

describe('extractQueryIdentifiers', () => {
  it('extracts table names from FROM clause', () => {
    const ids = extractQueryIdentifiers('SELECT * FROM users')
    expect(ids).toContain('users')
  })

  it('extracts column names from SELECT clause', () => {
    const ids = extractQueryIdentifiers('SELECT user_id, email FROM accounts')
    expect(ids).toContain('user_id')
    expect(ids).toContain('email')
    expect(ids).toContain('accounts')
  })

  it('ignores SQL keywords', () => {
    const ids = extractQueryIdentifiers('SELECT id FROM users WHERE active = true')
    expect(ids).not.toContain('SELECT')
    expect(ids).not.toContain('select')
    expect(ids).not.toContain('FROM')
    expect(ids).not.toContain('from')
    expect(ids).not.toContain('WHERE')
    expect(ids).not.toContain('where')
    expect(ids).not.toContain('true')
  })

  it('ignores string literals (single quotes)', () => {
    const ids = extractQueryIdentifiers("SELECT * FROM users WHERE name = 'Alice'")
    expect(ids).not.toContain('Alice')
    expect(ids).toContain('users')
    expect(ids).toContain('name')
  })

  it('ignores string literals (double quotes)', () => {
    const ids = extractQueryIdentifiers('SELECT * FROM users WHERE name = "Bob"')
    expect(ids).not.toContain('Bob')
  })

  it('ignores line comments', () => {
    const ids = extractQueryIdentifiers(`
      SELECT * -- get all columns
      FROM users
    `)
    expect(ids).not.toContain('get')
    expect(ids).not.toContain('columns')
    expect(ids).toContain('users')
  })

  it('ignores block comments', () => {
    const ids = extractQueryIdentifiers(`
      SELECT * /* user table query */
      FROM users
    `)
    expect(ids).not.toContain('user')
    expect(ids).not.toContain('table')
    expect(ids).not.toContain('query')
    expect(ids).toContain('users')
  })

  it('handles backtick-quoted identifiers', () => {
    const ids = extractQueryIdentifiers('SELECT * FROM `my-project.dataset.users`')
    // Backticks are stripped, content is extracted as separate identifiers
    expect(ids).toContain('project')
    expect(ids).toContain('dataset')
    expect(ids).toContain('users')
  })

  it('extracts from complex queries with joins', () => {
    const ids = extractQueryIdentifiers(`
      SELECT u.name, o.total
      FROM users u
      JOIN orders o ON u.id = o.user_id
      WHERE o.status = 'completed'
    `)
    expect(ids).toContain('u')
    expect(ids).toContain('o')
    expect(ids).toContain('name')
    expect(ids).toContain('total')
    expect(ids).toContain('users')
    expect(ids).toContain('orders')
    expect(ids).toContain('id')
    expect(ids).toContain('user_id')
    expect(ids).toContain('status')
  })
})

// =============================================================================
// Schema Filtering Tests
// =============================================================================

describe('filterSchemaByRelevance', () => {
  // Sample schema for testing
  const mockSchema: SchemaItem[] = [
    {
      tableName: 'users',
      columns: [
        { name: 'id', type: 'INT' },
        { name: 'email', type: 'TEXT' },
        { name: 'name', type: 'TEXT' },
      ],
    },
    {
      tableName: 'orders',
      columns: [
        { name: 'id', type: 'INT' },
        { name: 'user_id', type: 'INT' },
        { name: 'total', type: 'DECIMAL' },
      ],
    },
    {
      tableName: 'products',
      columns: [
        { name: 'id', type: 'INT' },
        { name: 'name', type: 'TEXT' },
        { name: 'price', type: 'DECIMAL' },
      ],
    },
    {
      tableName: 'categories',
      columns: [
        { name: 'id', type: 'INT' },
        { name: 'label', type: 'TEXT' },
      ],
    },
  ]

  it('returns tables matching query identifiers', () => {
    const query = 'SELECT * FROM users WHERE email = ?'
    const results = filterSchemaByRelevance(query, mockSchema, 0.1)

    const tableNames = results.map((r) => r.tableName)
    expect(tableNames).toContain('users')
  })

  it('finds tables with misspelled identifiers', () => {
    // Typo: "usrs" instead of "users"
    // Note: threshold is low because column names dilute the Jaccard similarity
    const query = 'SELECT * FROM usrs'
    const results = filterSchemaByRelevance(query, mockSchema, 0.1)

    // "usrs" should still match "users" due to n-gram similarity
    const tableNames = results.map((r) => r.tableName)
    expect(tableNames).toContain('users')
  })

  it('finds tables with misspelled column names', () => {
    // Typo: "user_i" instead of "user_id"
    const query = 'SELECT user_i FROM orders'
    const results = filterSchemaByRelevance(query, mockSchema, 0.2)

    const tableNames = results.map((r) => r.tableName)
    expect(tableNames).toContain('orders')
  })

  it('respects the similarity threshold', () => {
    const query = 'SELECT * FROM xyz_completely_unrelated'

    // With high threshold, nothing should match
    const highThreshold = filterSchemaByRelevance(query, mockSchema, 0.9)
    expect(highThreshold.length).toBe(0)
  })

  it('sorts results by relevance score', () => {
    const query = 'SELECT user_id FROM users'
    const results = filterSchemaByRelevance(query, mockSchema, 0.1)

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('returns empty array for empty query', () => {
    const results = filterSchemaByRelevance('', mockSchema, 0.4)
    expect(results).toEqual([])
  })

  it('returns empty array for query with only keywords', () => {
    const results = filterSchemaByRelevance('SELECT * FROM WHERE', mockSchema, 0.4)
    expect(results).toEqual([])
  })

  it('handles empty schema gracefully', () => {
    const results = filterSchemaByRelevance('SELECT * FROM users', [], 0.4)
    expect(results).toEqual([])
  })

  it('includes score in results', () => {
    const query = 'SELECT * FROM users'
    const results = filterSchemaByRelevance(query, mockSchema, 0.1)

    for (const result of results) {
      expect(result).toHaveProperty('score')
      expect(typeof result.score).toBe('number')
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    }
  })
})

// =============================================================================
// Real-world Scenario Tests
// =============================================================================

describe('real-world scenarios', () => {
  const bigQuerySchema: SchemaItem[] = [
    {
      tableName: 'myproject.sales.customers',
      columns: [
        { name: 'customer_id', type: 'INT64' },
        { name: 'email', type: 'STRING' },
        { name: 'created_at', type: 'TIMESTAMP' },
      ],
    },
    {
      tableName: 'myproject.sales.orders',
      columns: [
        { name: 'order_id', type: 'INT64' },
        { name: 'customer_id', type: 'INT64' },
        { name: 'total_amount', type: 'FLOAT64' },
      ],
    },
    {
      tableName: 'myproject.analytics.events',
      columns: [
        { name: 'event_id', type: 'INT64' },
        { name: 'event_type', type: 'STRING' },
        { name: 'timestamp', type: 'TIMESTAMP' },
      ],
    },
  ]

  it('matches table when user forgets project prefix', () => {
    // User writes "customers" but schema has "myproject.sales.customers"
    const query = 'SELECT * FROM customers WHERE email = ?'
    const results = filterSchemaByRelevance(query, bigQuerySchema, 0.2)

    const tableNames = results.map((r) => r.tableName)
    expect(tableNames).toContain('myproject.sales.customers')
  })

  it('matches based on column names in JOIN', () => {
    const query = `
      SELECT c.email, o.total_amount
      FROM customerz c
      JOIN orderz o ON c.customer_id = o.customer_id
    `
    const results = filterSchemaByRelevance(query, bigQuerySchema, 0.2)

    const tableNames = results.map((r) => r.tableName)
    // Should match both tables due to column name similarity
    expect(tableNames).toContain('myproject.sales.customers')
    expect(tableNames).toContain('myproject.sales.orders')
  })

  it('handles complex aggregation query', () => {
    const query = `
      SELECT
        event_type,
        COUNT(*) as cnt
      FROM evnts
      GROUP BY event_type
      ORDER BY cnt DESC
    `
    const results = filterSchemaByRelevance(query, bigQuerySchema, 0.2)

    const tableNames = results.map((r) => r.tableName)
    expect(tableNames).toContain('myproject.analytics.events')
  })
})
