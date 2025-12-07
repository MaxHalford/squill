export interface BigQueryField {
  name: string
  type: string
  mode?: string
}

export interface BigQuerySchema {
  fields: BigQueryField[]
}

export interface BigQueryRow {
  f: Array<{ v: any }>
}

export interface BigQueryQueryResponse {
  schema?: BigQuerySchema
  rows?: BigQueryRow[]
  totalBytesProcessed?: string
  cacheHit?: boolean
  totalRows?: string  // BigQuery returns this as a string
  pageToken?: string  // Token for pagination
}

export interface BigQueryProject {
  projectId: string
  name?: string
}

export interface BigQueryDataset {
  datasetReference: {
    datasetId: string
    projectId: string
  }
}

export interface BigQueryTable {
  tableReference: {
    projectId: string
    datasetId: string
    tableId: string
  }
}
