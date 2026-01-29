# Adding a New Database Flavor

This guide explains all the steps required to add support for a new database (e.g., MySQL, SQLite, ClickHouse) to Squill.

## Overview

Adding a new database requires modifications to approximately 10-15 files across types, stores, utilities, and UI components. The process follows established patterns from existing databases (PostgreSQL, Snowflake, BigQuery, DuckDB).

## Step-by-Step Guide

### 1. Define Types

**File: `frontend/src/types/database.ts`**
- Add the new engine to `DatabaseEngine` type union
- Add to `DATABASE_ENGINES` array
- Add `DatabaseInfo` entry with display name, logo path, colors, and description

```typescript
// Example: Adding MySQL
export type DatabaseEngine = 'duckdb' | 'bigquery' | 'postgres' | 'snowflake' | 'mysql'

export const DATABASE_ENGINES: DatabaseEngine[] = ['duckdb', 'bigquery', 'postgres', 'snowflake', 'mysql']

export const DATABASE_INFO: Record<DatabaseEngine, DatabaseInfo> = {
  // ... existing entries
  mysql: {
    displayName: 'MySQL',
    logo: '/logos/mysql.svg',
    primaryColor: '#4479A1',
    description: 'Open-source relational database'
  }
}
```

**File: `frontend/src/types/connection.d.ts`**
- Add to `ConnectionType` union

```typescript
export type ConnectionType = 'bigquery' | 'duckdb' | 'postgres' | 'snowflake' | 'mysql'
```

### 2. Create Database Store

**Create: `frontend/src/stores/[database].ts`**

Follow the pattern from `postgres.ts` or `snowflake.ts`. Key functions to implement:

```typescript
export const useMySqlStore = defineStore('mysql', () => {
  // Connection state
  const isConnecting = ref(false)
  const error = ref<string | null>(null)

  // Required functions:
  async function connect(connectionId: string, credentials: MySqlCredentials): Promise<void>
  async function disconnect(connectionId: string): Promise<void>
  async function runQuery(query: string, signal: AbortSignal | null, connectionId: string): Promise<QueryResult>
  async function runQueryPaginated(...): Promise<PaginatedQueryResult>
  async function fetchAllTables(connectionId: string): Promise<TableInfo[]>
  async function fetchAllColumns(connectionId: string): Promise<ColumnInfo[]>
  async function refreshSchemas(connectionId: string): Promise<void>

  return { /* exports */ }
})
```

### 3. Add SQL Dialect

**File: `frontend/src/utils/sqlDialects.ts`**

Add dialect-specific completions and CodeMirror configuration:

```typescript
// Add to SqlDialect type
export type SqlDialect = 'bigquery' | 'postgres' | 'duckdb' | 'snowflake' | 'mysql'

// Define MySQL-specific completions
const mysqlCompletions: Completion[] = [
  { label: 'SHOW', type: 'keyword', boost: 60 },
  { label: 'DESCRIBE', type: 'keyword', boost: 59 },
  { label: 'EXPLAIN', type: 'keyword', boost: 58 },
  { label: 'IFNULL', type: 'function', boost: 29 },
  { label: 'CONCAT_WS', type: 'function', boost: 27 },
  // ... more MySQL-specific keywords
]

// Add to dialects registry
export const dialects: Record<SqlDialect, DialectConfig> = {
  // ... existing dialects
  mysql: {
    codemirror: MySQL, // from @codemirror/lang-sql if available, or PostgreSQL as fallback
    completions: mysqlCompletions,
  },
}
```

### 4. Add Connection Helpers

**File: `frontend/src/utils/connectionHelpers.ts`**

```typescript
export const CONNECTION_METADATA: Record<ConnectionType, ConnectionMetadata> = {
  // ... existing entries
  mysql: {
    displayName: 'MySQL',
    requiresAuth: true,   // needs credentials
    hasProjects: false,   // no project hierarchy like BigQuery
  }
}

// Update getDialectForConnection if needed
export function getDialectForConnection(type: ConnectionType): SqlDialect {
  switch (type) {
    case 'mysql':
      return 'mysql'
    // ... existing cases
  }
}
```

### 5. Add Schema Builder

**File: `frontend/src/utils/schemaBuilder.ts`**

```typescript
export function buildMySqlSchema(
  tables: MySqlTableInfo[],
  columns: MySqlColumnInfo[]
): Record<string, string[]> {
  const schema: Record<string, string[]> = {}

  for (const table of tables) {
    const tableName = `${table.database}.${table.name}`
    schema[tableName] = columns
      .filter(c => c.table === table.name && c.database === table.database)
      .map(c => c.name)
  }

  return schema
}
```

**File: `frontend/src/utils/schemaAdapter.ts`**

Add cases in `collectSchemaForConnection()` and `formatSchemaForLLM()`:

```typescript
export async function collectSchemaForConnection(connectionId: string, type: ConnectionType) {
  switch (type) {
    case 'mysql':
      return collectMySqlSchema(connectionId)
    // ... existing cases
  }
}
```

### 6. Create Connection Modal

**Create: `frontend/src/components/MySqlConnectionModal.vue`**

Follow the pattern from `PostgresConnectionModal.vue`:

```vue
<script setup lang="ts">
// Props: isOpen, onClose
// Form fields: host, port, database, username, password, ssl
// Functions: testConnection, connect, handleSubmit
</script>

<template>
  <!-- Modal with form fields -->
</template>
```

### 7. Update MenuBar

**File: `frontend/src/components/MenuBar.vue`**

```typescript
// Add import
import MySqlConnectionModal from './MySqlConnectionModal.vue'

// Add ref
const showMySqlModal = ref(false)

// Update handleAddDatabase
const handleAddDatabase = async (dbType: string) => {
  switch (dbType) {
    case 'mysql':
      showMySqlModal.value = true
      break
    // ... existing cases
  }
}

// Add modal to template
<MySqlConnectionModal
  :is-open="showMySqlModal"
  @close="showMySqlModal = false"
  @connected="handleConnectionAdded"
/>
```

### 8. Update SqlBox

**File: `frontend/src/components/SqlBox.vue`**

Add query execution logic:

```typescript
// In executeQuery function
} else if (engine === 'mysql') {
  const connectionId = boxConnection.value?.id
  if (!connectionId) {
    throw new Error('Please connect to MySQL first')
  }
  result = await mysqlStore.runQuery(query, abortController.signal, connectionId)
  // ... handle results
}
```

### 9. Update Supporting Components

**File: `frontend/src/components/SchemaBox.vue`**
- Add schema browser support for the new database

**File: `frontend/src/components/BoxCreationButtons.vue`**
- Add as available data source option

**File: `frontend/src/components/ColumnAnalyticsBox.vue`**
- Add analytics query execution logic

### 10. Optional: Add Database-Specific Types

**Create: `frontend/src/types/mysql.d.ts`** (if needed)

```typescript
export interface MySqlCredentials {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: boolean
}

export interface MySqlTableInfo {
  database: string
  name: string
  type: 'table' | 'view'
}
```

## Backend Integration

If the database requires server-side proxy (like PostgreSQL/Snowflake):

1. Add router in `backend/routers/[database].py`
2. Add connection handling with credentials encryption
3. Implement query execution endpoint
4. Add schema introspection endpoint

## Checklist

- [ ] Types defined (`database.ts`, `connection.d.ts`)
- [ ] Store created with query execution
- [ ] SQL dialect added with completions
- [ ] Connection helpers updated
- [ ] Schema builder functions added
- [ ] Connection modal created
- [ ] MenuBar updated with modal
- [ ] SqlBox query execution added
- [ ] SchemaBox support added
- [ ] Logo added to `/public/logos/`
- [ ] Type-check passes (`bun run type-check`)
- [ ] Manual testing with real database connection

## Reference Files

- PostgreSQL pattern (server-side): `frontend/src/stores/postgres.ts`
- Snowflake pattern (server-side): `frontend/src/stores/snowflake.ts`
- BigQuery pattern (client-side OAuth): `frontend/src/stores/bigquery.ts`
- DuckDB pattern (local/WASM): `frontend/src/stores/duckdb.ts`
