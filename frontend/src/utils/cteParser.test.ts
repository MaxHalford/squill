import { describe, it, expect } from 'vitest'
import { hasCTEs, computeExplodeLayout } from './cteParser'
import type { ExplodedQuery, ParsedCTE } from './cteParser'

// =============================================================================
// hasCTEs — quick regex check
// =============================================================================

describe('hasCTEs', () => {
  it('returns true for simple WITH query', () => {
    expect(hasCTEs('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
  })

  it('returns true case-insensitive', () => {
    expect(hasCTEs('with cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
    expect(hasCTEs('With cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
  })

  it('returns true with leading whitespace', () => {
    expect(hasCTEs('  \n  WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
  })

  it('returns false for plain SELECT', () => {
    expect(hasCTEs('SELECT * FROM users')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasCTEs('')).toBe(false)
  })

  it('returns false when WITH appears mid-query', () => {
    expect(hasCTEs('SELECT * FROM users WITH (NOLOCK)')).toBe(false)
  })

  it('returns true for WITH followed by RECURSIVE', () => {
    expect(hasCTEs('WITH RECURSIVE tree AS (SELECT 1 UNION ALL SELECT n+1 FROM tree) SELECT * FROM tree')).toBe(true)
  })

  it('returns true for multiline CTE with VALUES clause', () => {
    const query = `WITH characters AS (
    SELECT * FROM (
        VALUES ('Eleven', 'Main', 1), ('Mike', 'Main', 1)
    ) AS characters(name, role, season)
)
SELECT * FROM characters`
    expect(hasCTEs(query)).toBe(true)
  })
})

// =============================================================================
// computeExplodeLayout — topological layout
// =============================================================================

const mkCTE = (name: string, body: string, referencedCTEs: string[] = []): ParsedCTE => ({
  name,
  body,
  referencedCTEs,
})

describe('computeExplodeLayout', () => {
  const startX = 100
  const startY = 100
  const origHeight = 500
  const BOX_W = 600
  const BOX_H = 500
  const H_GAP = 80
  const V_GAP = 60

  it('handles single CTE + final query', () => {
    const exploded: ExplodedQuery = {
      ctes: [mkCTE('users', 'SELECT * FROM raw_users')],
      finalQuery: 'SELECT * FROM users',
    }

    const layout = computeExplodeLayout(exploded, 'my_query', startX, startY, origHeight)

    expect(layout.items).toHaveLength(2)

    const cteItem = layout.items[0]
    expect(cteItem.name).toBe('users')
    expect(cteItem.query).toBe('SELECT * FROM raw_users')
    expect(cteItem.x).toBe(startX)

    const finalItem = layout.items[1]
    expect(finalItem.name).toBe('my_query')
    expect(finalItem.query).toBe('SELECT * FROM users')
    expect(finalItem.x).toBe(startX + BOX_W + H_GAP)
  })

  it('handles linear CTE chain: a → b → final', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('a', 'SELECT 1'),
        mkCTE('b', 'SELECT * FROM a', ['a']),
      ],
      finalQuery: 'SELECT * FROM b',
    }

    const layout = computeExplodeLayout(exploded, 'result', startX, startY, origHeight)

    expect(layout.items).toHaveLength(3)

    const a = layout.items.find(i => i.name === 'a')!
    const b = layout.items.find(i => i.name === 'b')!
    const final_ = layout.items.find(i => i.name === 'result')!

    expect(a.x).toBe(startX)
    expect(b.x).toBe(startX + (BOX_W + H_GAP))
    expect(final_.x).toBe(startX + 2 * (BOX_W + H_GAP))
  })

  it('handles diamond dependency: a, b → c (depends on a and b) → final', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('a', 'SELECT 1'),
        mkCTE('b', 'SELECT 2'),
        mkCTE('c', 'SELECT * FROM a JOIN b', ['a', 'b']),
      ],
      finalQuery: 'SELECT * FROM c',
    }

    const layout = computeExplodeLayout(exploded, 'out', startX, startY, origHeight)

    expect(layout.items).toHaveLength(4)

    const a = layout.items.find(i => i.name === 'a')!
    const b = layout.items.find(i => i.name === 'b')!
    const c = layout.items.find(i => i.name === 'c')!
    const final_ = layout.items.find(i => i.name === 'out')!

    // a and b at level 0, c at level 1, final at level 2
    expect(a.x).toBe(startX)
    expect(b.x).toBe(startX)
    expect(c.x).toBe(startX + (BOX_W + H_GAP))
    expect(final_.x).toBe(startX + 2 * (BOX_W + H_GAP))

    // a and b vertically stacked, centred on the original Y center
    const centerY = startY + origHeight / 2
    const totalH = 2 * BOX_H + V_GAP
    const expectedStartY = centerY - totalH / 2
    expect(a.y).toBe(expectedStartY)
    expect(b.y).toBe(expectedStartY + BOX_H + V_GAP)
  })

  it('handles single CTE with no final query', () => {
    const exploded: ExplodedQuery = {
      ctes: [mkCTE('a', 'SELECT 1')],
      finalQuery: '',
    }

    const layout = computeExplodeLayout(exploded, 'my_box', startX, startY, origHeight)

    expect(layout.items).toHaveLength(1)
    expect(layout.items[0].name).toBe('a')
  })

  it('uses custom box dimensions', () => {
    const exploded: ExplodedQuery = {
      ctes: [mkCTE('a', 'SELECT 1')],
      finalQuery: 'SELECT * FROM a',
    }

    const customW = 400
    const customH = 300
    const customHGap = 50

    const layout = computeExplodeLayout(
      exploded, 'out', startX, startY, origHeight,
      customW, customH, customHGap,
    )

    const final_ = layout.items.find(i => i.name === 'out')!
    expect(final_.x).toBe(startX + customW + customHGap)
  })

  it('preserves CTE order within same level', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('first', 'SELECT 1'),
        mkCTE('second', 'SELECT 2'),
        mkCTE('third', 'SELECT 3'),
      ],
      finalQuery: 'SELECT * FROM first, second, third',
    }

    const layout = computeExplodeLayout(exploded, 'out', startX, startY, origHeight)

    const level0 = layout.items.filter(i => i.x === startX)
    expect(level0.map(i => i.name)).toEqual(['first', 'second', 'third'])
    expect(level0[0].y).toBeLessThan(level0[1].y)
    expect(level0[1].y).toBeLessThan(level0[2].y)
  })

  it('handles deep chain (3 levels)', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('raw', 'SELECT 1'),
        mkCTE('clean', 'SELECT * FROM raw', ['raw']),
        mkCTE('final_cte', 'SELECT * FROM clean', ['clean']),
      ],
      finalQuery: 'SELECT * FROM final_cte',
    }

    const layout = computeExplodeLayout(exploded, 'result', startX, startY, origHeight)

    expect(layout.items).toHaveLength(4)

    const raw = layout.items.find(i => i.name === 'raw')!
    const clean = layout.items.find(i => i.name === 'clean')!
    const finalCte = layout.items.find(i => i.name === 'final_cte')!
    const result = layout.items.find(i => i.name === 'result')!

    expect(raw.x).toBeLessThan(clean.x)
    expect(clean.x).toBeLessThan(finalCte.x)
    expect(finalCte.x).toBeLessThan(result.x)
  })

  // ---------------------------------------------------------------------------
  // Real-world query shapes (simulating SQLGlot output)
  // ---------------------------------------------------------------------------

  it('handles single CTE with VALUES clause (Stranger Things query)', () => {
    // Simulates SQLGlot output for:
    // WITH characters AS (SELECT * FROM (VALUES ...) AS characters(...))
    // SELECT * FROM characters
    const exploded: ExplodedQuery = {
      ctes: [mkCTE(
        'characters',
        "SELECT * FROM (VALUES ('Eleven', 'Millie Bobby Brown', 'Main', 1)) AS characters(character_name, actor_name, role_type, first_appearance_season)",
      )],
      finalQuery: 'SELECT * FROM characters',
    }

    const layout = computeExplodeLayout(exploded, 'my_query', startX, startY, origHeight)

    expect(layout.items).toHaveLength(2)
    expect(layout.items[0].name).toBe('characters')
    expect(layout.items[1].name).toBe('my_query')
    expect(layout.items[0].x).toBeLessThan(layout.items[1].x)
  })

  it('handles analytics pipeline pattern: raw → enriched → aggregated → final', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('raw_events', 'SELECT * FROM events WHERE date > CURRENT_DATE - 30'),
        mkCTE('enriched', 'SELECT e.*, u.name FROM raw_events e JOIN users u ON e.user_id = u.id', ['raw_events']),
        mkCTE('aggregated', 'SELECT name, COUNT(*) AS event_count FROM enriched GROUP BY name', ['enriched']),
      ],
      finalQuery: 'SELECT * FROM aggregated ORDER BY event_count DESC LIMIT 10',
    }

    const layout = computeExplodeLayout(exploded, 'top_users', startX, startY, origHeight)

    expect(layout.items).toHaveLength(4)

    const raw = layout.items.find(i => i.name === 'raw_events')!
    const enriched = layout.items.find(i => i.name === 'enriched')!
    const agg = layout.items.find(i => i.name === 'aggregated')!
    const final_ = layout.items.find(i => i.name === 'top_users')!

    // 4 columns: level 0 → 1 → 2 → final
    expect(raw.x).toBeLessThan(enriched.x)
    expect(enriched.x).toBeLessThan(agg.x)
    expect(agg.x).toBeLessThan(final_.x)

    // Each is alone in its level → same vertical center
    const centerY = startY + origHeight / 2
    const boxCenterY = centerY - BOX_H / 2
    expect(raw.y).toBe(boxCenterY)
    expect(enriched.y).toBe(boxCenterY)
    expect(agg.y).toBe(boxCenterY)
    expect(final_.y).toBe(boxCenterY)
  })

  it('handles fan-in pattern: multiple independent sources joined at end', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('customers', 'SELECT * FROM raw_customers'),
        mkCTE('orders', 'SELECT * FROM raw_orders'),
        mkCTE('products', 'SELECT * FROM raw_products'),
        mkCTE('summary', 'SELECT c.name, COUNT(o.id) FROM customers c JOIN orders o ON c.id = o.cust_id JOIN products p ON o.prod_id = p.id GROUP BY c.name', ['customers', 'orders', 'products']),
      ],
      finalQuery: 'SELECT * FROM summary',
    }

    const layout = computeExplodeLayout(exploded, 'report', startX, startY, origHeight)

    expect(layout.items).toHaveLength(5)

    const customers = layout.items.find(i => i.name === 'customers')!
    const orders = layout.items.find(i => i.name === 'orders')!
    const products = layout.items.find(i => i.name === 'products')!
    const summary = layout.items.find(i => i.name === 'summary')!
    const report = layout.items.find(i => i.name === 'report')!

    // 3 sources at level 0, summary at level 1, report at level 2
    expect(customers.x).toBe(startX)
    expect(orders.x).toBe(startX)
    expect(products.x).toBe(startX)
    expect(summary.x).toBe(startX + (BOX_W + H_GAP))
    expect(report.x).toBe(startX + 2 * (BOX_W + H_GAP))

    // The 3 sources should be vertically stacked
    const level0 = [customers, orders, products]
    expect(level0[0].y).toBeLessThan(level0[1].y)
    expect(level0[1].y).toBeLessThan(level0[2].y)
  })

  it('handles mixed levels: independent CTEs at different depths', () => {
    // a (level 0) → c (level 1)
    // b (level 0, independent)
    // final references c and b
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('a', 'SELECT 1'),
        mkCTE('b', 'SELECT 2'),
        mkCTE('c', 'SELECT * FROM a', ['a']),
      ],
      finalQuery: 'SELECT * FROM c JOIN b',
    }

    const layout = computeExplodeLayout(exploded, 'out', startX, startY, origHeight)

    const a = layout.items.find(i => i.name === 'a')!
    const b = layout.items.find(i => i.name === 'b')!
    const c = layout.items.find(i => i.name === 'c')!

    // a and b are level 0, c is level 1
    expect(a.x).toBe(startX)
    expect(b.x).toBe(startX)
    expect(c.x).toBe(startX + (BOX_W + H_GAP))
  })

  it('handles cycle in dependencies gracefully (treats as level 0)', () => {
    // In practice cycles shouldn't happen in CTEs, but the layout
    // should not hang or crash
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('a', 'SELECT * FROM b', ['b']),
        mkCTE('b', 'SELECT * FROM a', ['a']),
      ],
      finalQuery: 'SELECT * FROM a',
    }

    const layout = computeExplodeLayout(exploded, 'out', startX, startY, origHeight)

    // Should not hang; both placed somewhere
    expect(layout.items).toHaveLength(3)
    expect(layout.items.find(i => i.name === 'a')).toBeTruthy()
    expect(layout.items.find(i => i.name === 'b')).toBeTruthy()
  })

  it('case-insensitive dependency resolution', () => {
    const exploded: ExplodedQuery = {
      ctes: [
        mkCTE('Users', 'SELECT 1'),
        mkCTE('Orders', 'SELECT * FROM Users', ['Users']),
      ],
      finalQuery: 'SELECT * FROM Orders',
    }

    const layout = computeExplodeLayout(exploded, 'out', startX, startY, origHeight)

    const users = layout.items.find(i => i.name === 'Users')!
    const orders = layout.items.find(i => i.name === 'Orders')!

    // Users at level 0, Orders at level 1
    expect(users.x).toBeLessThan(orders.x)
  })
})
