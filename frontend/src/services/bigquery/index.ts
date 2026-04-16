import type { Connection } from '../../types/connection'
import type { BigQueryClient } from './types'
import { createOAuthClient } from './oauthClient'

export function createBigQueryClient(connection: Connection): BigQueryClient {
  if (connection.type !== 'bigquery') {
    throw new Error(`Connection ${connection.id} is not BigQuery (type: ${connection.type})`)
  }
  return createOAuthClient(connection.id)
}

export type {
  BigQueryClient,
  BigQueryQueryResult,
  BigQueryPaginatedQueryResult,
  DryRunResult,
} from './types'
