/**
 * Database Types
 *
 * Single source of truth for database engine/dialect types.
 * All supported database engines must be listed here.
 */

/**
 * Supported database engines.
 * Used for query execution, SQL dialect selection, and connection types.
 */
export type DatabaseEngine = 'duckdb' | 'bigquery' | 'postgres' | 'snowflake'

/**
 * Array of all supported engines (useful for iteration/validation)
 */
export const DATABASE_ENGINES: readonly DatabaseEngine[] = ['duckdb', 'bigquery', 'postgres', 'snowflake'] as const
