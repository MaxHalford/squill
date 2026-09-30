import { describe, expect, it } from 'vitest'
import { BIGQUERY_SCOPES, hasOnlyRequiredBigQueryScopes } from './bigqueryAuth'

describe('BigQuery OAuth scopes', () => {
  it('accepts the two required scopes in either order', () => {
    expect(hasOnlyRequiredBigQueryScopes([...BIGQUERY_SCOPES].reverse().join(' '))).toBe(true)
  })

  it('rejects missing and broader grants', () => {
    expect(hasOnlyRequiredBigQueryScopes(undefined)).toBe(false)
    expect(hasOnlyRequiredBigQueryScopes(BIGQUERY_SCOPES[0])).toBe(false)
    expect(hasOnlyRequiredBigQueryScopes(`${BIGQUERY_SCOPES.join(' ')} https://www.googleapis.com/auth/cloud-platform.read-only`)).toBe(false)
  })
})
