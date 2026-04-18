/**
 * Persistence strategy pattern for canvas state.
 *
 * - LocalPersistence: IndexedDB only (free users) — wraps existing storage.ts
 * - SyncedPersistence: REST API + WebSocket (Pro users)
 *
 * Box-level mutation methods are called AFTER the local boxes.value is updated.
 * Local mode: no-op (debounced watch saves to IDB).
 * Synced mode: fire API call to persist server-side.
 */

import type { Box, CanvasData, CanvasMeta, MultiCanvasIndex } from '../types/canvas'
import { CanvasDataSchema, MultiCanvasIndexSchema } from './storageSchemas'
import { loadItem, saveItem, deleteItem } from './storage'
import {
  CanvasWebSocket,
  type CanvasWSEvent,
} from './canvasWebSocket'
import {
  fetchCanvasSnapshot,
  fetchCanvasList,
  createBox as apiCreateBox,
  createBoxesBatch as apiCreateBoxesBatch,
  updateBox as apiUpdateBox,
  deleteBox as apiDeleteBox,
  deleteBoxesBatch as apiDeleteBoxesBatch,
  createServerCanvas,
} from '../services/canvas'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface CanvasPersistence {
  /** Load the multi-canvas index. */
  loadIndex(): Promise<{ canvases: CanvasMeta[]; activeCanvasId: string } | null>
  /** Load a specific canvas's box data. */
  loadCanvas(canvasId: string): Promise<CanvasData | null>
  /** Save a canvas's full state (debounced IDB or no-op for synced). */
  saveCanvas(canvasId: string, data: CanvasData): void
  /** Save the multi-canvas index. */
  saveIndex(index: MultiCanvasIndex): void

  // Canvas-level operations
  createCanvas(meta: CanvasMeta, data: CanvasData): Promise<void>
  deleteCanvas(canvasId: string): Promise<void>
  renameCanvas(canvasId: string, name: string): Promise<void>

  // Box-level mutations (called after local state is updated)
  onBoxAdded(canvasId: string, box: Box): void
  onBoxRemoved(canvasId: string, boxId: number): void
  onBoxUpdated(canvasId: string, boxId: number, fields: Partial<Box>): void
  onBoxesRemoved(canvasId: string, boxIds: number[]): void
  onBoxesReplaced(canvasId: string, removedId: number, newBoxes: Box[]): void

  // WebSocket connection for synced mode
  connectToCanvas(canvasId: string): void
  disconnectFromCanvas(): void
  sendCursorMove(x: number, y: number): void

  // Status
  readonly isSynced: boolean
  onRemoteEvent: ((event: CanvasWSEvent) => void) | null
  onConnectionChange: ((connected: boolean) => void) | null

  // Cleanup
  dispose(): void
}

// ---------------------------------------------------------------------------
// LocalPersistence — IDB only (free users)
// ---------------------------------------------------------------------------

export class LocalPersistence implements CanvasPersistence {
  readonly isSynced = false
  onRemoteEvent: ((event: CanvasWSEvent) => void) | null = null
  onConnectionChange: ((connected: boolean) => void) | null = null

  async loadIndex() {
    const raw = await loadItem<MultiCanvasIndex>('canvas:index')
    if (!raw) return null
    const result = MultiCanvasIndexSchema.safeParse(raw)
    if (!result.success) {
      console.warn('Canvas index validation failed:', result.error.issues)
      return null
    }
    return {
      canvases: result.data.canvases,
      activeCanvasId: result.data.activeCanvasId,
    }
  }

  async loadCanvas(canvasId: string) {
    const raw = await loadItem<CanvasData>(`canvas:${canvasId}`)
    if (!raw) return null
    const result = CanvasDataSchema.safeParse(raw)
    if (!result.success) {
      console.warn('Canvas data validation failed:', result.error.issues)
      return null
    }
    return result.data
  }

  saveCanvas(canvasId: string, data: CanvasData) {
    saveItem(`canvas:${canvasId}`, data).catch((err) =>
      console.error('Failed to save canvas:', err),
    )
  }

  saveIndex(index: MultiCanvasIndex) {
    saveItem('canvas:index', index).catch((err) =>
      console.error('Failed to save index:', err),
    )
  }

  async createCanvas(_meta: CanvasMeta, data: CanvasData) {
    await saveItem(`canvas:${data.id}`, data)
  }

  async deleteCanvas(canvasId: string) {
    await deleteItem(`canvas:${canvasId}`)
  }

  async renameCanvas(_canvasId: string, _name: string) {
    // Name is saved as part of index — handled by saveIndex
  }

  // Box-level mutations — no-op, debounced watch handles IDB saves
  onBoxAdded() {}
  onBoxRemoved() {}
  onBoxUpdated() {}
  onBoxesRemoved() {}
  onBoxesReplaced() {}

  connectToCanvas() {}
  disconnectFromCanvas() {}
  sendCursorMove() {}
  dispose() {}
}

// ---------------------------------------------------------------------------
// SyncedPersistence — REST API + WebSocket (Pro users)
// ---------------------------------------------------------------------------

export class SyncedPersistence implements CanvasPersistence {
  readonly isSynced = true
  onRemoteEvent: ((event: CanvasWSEvent) => void) | null = null
  onConnectionChange: ((connected: boolean) => void) | null = null

  private token: string
  private ws: CanvasWebSocket | null = null
  private pendingUpdates = new Map<number, { fields: Record<string, unknown>; timer: ReturnType<typeof setTimeout> }>()

  constructor(token: string) {
    this.token = token
  }

  async loadIndex() {
    try {
      const canvases = await fetchCanvasList(this.token)
      if (!canvases.length) return null
      return {
        canvases: canvases.map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: new Date(c.created_at).getTime(),
          updatedAt: new Date(c.updated_at).getTime(),
        })),
        activeCanvasId: canvases[0].id,
      }
    } catch (err) {
      console.error('Failed to load canvas index from API:', err)
      // Fallback to IDB cache
      return new LocalPersistence().loadIndex()
    }
  }

  async loadCanvas(canvasId: string) {
    try {
      const snapshot = await fetchCanvasSnapshot(canvasId, this.token)
      const boxes = snapshot.boxes.map((b) => ({
        id: b.box_id,
        ...b.state,
      })) as unknown as Box[]
      const data: CanvasData = {
        id: snapshot.id,
        name: snapshot.name,
        createdAt: new Date(snapshot.created_at).getTime(),
        updatedAt: new Date(snapshot.updated_at).getTime(),
        boxes,
        nextBoxId: snapshot.next_box_id,
      }
      // Cache to IDB for offline/fast load
      saveItem(`canvas:${canvasId}`, data).catch(() => {})
      return data
    } catch (err) {
      console.error('Failed to load canvas from API:', err)
      // Fallback to IDB cache
      return new LocalPersistence().loadCanvas(canvasId)
    }
  }

  saveCanvas(canvasId: string, data: CanvasData) {
    // Cache locally for fast reload
    saveItem(`canvas:${canvasId}`, data).catch(() => {})
  }

  saveIndex(index: MultiCanvasIndex) {
    // Cache locally
    saveItem('canvas:index', index).catch(() => {})
  }

  async createCanvas(meta: CanvasMeta, data: CanvasData) {
    await createServerCanvas(meta.id, meta.name, this.token)
    await saveItem(`canvas:${data.id}`, data)
  }

  async deleteCanvas(canvasId: string) {
    await fetch(
      `${BACKEND_URL}/canvas/${canvasId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      },
    )
    await deleteItem(`canvas:${canvasId}`)
  }

  async renameCanvas(canvasId: string, name: string) {
    await fetch(
      `${BACKEND_URL}/canvas/${canvasId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ name }),
      },
    )
  }

  // --- Box-level mutations (fire-and-forget API calls after optimistic local update) ---

  onBoxAdded(canvasId: string, box: Box) {
    const { id: _id, ...state } = box
    apiCreateBox(canvasId, state as Record<string, unknown>, this.token).catch(
      (err) => console.error('Failed to create box:', err),
    )
  }

  onBoxRemoved(canvasId: string, boxId: number) {
    // Cancel any pending updates for this box
    const pending = this.pendingUpdates.get(boxId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingUpdates.delete(boxId)
    }
    apiDeleteBox(canvasId, boxId, this.token).catch((err) =>
      console.error('Failed to delete box:', err),
    )
  }

  onBoxUpdated(canvasId: string, boxId: number, fields: Partial<Box>) {
    // Debounce: merge fields and delay API call
    const existing = this.pendingUpdates.get(boxId)
    if (existing) {
      clearTimeout(existing.timer)
      Object.assign(existing.fields, fields)
    }
    const merged = existing?.fields ?? { ...fields }
    const delay = 'query' in fields ? 1000 : 500
    const timer = setTimeout(() => {
      this.pendingUpdates.delete(boxId)
      apiUpdateBox(canvasId, boxId, merged, this.token).catch((err) =>
        console.error('Failed to update box:', err),
      )
    }, delay)
    this.pendingUpdates.set(boxId, { fields: merged, timer })
  }

  onBoxesRemoved(canvasId: string, boxIds: number[]) {
    for (const id of boxIds) {
      const pending = this.pendingUpdates.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingUpdates.delete(id)
      }
    }
    apiDeleteBoxesBatch(canvasId, boxIds, this.token).catch((err) =>
      console.error('Failed to delete boxes:', err),
    )
  }

  onBoxesReplaced(canvasId: string, _removedId: number, newBoxes: Box[]) {
    const states = newBoxes.map((b) => {
      const { id: _id, ...state } = b
      return state as Record<string, unknown>
    })
    apiCreateBoxesBatch(canvasId, states, this.token).catch((err) =>
      console.error('Failed to create boxes batch:', err),
    )
  }

  // --- WebSocket ---

  connectToCanvas(canvasId: string) {
    this.disconnectFromCanvas()
    this.ws = new CanvasWebSocket({
      url: BACKEND_URL,
      canvasId,
      token: this.token,
      onEvent: (event) => this.onRemoteEvent?.(event),
      onStatusChange: (connected) => this.onConnectionChange?.(connected),
    })
  }

  disconnectFromCanvas() {
    this.ws?.dispose()
    this.ws = null
  }

  sendCursorMove(x: number, y: number) {
    this.ws?.send({ type: 'cursor.move', data: { x, y } })
  }

  dispose() {
    // Flush pending updates
    for (const [, { timer }] of this.pendingUpdates) {
      clearTimeout(timer)
    }
    this.pendingUpdates.clear()
    this.disconnectFromCanvas()
  }
}
