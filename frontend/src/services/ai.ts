import { filterSchemaByRelevance } from '../utils/textSimilarity'
import {
  collectSchemaForConnection,
  formatSchemaForLLM,
  formatSampleQueries,
  type ConnectionType,
} from '../utils/schemaAdapter'
import { useQueryHistoryStore } from '../stores/queryHistory'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Default similarity threshold for schema filtering
const DEFAULT_SCHEMA_THRESHOLD = 0.4

export interface LineSuggestion {
  line: number // 1-indexed, 0 if no relevant fix
  original: string
  suggestion: string
  action?: 'replace' | 'insert' // "replace" swaps a line, "insert" adds a new line
  message?: string
  noRelevantFix?: boolean
}

export interface FixRequest {
  query: string
  error_message: string
  database_dialect: 'bigquery' | 'postgres' | 'duckdb'
}

export interface FixContext {
  connectionId?: string
  connectionType?: ConnectionType
  projectId?: string // BigQuery project ID
  schemaThreshold?: number
}

/**
 * Build schema context for the fix request
 * Uses n-gram similarity to find relevant tables/columns
 */
async function buildSchemaContext(
  query: string,
  connectionType: ConnectionType,
  connectionId?: string,
  projectId?: string,
  threshold: number = DEFAULT_SCHEMA_THRESHOLD
): Promise<string> {
  const schema = await collectSchemaForConnection(connectionType, connectionId)

  if (schema.length === 0) return ''

  const filtered = filterSchemaByRelevance(query, schema, threshold)

  if (filtered.length === 0) return ''

  return formatSchemaForLLM(filtered, connectionType, projectId)
}

/**
 * Build sample queries context from query history
 */
function buildSampleQueriesContext(connectionId?: string): string {
  if (!connectionId) return ''

  const historyStore = useQueryHistoryStore()
  const queries = historyStore.getSampleQueries(connectionId)

  if (queries.length === 0) return ''

  return formatSampleQueries(queries)
}

/**
 * Request an AI-generated fix for a failed SQL query
 * Includes schema context and sample queries when available
 */
export async function suggestFix(
  request: FixRequest,
  sessionToken: string,
  context?: FixContext
): Promise<LineSuggestion | null> {
  // Build additional context
  let schemaContext: string | undefined
  let sampleQueriesContext: string | undefined

  if (context?.connectionType) {
    schemaContext = await buildSchemaContext(
      request.query,
      context.connectionType,
      context.connectionId,
      context.projectId,
      context.schemaThreshold ?? DEFAULT_SCHEMA_THRESHOLD
    )

    sampleQueriesContext = buildSampleQueriesContext(context.connectionId)
  }

  try {
    const response = await fetch(`${BACKEND_URL}/remove-hex/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        query: request.query,
        error_message: request.error_message,
        database_dialect: request.database_dialect,
        schema_context: schemaContext || undefined,
        sample_queries: sampleQueriesContext || undefined,
      }),
    })

    if (!response.ok) {
      console.warn('Fix suggestion failed:', response.status)
      return null
    }

    const data = await response.json()
    return {
      line: data.line_number,
      original: data.original,
      suggestion: data.suggestion,
      action: data.action || 'replace',
      message: data.message,
      noRelevantFix: data.no_relevant_fix,
    }
  } catch (error) {
    console.error('Failed to get fix suggestion:', error)
    return null
  }
}
