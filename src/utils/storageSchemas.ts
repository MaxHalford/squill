/**
 * Zod schemas for persisted data validation
 * Ensures type safety when loading state from IndexedDB
 */
import { z } from 'zod'
import { MONO_FONT_IDS } from './fonts'

// ============================================
// Settings Schema
// ============================================
export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark'])
export const CanvasPatternSchema = z.enum(['dots', 'grid', 'waves', 'none'])
export const MonoFontSchema = z.enum(MONO_FONT_IDS)

export const SqlBoxLayoutSchema = z.enum(['vertical', 'horizontal'])

export const SettingsSchema = z.object({
  fetchBatchSize: z.number().positive(),
  fetchPaginationEnabled: z.boolean(),
  paginationSize: z.number().positive(),
  panToBoxOnSelect: z.boolean(),
  themePreference: ThemePreferenceSchema,
  showEditorLineNumbers: z.boolean(),
  editorFontSize: z.number().min(8).max(24),
  monoFont: MonoFontSchema,
  tableLinkEnabled: z.boolean(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  canvasPattern: CanvasPatternSchema,
  voiceNotifyEnabled: z.boolean(),
  sqlBoxLayout: SqlBoxLayoutSchema,
}).partial() // All fields optional since we merge with defaults

export type SettingsData = z.infer<typeof SettingsSchema>

// ============================================
// Canvas/Box Schema
// ============================================
const BoxTypeSchema = z.enum(['sql', 'schema', 'note', 'detail', 'analytics', 'history', 'explain'])

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
  connectionId: z.string().optional(),
  editorHeight: z.number().positive().optional()
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
  updatedAt: z.number(),
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
// Accept legacy provider values so old IndexedDB records can be loaded and
// filtered by the store. Zod strips their obsolete fields and all secrets.
const ConnectionTypeSchema = z.enum(['bigquery', 'clickhouse', 'duckdb', 'snowflake'])

const ConnectionSchema = z.object({
  id: z.string(),
  type: ConnectionTypeSchema,
  name: z.string(),
  createdAt: z.number(),
  email: z.string().optional(),
  projectId: z.string().optional(),
  schemaProjectIds: z.array(z.string()).optional(),
})

export const ConnectionsStateSchema = z.object({
  connections: z.array(ConnectionSchema),
  activeConnectionId: z.string().nullable()
})

export type ConnectionsStateData = z.infer<typeof ConnectionsStateSchema>

// ============================================
// Query history schema
// ============================================
const DatabaseEngineSchema = z.enum(['bigquery', 'clickhouse', 'duckdb', 'snowflake'])

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
