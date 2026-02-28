/**
 * Tool execution logic for the chat agent.
 *
 * Handles list_schemas, list_tables, and run_query tools by dispatching
 * to the appropriate Pinia stores. Query execution is delegated to the
 * caller-provided onRunQuery callback (which calls QueryPanel.runQuery).
 */

import { computed, type Ref } from 'vue'
import { useDuckDBStore } from '../stores/duckdb'
import { useConnectionsStore } from '../stores/connections'
import { collectSchemaForConnection, type ConnectionType } from '../utils/schemaAdapter'
import type { ToolCall } from './useChat'
import type { QueryCompleteEvent } from '../types/database'

export interface ChatToolsOptions {
  onRunQuery: (query: string) => Promise<QueryCompleteEvent>
}

export function useChatTools(connectionId: Ref<string | undefined>, options: ChatToolsOptions) {
  const duckdbStore = useDuckDBStore()
  const connectionsStore = useConnectionsStore()

  // Resolve connection object
  const connection = computed(() => {
    if (!connectionId.value) return null
    return connectionsStore.connections.find(c => c.id === connectionId.value) || null
  })

  const connectionType = computed((): ConnectionType => {
    return (connection.value?.type as ConnectionType) || 'duckdb'
  })

  // ---------------------------------------------------------------------------
  // Tool: list_schemas
  // ---------------------------------------------------------------------------

  async function executeListSchemas(): Promise<string> {
    const schema = await collectSchemaForConnection(connectionType.value, connectionId.value)

    const schemas = new Set<string>()
    for (const item of schema) {
      const parts = item.tableName.split('.')
      if (connectionType.value === 'bigquery' && parts.length === 3) {
        schemas.add(parts[1])
      } else if (connectionType.value === 'snowflake' && parts.length === 3) {
        schemas.add(`${parts[0]}.${parts[1]}`)
      } else if ((connectionType.value === 'postgres') && parts.length === 2) {
        schemas.add(parts[0])
      } else {
        schemas.add('default')
      }
    }

    return JSON.stringify(Array.from(schemas))
  }

  // ---------------------------------------------------------------------------
  // Tool: list_tables
  // ---------------------------------------------------------------------------

  async function executeListTables(schemaName: string): Promise<string> {
    const schema = await collectSchemaForConnection(connectionType.value, connectionId.value)

    const tables = schema
      .filter(item => {
        const parts = item.tableName.split('.')
        if (connectionType.value === 'bigquery' && parts.length === 3) {
          return parts[1] === schemaName
        } else if (connectionType.value === 'snowflake' && parts.length === 3) {
          return `${parts[0]}.${parts[1]}` === schemaName
        } else if (connectionType.value === 'postgres' && parts.length === 2) {
          return parts[0] === schemaName
        }
        return true
      })
      .map(item => ({
        name: item.tableName,
        columns: item.columns.map(c => ({ name: c.name, type: c.type })),
      }))

    return JSON.stringify(tables)
  }

  // ---------------------------------------------------------------------------
  // Tool: run_query — delegates to QueryPanel via callback
  // ---------------------------------------------------------------------------

  async function executeRunQuery(query: string): Promise<string> {
    try {
      const result = await options.onRunQuery(query)

      // Get preview rows for the agent (first 5 rows)
      let preview: Record<string, unknown>[] = []
      try {
        const previewResult = await duckdbStore.runQuery(`SELECT * FROM "${result.tableName}" LIMIT 5`)
        preview = previewResult.rows as Record<string, unknown>[]
      } catch {
        // Preview failed, that's ok
      }

      return JSON.stringify({
        success: true,
        rowCount: result.rowCount,
        columns: result.columns,
        preview,
      })
    } catch (err: unknown) {
      const errorMessage = (err as Error).message || 'Query execution failed'
      return JSON.stringify({
        success: false,
        error: errorMessage,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Tool dispatcher
  // ---------------------------------------------------------------------------

  async function handleToolCall(toolCall: ToolCall): Promise<string> {
    switch (toolCall.name) {
      case 'list_schemas':
        return executeListSchemas()
      case 'list_tables':
        return executeListTables(toolCall.args.schema as string)
      case 'run_query':
        return executeRunQuery(toolCall.args.query as string)
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolCall.name}` })
    }
  }

  // ---------------------------------------------------------------------------
  // Connection info for system prompt
  // ---------------------------------------------------------------------------

  const dialect = computed(() => {
    const type = connectionType.value
    if (type === 'snowflake') return 'snowflake'
    return type
  })

  const connectionInfo = computed(() => {
    const conn = connection.value
    if (!conn) return 'Local DuckDB'
    if (conn.type === 'bigquery') return `BigQuery (${conn.email || conn.projectId || 'connected'})`
    if (conn.type === 'postgres') return `PostgreSQL (${conn.name || conn.database || 'connected'})`
    if (conn.type === 'snowflake') return `Snowflake (${conn.name || 'connected'})`
    return conn.name || conn.type
  })

  return {
    handleToolCall,
    dialect,
    connectionInfo,
  }
}
