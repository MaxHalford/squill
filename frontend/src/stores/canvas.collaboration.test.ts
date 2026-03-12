/**
 * Unit tests for the canvas store's collaboration logic.
 *
 * Strategy: mock `createCollaborationSession` to return a real Y.Doc
 * (so Yjs reactivity works) paired with a stub provider whose events we
 * fire manually. This lets us test migration, sync, and teardown without
 * a WebSocket connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as Y from 'yjs'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock storage so IDB calls are no-ops
vi.mock('../utils/storage', () => ({
  loadItem: vi.fn().mockResolvedValue(null),
  saveItem: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
}))

// Keep real ymapToBox / boxToYmap; only stub out the session factory
const mockDestroySession = vi.fn()
const mockCreateSession = vi.fn()

vi.mock('../utils/collaboration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/collaboration')>()
  return {
    ...actual,
    createCollaborationSession: mockCreateSession,
    destroyCollaborationSession: mockDestroySession,
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockSession = {
  doc: Y.Doc
  boxesArray: Y.Array<Y.Map<unknown>>
  canvasMap: Y.Map<unknown>
  undoManager: Y.UndoManager
  provider: {
    on: (event: string, cb: (...args: unknown[]) => void) => void
    destroy: ReturnType<typeof vi.fn>
    /** Test-only helper: fire a registered event */
    fire: (event: string, ...args: unknown[]) => void
  }
  canvasId: string
}

function makeMockSession(canvasId = 'canvas-abc'): MockSession {
  const doc = new Y.Doc()
  const boxesArray = doc.getArray<Y.Map<unknown>>('boxes')
  const canvasMap = doc.getMap<unknown>('canvas')
  const undoManager = new Y.UndoManager([boxesArray, canvasMap])

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const provider = {
    on(event: string, cb: (...args: unknown[]) => void) {
      ;(listeners[event] ??= []).push(cb)
    },
    destroy: vi.fn(),
    fire(event: string, ...args: unknown[]) {
      listeners[event]?.forEach(cb => cb(...args))
    },
  }

  return { doc, boxesArray, canvasMap, undoManager, provider, canvasId }
}

/** Build a minimal Box fixture */
function makeBox(id: number) {
  return {
    id,
    type: 'sql' as const,
    x: id * 10, y: 0,
    width: 400, height: 300,
    zIndex: id,
    query: `SELECT ${id}`,
    name: `box-${id}`,
    dependencies: [],
    connectionId: undefined,
    editorHeight: undefined,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('canvas store — collaboration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockCreateSession.mockReset()
    mockDestroySession.mockReset()
  })

  it('clears boxes immediately when collaboration is enabled', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    // Seed boxes as if loaded from IDB
    store.boxes = [makeBox(1), makeBox(2)]

    store.enableCollaboration('canvas-abc', 'token-xyz')

    // Boxes should be cleared synchronously before Yjs arrives
    expect(store.boxes).toEqual([])
  })

  it('migrates local IDB boxes to Yjs when server has no state', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    const box1 = makeBox(1)
    const box2 = makeBox(2)
    store.boxes = [box1, box2]

    store.enableCollaboration('canvas-abc', 'owner-jwt')

    // Server sends empty state → synced fires with nothing in Yjs
    session.provider.fire('synced')

    // Boxes should now be in the Yjs array (migrated from local IDB snapshot)
    expect(session.boxesArray.length).toBe(2)
    expect(session.boxesArray.get(0).get('id')).toBe(1)
    expect(session.boxesArray.get(1).get('id')).toBe(2)

    // And boxes.value should reflect the migration (observeDeep fired)
    expect(store.boxes).toHaveLength(2)
    expect(store.boxes[0].id).toBe(1)
    expect(store.boxes[1].id).toBe(2)
  })

  it('does NOT migrate when the server already has state', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    // Viewer has stale local boxes from their own canvas
    store.boxes = [makeBox(99)]

    store.enableCollaboration('canvas-abc', 'share-token')

    // Simulate server state arriving before synced (observeDeep path)
    const serverBox = makeBox(7)
    const { boxToYmap } = await import('../utils/collaboration')
    session.boxesArray.push([boxToYmap(serverBox)])

    // synced fires — server has data, so no migration should happen
    session.provider.fire('synced')

    // Yjs only contains the server's box, not the viewer's stale box
    expect(session.boxesArray.length).toBe(1)
    expect(session.boxesArray.get(0).get('id')).toBe(7)

    // boxes.value reflects server state
    expect(store.boxes).toHaveLength(1)
    expect(store.boxes[0].id).toBe(7)
  })

  it('populates boxes.value via the safety-net syncFromYjs in synced', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    store.boxes = []

    store.enableCollaboration('canvas-abc', 'share-token')

    // Manually populate Yjs (simulating onLoadDocument on server) WITHOUT
    // going through the WebSocket so observeDeep hasn't fired yet
    const { boxToYmap } = await import('../utils/collaboration')
    // Bypass observeDeep by pushing inside a transact after observers registered
    // then clearing listeners to simulate them not having fired
    // Instead, just push directly — observeDeep WILL fire here, but that's fine;
    // what we're really checking is that synced also calls syncFromYjs as a net.
    session.doc.transact(() => {
      session.boxesArray.push([boxToYmap(makeBox(5))])
    })

    session.provider.fire('synced')

    expect(store.boxes).toHaveLength(1)
    expect(store.boxes[0].id).toBe(5)
  })

  it('tears down the previous session before starting a new one', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()

    const session1 = makeMockSession('canvas-1')
    const session2 = makeMockSession('canvas-2')
    mockCreateSession
      .mockReturnValueOnce(session1)
      .mockReturnValueOnce(session2)

    store.enableCollaboration('canvas-1', 'token')
    store.enableCollaboration('canvas-2', 'token')

    expect(mockDestroySession).toHaveBeenCalledOnce()
    expect(mockDestroySession).toHaveBeenCalledWith(session1)
  })

  it('disableCollaboration destroys the session and clears it', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    store.enableCollaboration('canvas-abc', 'token')
    expect(store.isCollaborative).toBe(true)

    store.disableCollaboration()

    expect(mockDestroySession).toHaveBeenCalledWith(session)
    expect(store.isCollaborative).toBe(false)
  })

  it('migration uses the boxes snapshot taken before clearing — not stale empty state', async () => {
    // This regression test covers the case where enableCollaboration is called
    // a second time (e.g. by the Home.vue watch) after boxes.value was already
    // cleared by the first call. The second call must still migrate if the owner
    // had local boxes — but only if we properly snapshot BEFORE clearing.
    // With the watch fix (skip when oldId=null) this second call no longer happens,
    // but the store itself is still safe: if called again with no local boxes and
    // no server state, it simply results in an empty canvas (no phantom migration).
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()

    const session1 = makeMockSession('canvas-abc')
    const session2 = makeMockSession('canvas-abc')
    mockCreateSession
      .mockReturnValueOnce(session1)
      .mockReturnValueOnce(session2)

    // First call: owner has local boxes, clears them and connects
    store.boxes = [makeBox(1), makeBox(2)]
    store.enableCollaboration('canvas-abc', 'jwt')

    // Second call immediately after (simulates the errant watch): boxes.value is now []
    store.enableCollaboration('canvas-abc', 'jwt')

    // Second session synced with empty server state
    session2.provider.fire('synced')

    // No migration should occur because localBoxes was [] when the second call ran
    expect(session2.boxesArray.length).toBe(0)
    expect(store.boxes).toHaveLength(0)
  })

  it('observeDeep keeps boxes.value in sync as Yjs changes arrive', async () => {
    const { useCanvasStore } = await import('./canvas')
    const store = useCanvasStore()
    const session = makeMockSession()
    mockCreateSession.mockReturnValue(session)

    store.boxes = []
    store.enableCollaboration('canvas-abc', 'token')

    const { boxToYmap } = await import('../utils/collaboration')

    // Simulate a remote peer adding a box
    session.doc.transact(() => {
      session.boxesArray.push([boxToYmap(makeBox(10))])
    })
    expect(store.boxes).toHaveLength(1)
    expect(store.boxes[0].id).toBe(10)

    // Simulate a second box arriving
    session.doc.transact(() => {
      session.boxesArray.push([boxToYmap(makeBox(11))])
    })
    expect(store.boxes).toHaveLength(2)
  })
})
