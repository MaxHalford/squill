import { describe, it, expect } from 'vitest'
import { parsePlan } from './planParser'

describe('parsePlan', () => {
  describe('duckdb', () => {
    it('parses regular EXPLAIN (FORMAT json) output', () => {
      const raw = [
        {
          name: 'PROJECTION',
          children: [
            {
              name: 'DUMMY_SCAN',
              children: [],
              extra_info: {},
            },
          ],
          extra_info: {
            Projections: 'x',
            'Estimated Cardinality': '1',
          },
        },
      ]

      const tree = parsePlan('duckdb', raw)
      expect(tree).not.toBeNull()
      expect(tree!.operator).toBe('PROJECTION')
      expect(tree!.rows).toBe(1) // from Estimated Cardinality
      expect(tree!.children).toHaveLength(1)
      expect(tree!.children[0].operator).toBe('DUMMY_SCAN')
    })

    it('parses EXPLAIN (ANALYZE, FORMAT JSON) output, skipping wrappers', () => {
      // Real output from: EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM range(100) t(x) WHERE x > 50
      const raw = {
        result_set_size: 0,
        cumulative_rows_scanned: 0,
        cumulative_cardinality: 0,
        extra_info: {},
        cpu_time: 0.0,
        blocked_thread_time: 0.0,
        rows_returned: 0,
        query_name: '',
        latency: 0.0,
        children: [
          {
            result_set_size: 0,
            operator_timing: 0.000001,
            operator_rows_scanned: 0,
            cumulative_rows_scanned: 0,
            operator_cardinality: 0,
            operator_type: 'EXPLAIN_ANALYZE',
            cumulative_cardinality: 0,
            cpu_time: 0.0,
            operator_name: 'EXPLAIN_ANALYZE',
            extra_info: {},
            children: [
              {
                operator_name: 'FILTER',
                cpu_time: 0.0,
                extra_info: {
                  Expression: '(x > 50)',
                  'Estimated Cardinality': '20',
                },
                cumulative_cardinality: 0,
                operator_type: 'FILTER',
                operator_cardinality: 49,
                cumulative_rows_scanned: 0,
                operator_rows_scanned: 0,
                operator_timing: 0.001139,
                result_set_size: 392,
                children: [
                  {
                    result_set_size: 800,
                    operator_timing: 0.0002,
                    operator_rows_scanned: 100,
                    cumulative_rows_scanned: 0,
                    operator_cardinality: 100,
                    operator_type: 'TABLE_SCAN',
                    cumulative_cardinality: 0,
                    cpu_time: 0.0,
                    operator_name: 'RANGE ',
                    extra_info: {
                      Function: 'RANGE',
                      'Estimated Cardinality': '100',
                    },
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      }

      const tree = parsePlan('duckdb', raw)
      expect(tree).not.toBeNull()
      // Should skip the virtual root and EXPLAIN_ANALYZE wrapper
      expect(tree!.operator).toBe('FILTER')
      expect(tree!.operator).not.toBe('EXPLAIN_ANALYZE')
      expect(tree!.rows).toBe(49) // actual operator_cardinality
      expect(tree!.durationMs).toBeCloseTo(1.139, 2) // operator_timing * 1000
      expect(tree!.children).toHaveLength(1)
      expect(tree!.children[0].operator).toBe('TABLE_SCAN')
      expect(tree!.children[0].rows).toBe(100)
      expect(tree!.children[0].durationMs).toBeCloseTo(0.2, 2)
    })

    it('prefers actual cardinality over estimated', () => {
      const raw = [
        {
          operator_type: 'PROJECTION',
          operator_cardinality: 42,
          operator_timing: 0.001,
          extra_info: { 'Estimated Cardinality': '100' },
          children: [],
        },
      ]

      const tree = parsePlan('duckdb', raw)
      expect(tree!.rows).toBe(42) // actual, not 100 estimated
    })

    it('returns null for empty input', () => {
      expect(parsePlan('duckdb', null)).toBeNull()
      expect(parsePlan('duckdb', [])).toBeNull()
      expect(parsePlan('duckdb', '')).toBeNull()
    })
  })

  describe('postgres', () => {
    it('parses EXPLAIN (ANALYZE, FORMAT JSON) output', () => {
      const raw = [
        {
          Plan: {
            'Node Type': 'Seq Scan',
            'Relation Name': 'users',
            'Plan Rows': 100,
            'Actual Rows': 87,
            'Total Cost': 12.5,
            'Actual Total Time': 0.45,
            Plans: [
              {
                'Node Type': 'Index Scan',
                'Index Name': 'users_pkey',
                'Plan Rows': 1,
                'Actual Rows': 1,
                'Total Cost': 0.29,
                'Actual Total Time': 0.01,
              },
            ],
          },
        },
      ]

      const tree = parsePlan('postgres', raw)
      expect(tree).not.toBeNull()
      expect(tree!.operator).toBe('Seq Scan')
      expect(tree!.table).toBe('users')
      expect(tree!.rows).toBe(87) // prefers Actual Rows
      expect(tree!.durationMs).toBe(0.45)
      expect(tree!.cost).toBe(12.5)
      expect(tree!.children).toHaveLength(1)
      expect(tree!.children[0].operator).toBe('Index Scan')
    })
  })
})
