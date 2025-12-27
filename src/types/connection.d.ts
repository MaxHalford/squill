export type ConnectionType = 'bigquery' | 'duckdb'

export interface Connection {
  id: string
  type: ConnectionType
  name: string
  email?: string
  photo?: string
  token?: string
  tokenExpiry?: number
  createdAt: number
}
