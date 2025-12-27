export type BoxType = 'sql' | 'schema'

export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box {
  id: number
  type: BoxType
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  query: string
  name: string
  dependencies: number[]
}

export interface CanvasState {
  boxes: Box[]
  nextBoxId: number
  activeProjectId: string | null
}

export interface QueryStats {
  executionTimeMs: number
  rowCount?: number
  engine: 'bigquery' | 'duckdb'
  totalBytesProcessed?: string
  cacheHit?: boolean
}
