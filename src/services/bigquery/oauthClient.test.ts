import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  settings: { bigQueryMaxBytesBilledGiB: 10 },
}))

vi.mock('../../stores/connections', () => ({
  useConnectionsStore: () => ({
    getAccessToken: mocks.getAccessToken,
    clearAccessToken: mocks.clearAccessToken,
  }),
}))
vi.mock('../../stores/settings', () => ({ useSettingsStore: () => mocks.settings }))

import { createOAuthClient } from './oauthClient'

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

describe('OAuth BigQuery client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.bigQueryMaxBytesBilledGiB = 10
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists every BigQuery project page with the narrow scope endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        projects: [{ projectReference: { projectId: 'one' }, friendlyName: 'One' }],
        nextPageToken: 'page-2',
      }))
      .mockResolvedValueOnce(jsonResponse({
        projects: [{ projectReference: { projectId: 'two' } }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await createOAuthClient('connection').listProjects()).toEqual([
      { projectId: 'one', name: 'One' },
      { projectId: 'two', name: 'two' },
    ])
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://bigquery.googleapis.com/bigquery/v2/projects',
      'https://bigquery.googleapis.com/bigquery/v2/projects?pageToken=page-2',
    ])
  })

  it('applies the billing cap to both query paths', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ jobComplete: true })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createOAuthClient('connection')

    await client.runQuery('SELECT 1', 'billing-project')
    await client.runQueryPaginated('SELECT 2', 'billing-project')

    const requests = fetchMock.mock.calls.map(call => JSON.parse(call[1].body as string))
    expect(requests).toHaveLength(2)
    expect(requests.map(body => body.maximumBytesBilled)).toEqual(['10737418240', '10737418240'])
  })

  it('fetches later pages from the original job without submitting the SQL again', async () => {
    const jobReference = { projectId: 'billing-project', jobId: 'job-1', location: 'us-central1' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        jobComplete: true,
        pageToken: 'next-page',
        jobReference,
        schema: { fields: [] },
        rows: [],
      }))
      .mockResolvedValueOnce(jsonResponse({ jobComplete: true, schema: { fields: [] }, rows: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createOAuthClient('connection')

    const first = await client.runQueryPaginated('SELECT 1', 'billing-project', { maxResults: 5 })
    await client.runQueryPaginated('SELECT 1', 'billing-project', {
      maxResults: 5,
      pageToken: first.pageToken,
      jobReference: first.jobReference,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://bigquery.googleapis.com/bigquery/v2/projects/billing-project/queries/job-1?timeoutMs=10000&maxResults=5&pageToken=next-page&location=us-central1',
    )
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined()
    await expect(client.runQueryPaginated('SELECT 1', 'billing-project', { pageToken: 'next-page' }))
      .rejects.toThrow('original job reference')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
