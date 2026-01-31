/**
 * Zod schemas for localStorage data validation
 * Ensures type safety when loading persisted state
 */
import { z } from 'zod'

// ============================================
// Settings Schema
// ============================================
export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark'])
export const CanvasPatternSchema = z.enum(['dots', 'grid', 'crosshatch', 'none'])

export const SettingsSchema = z.object({
  fetchBatchSize: z.number().positive(),
  fetchPaginationEnabled: z.boolean(),
  paginationSize: z.number().positive(),
  panToBoxOnSelect: z.boolean(),
  autofixEnabled: z.boolean(),
  themePreference: ThemePreferenceSchema,
  showEditorLineNumbers: z.boolean(),
  editorFontSize: z.number().min(8).max(24),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  canvasPattern: CanvasPatternSchema
}).partial() // All fields optional since we merge with defaults

export type SettingsData = z.infer<typeof SettingsSchema>

// ============================================
// Canvas/Box Schema
// ============================================
const BoxTypeSchema = z.enum(['sql', 'schema', 'note', 'detail', 'analytics', 'history'])

const BoxSchema = z.object({
  id: z.number(),
  type: BoxTypeSchema,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  zIndex: z.number(),
  query: z.string(),
  name: z.string(),
  dependencies: z.array(z.number()),
  connectionId: z.string().optional()
})

export const CanvasStateSchema = z.object({
  boxes: z.array(BoxSchema),
  nextBoxId: z.number().positive()
})

export type CanvasStateData = z.infer<typeof CanvasStateSchema>

// Multi-canvas schemas
export const CanvasMetaSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const CanvasDataSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  boxes: z.array(BoxSchema),
  nextBoxId: z.number().positive()
})

export const MultiCanvasIndexSchema = z.object({
  version: z.literal(1),
  activeCanvasId: z.string(),
  canvases: z.array(CanvasMetaSchema)
})

export type CanvasMetaData = z.infer<typeof CanvasMetaSchema>
export type CanvasDataData = z.infer<typeof CanvasDataSchema>
export type MultiCanvasIndexData = z.infer<typeof MultiCanvasIndexSchema>

// ============================================
// Connection Schema
// ============================================
const ConnectionTypeSchema = z.enum(['bigquery', 'duckdb', 'postgres'])

const ConnectionSchema = z.object({
  id: z.string(),
  type: ConnectionTypeSchema,
  name: z.string(),
  createdAt: z.number(),
  email: z.string().optional(),
  projectId: z.string().optional(),
  database: z.string().optional()
})

export const ConnectionsStateSchema = z.object({
  connections: z.array(ConnectionSchema),
  activeConnectionId: z.string().nullable()
})

export type ConnectionsStateData = z.infer<typeof ConnectionsStateSchema>

// ============================================
// User Schema
// ============================================
const PlanTypeSchema = z.enum(['free', 'pro'])

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  plan: PlanTypeSchema,
  isVip: z.boolean(),
  planExpiresAt: z.string().nullable().optional().default(null),
  subscriptionCancelAtPeriodEnd: z.boolean().optional().default(false)
})

export type UserData = z.infer<typeof UserSchema>

// ============================================
// BigQuery Schema Cache
// ============================================
const ColumnSchema = z.object({
  name: z.string(),
  type: z.string()
})

export const SchemaStateSchema = z.object({
  bigQuerySchemas: z.record(z.string(), z.array(ColumnSchema))
})

export type SchemaStateData = z.infer<typeof SchemaStateSchema>

// ============================================
// Query history schema
// ============================================
const DatabaseEngineSchema = z.enum(['bigquery', 'duckdb', 'postgres', 'snowflake'])

export const QueryHistoryEntrySchema = z.object({
  id: z.string(),
  query: z.string(),
  timestamp: z.number(),
  connectionId: z.string(),
  connectionType: DatabaseEngineSchema,
  boxName: z.string().optional(),
  executionTimeMs: z.number().optional(),
  rowCount: z.number().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional()
})

export const QueryHistoryStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(QueryHistoryEntrySchema),
  maxEntries: z.number().positive()
})

export type QueryHistoryEntry = z.infer<typeof QueryHistoryEntrySchema>
export type QueryHistoryState = z.infer<typeof QueryHistoryStateSchema>

// ============================================
// Safe parse helper
// ============================================

/**
 * Safely parse JSON from localStorage with Zod validation
 * Returns null if parsing fails or data is invalid
 */
export function safeParseStorage<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback?: T
): T | null {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return fallback ?? null

    const parsed = JSON.parse(saved)
    const result = schema.safeParse(parsed)

    if (result.success) {
      return result.data
    }

    console.warn(`Invalid data in localStorage key "${key}":`, result.error.issues)
    return fallback ?? null
  } catch (err) {
    console.error(`Failed to parse localStorage key "${key}":`, err)
    return fallback ?? null
  }
}
