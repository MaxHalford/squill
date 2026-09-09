export interface BigQueryField {
  name: string
  type: string
  mode?: string
  fields?: BigQueryField[]  // Nested fields for RECORD/STRUCT types
}

export interface BigQuerySchema {
  fields: BigQueryField[]
}

export interface BigQueryRow {
  f: Array<{ v: unknown }>
}

export interface BigQueryQueryResponse {
  schema?: BigQuerySchema
  rows?: BigQueryRow[]
  totalBytesProcessed?: string
  cacheHit?: boolean
  totalRows?: string  // BigQuery returns this as a string
  pageToken?: string  // Token for pagination
  jobComplete?: boolean  // false when query is still running
  jobReference?: {
    projectId: string
    jobId: string
    location: string
  }
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
  location?: string
}

export interface BigQueryTable {
  tableReference: {
    projectId: string
    datasetId: string
    tableId: string
  }
}

/** Full response from the BigQuery tables.get API */
export interface BigQueryTableDetail {
  schema?: { fields?: BigQueryField[] }
  numRows?: string
  numBytes?: string
  numLongTermBytes?: string
  creationTime?: string
  lastModifiedTime?: string
  type?: string
  clustering?: { fields?: string[] }
  timePartitioning?: { type?: string; field?: string }
}
