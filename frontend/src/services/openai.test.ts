import { describe, expect, it, vi } from 'vitest'
import { buildFixInput, formatRelevantSchema, parseFixResponse, suggestSqlFix } from './openai'

describe('OpenAI SQL line fixer', () => {
  it('numbers query lines and includes only relevant schema', () => {
    const input = buildFixInput({
      query: 'SELECT customer_id\nFROM orders',
      errorMessage: 'column customer_id must be grouped',
      databaseDialect: 'duckdb',
      schema: {
        orders: ['order_id', 'customer_id'],
        products: ['product_id', 'price'],
      },
      sampleQueries: ['SELECT * FROM orders'],
    })

    expect(input).toContain('1: SELECT customer_id')
    expect(input).toContain('2: FROM orders')
    expect(input).toContain('orders (order_id, customer_id)')
    expect(input).not.toContain('products (product_id, price)')
    expect(input).toContain('RECENT SUCCESSFUL QUERIES')
  })

  it('flattens qualified schema names', () => {
    expect(formatRelevantSchema({ project: { dataset: { events: ['event_id'] } } }, 'FROM project.dataset.events'))
      .toBe('project.dataset.events (event_id)')
  })

  it('derives the original line and validates a replacement', () => {
    const suggestion = parseFixResponse({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            line_number: 2,
            suggestion: 'FROM orders',
            action: 'replace',
            no_relevant_fix: false,
          }),
        }],
      }],
    }, 'SELECT *\nFORM orders')

    expect(suggestion).toMatchObject({
      line: 2,
      original: 'FORM orders',
      suggestion: 'FROM orders',
      action: 'replace',
    })
  })

  it('rejects multi-line suggestions', () => {
    expect(() => parseFixResponse({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            line_number: 1,
            suggestion: 'SELECT 1\nSELECT 2',
            action: 'replace',
            no_relevant_fix: false,
          }),
        }],
      }],
    }, 'SELECT 0')).toThrow('invalid fix suggestion')
  })

  it('sends a non-stored structured Responses API request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            line_number: 1,
            suggestion: 'SELECT 1',
            action: 'replace',
            no_relevant_fix: false,
          }),
        }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await suggestSqlFix({
      apiKey: 'sk-test',
      query: 'SELEC 1',
      errorMessage: 'syntax error',
      databaseDialect: 'duckdb',
    }, fetcher)

    const [, init] = fetcher.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body.store).toBe(false)
    expect(body.text.format.type).toBe('json_schema')
  })
})
