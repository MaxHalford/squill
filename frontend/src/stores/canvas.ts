import { defineStore } from 'pinia'
import { ref, shallowRef, watch, computed, onScopeDispose } from 'vue'
import type { Box, BoxType, Position, Size, CanvasMeta, CanvasData, MultiCanvasIndex } from '../types/canvas'
import type { DatabaseEngine } from '../types/database'
import { getDefaultQuery } from '../constants/defaultQueries'
import { computeExplodeLayout } from '../utils/cteParser'
import type { ExplodedQuery } from '../utils/cteParser'
import { CanvasDataSchema, MultiCanvasIndexSchema } from '../utils/storageSchemas'
import { loadItem, saveItem, deleteItem } from '../utils/storage'
import {
  createCollaborationSession,
  destroyCollaborationSession,
  ymapToBox,
  boxToYmap,
  type CollaborationSession,
  type CursorState,
} from '../utils/collaboration'

// Debounce utility for auto-save
const debounce = <T extends (...args: unknown[]) => void>(fn: T, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId)
  }
  debounced.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      fn()
    }
  }
  return debounced
}

// Short, memorable painting names for new canvases
const PAINTING_NAMES = [
  // Classics
  'Starry Night', 'Water Lilies', 'The Kiss', 'Girl with Pearl',
  'The Scream', 'Blue Nude', 'The Dream', 'American Gothic', 'The Birth',
  'Café Terrace', 'The Wave', 'Night Watch', 'Mona Lisa', 'The Garden',
  'Water Path', 'Red Room', 'Hay Wain', 'The Storm', 'Blue Boy',
  'Las Meninas', 'The Tower', 'The Pearl', 'The Swing', 'The Raft',
  'Grande Jatte', 'The Arnolfini', 'The Gleaners', 'Whistler Mom',
  'The Bather', 'Blue Dancers', 'Bar Folies', 'La Moulin',
  'The Card Players', 'Mont Sainte', 'Almond Blossom', 'The Sower',
  // Edward Hopper
  'Morning Sun', 'Night Windows', 'Hotel Room', 'Office at Night',
  'Cape Cod Morning', 'Chop Suey', 'Early Sunday', 'New York Movie',
  'Room in Brooklyn', 'Western Motel', 'Sun Empty Room', 'Gas Station',
  // Modern & Contemporary
  'Campbell Soup', 'Shot Marilyn', 'Number One', 'Black Square',
  'Orange Red Yellow', 'Balloon Dog', 'Weather Project',
  'Cloud Gate', 'Infinity Room', 'Love Sculpture',
  'Spiral Jetty', 'Wrapped Reichstag', 'Poppy Field'
]

// Get a random painting name
const getRandomPaintingName = (): string => {
  return PAINTING_NAMES[Math.floor(Math.random() * PAINTING_NAMES.length)]
}

// Tree names for query boxes (8 chars or less)
const TREE_NAMES = [
  'Oak', 'Pine', 'Maple', 'Birch', 'Cedar', 'Willow', 'Elm', 'Ash',
  'Beech', 'Spruce', 'Fir', 'Walnut', 'Cherry', 'Apple', 'Pear', 'Plum',
  'Peach', 'Olive', 'Palm', 'Cypress', 'Juniper', 'Hemlock', 'Hickory',
  'Chestnut', 'Magnolia', 'Dogwood', 'Redwood', 'Sequoia', 'Acacia', 'Aspen',
  'Alder', 'Poplar', 'Larch', 'Yew', 'Holly', 'Hazel', 'Rowan', 'Laurel',
  'Myrtle', 'Banyan', 'Baobab', 'Bamboo', 'Teak', 'Ebony', 'Mahogany',
  'Sycamore', 'Mulberry', 'Hawthorn', 'Tamarind', 'Buckeye', 'Fig', 'Linden',
  'Locust', 'Mimosa', 'Catalpa', 'Ginkgo', 'Tupelo', 'Osage',
]

// Get a unique tree name that isn't already used
const getUniqueTreeName = (existingNames: string[]): string => {
  const usedNames = new Set(existingNames.map(n => n.toLowerCase()))
  const available = TREE_NAMES.filter(name => !usedNames.has(name.toLowerCase()))

  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)].toLowerCase()
  }

  // Fallback: all trees used, add numeric suffix
  let suffix = 2
  while (true) {
    const candidate = `${TREE_NAMES[Math.floor(Math.random() * TREE_NAMES.length)].toLowerCase()} ${suffix}`
    if (!usedNames.has(candidate)) {
      return candidate
    }
    suffix++
  }
}

// Wizard names for chat boxes (single word, lowercase)
const WIZARD_NAMES = [
  'gandalf', 'merlin', 'dumbledore', 'rincewind', 'raistlin', 'elminster',
  'morgana', 'circe', 'prospero', 'medea', 'mordred',
  'saruman', 'radagast', 'voldemort', 'jafar', 'maleficent', 'zatanna',
  'khadgar', 'medivh', 'nostradamus', 'babayaga',
  'zoroaster', 'hermes', 'orpheus', 'viviane', 'nimue', 'oberon',
  'titania', 'sauron', 'galadriel', 'arwen',
]

// Get a unique wizard name that isn't already used
const getUniqueWizardName = (existingNames: string[]): string => {
  const usedNames = new Set(existingNames.map(n => n.toLowerCase()))
  const available = WIZARD_NAMES.filter(name => !usedNames.has(name))

  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]
  }

  // Fallback: all wizards used, add numeric suffix
  let suffix = 2
  while (true) {
    const candidate = `${WIZARD_NAMES[Math.floor(Math.random() * WIZARD_NAMES.length)]} ${suffix}`
    if (!usedNames.has(candidate)) {
      return candidate
    }
    suffix++
  }
}

// Generate UUID
const generateCanvasId = (): string => {
  return crypto.randomUUID()
}

interface CanvasExposed {
  getViewportCenter: () => Position
  panToBox: (id: number) => void
  screenToCanvas: (screenX: number, screenY: number) => Position
  fitToView: () => void
  fitToBoxIds: (boxIds: number[]) => void
  zoom: number
}

interface UndoRedoState {
  boxes: Box[]
  selectedBoxId: number | null
  nextBoxId: number
}

export const useCanvasStore = defineStore('canvas', () => {
  // Multi-canvas state
  const canvasIndex = ref<CanvasMeta[]>([])
  const activeCanvasId = ref<string | null>(null)

  // Current canvas state
  const boxes = ref<Box[]>([])
  const selectedBoxId = ref<number | null>(null)
  const selectionHistory = ref<number[]>([])
  const nextBoxId = ref(1)

  // Canvas reference for getting viewport center
  const canvasRef = ref<CanvasExposed | null>(null)

  // Multi-selection state
  const selectedBoxIds = ref<Set<number>>(new Set())

  // Dragging state
  const isDraggingBox = ref(false)

  // Rectangle selection state
  const rectangleSelection = ref<{ startX: number; startY: number; endX: number; endY: number } | null>(null)

  // Undo/Redo stacks (used in non-collaborative mode only)
  const undoStack = ref<UndoRedoState[]>([])
  const redoStack = ref<UndoRedoState[]>([])

  // Collaborative mode (Yjs + Hocuspocus, Pro users only)
  // shallowRef prevents Vue from deep-proxying Yjs/Hocuspocus internals
  const session = shallowRef<CollaborationSession | null>(null)
  const isCollaborative = computed(() => session.value !== null)
  const isHocuspocusConnected = ref(false)
  const isReadOnly = ref(false)
  let unobserveYjs: (() => void) | null = null
  let unobserveAwareness: (() => void) | null = null
  const remoteCursors = shallowRef<Map<number, CursorState>>(new Map())

  // Computed: active canvas name for display
  const activeCanvasName = computed(() => {
    const canvas = canvasIndex.value.find(c => c.id === activeCanvasId.value)
    return canvas?.name ?? 'Canvas'
  })

  // ============================================
  // Multi-canvas storage functions
  // ============================================

  const saveIndex = () => {
    const index: MultiCanvasIndex = {
      version: 1,
      activeCanvasId: activeCanvasId.value!,
      canvases: canvasIndex.value
    }
    saveItem('canvas:index', index).catch(error => {
      console.error('Failed to save canvas index:', error)
    })
  }

  const loadIndex = async (): Promise<MultiCanvasIndex | null> => {
    try {
      const data = await loadItem<MultiCanvasIndex>('canvas:index')
      if (!data) return null
      const result = MultiCanvasIndexSchema.safeParse(data)
      if (result.success) return result.data
      console.warn('Canvas index validation failed:', result.error.issues)
      return null
    } catch (error) {
      console.error('Failed to load canvas index:', error)
      return null
    }
  }

  const saveCanvasData = (canvasId: string) => {
    const canvas = canvasIndex.value.find(c => c.id === canvasId)
    if (!canvas) return

    const data: CanvasData = {
      id: canvasId,
      name: canvas.name,
      createdAt: canvas.createdAt,
      updatedAt: Date.now(),
      boxes: boxes.value,
      nextBoxId: nextBoxId.value
    }
    saveItem(`canvas:${canvasId}`, data).catch(error => {
      console.error('Failed to save canvas data:', error)
    })

    // Update timestamp in index
    canvas.updatedAt = data.updatedAt
    saveIndex()
  }

  const loadCanvasData = async (canvasId: string): Promise<CanvasData | null> => {
    try {
      const data = await loadItem<CanvasData>(`canvas:${canvasId}`)
      if (!data) return null
      const result = CanvasDataSchema.safeParse(data)
      if (result.success) return result.data
      console.warn('Canvas data validation failed:', result.error.issues)
      return null
    } catch (error) {
      console.error('Failed to load canvas data:', error)
      return null
    }
  }

  const deleteCanvasData = (canvasId: string) => {
    deleteItem(`canvas:${canvasId}`).catch(error => {
      console.error('Failed to delete canvas data:', error)
    })
  }

  // ============================================
  // Load state (main entry point)
  // ============================================

  const loadState = async () => {
    // Load index
    const index = await loadIndex()

    if (index && index.canvases.length > 0) {
      canvasIndex.value = index.canvases
      activeCanvasId.value = index.activeCanvasId

      // Load active canvas data
      const data = await loadCanvasData(index.activeCanvasId)
      if (data) {
        boxes.value = data.boxes
        nextBoxId.value = data.nextBoxId
      } else {
        // Canvas data missing, reset
        boxes.value = []
        nextBoxId.value = 1
      }
    } else {
      // No existing data, create default canvas
      createCanvas('Canvas 1')
    }

    // Clear undo/redo stacks on load
    undoStack.value = []
    redoStack.value = []
  }

  // Save current canvas (for auto-save)
  const saveState = () => {
    if (activeCanvasId.value) {
      saveCanvasData(activeCanvasId.value)
    }
  }

  // Debounced auto-save to prevent IDB thrashing during drag operations
  const debouncedSaveState = debounce(saveState, 500)

  // Watch for changes and auto-save to IDB (debounced, skipped in collaborative mode)
  watch([boxes, nextBoxId], () => {
    if (!isCollaborative.value) debouncedSaveState()
  }, { deep: true })

  // Flush pending saves when store scope is disposed
  onScopeDispose(() => {
    debouncedSaveState.flush()
  })

  // ============================================
  // Canvas management actions
  // ============================================

  const createCanvas = (name?: string): string => {
    // Save current canvas first if exists (IDB only; collaborative saves are handled by Hocuspocus)
    if (activeCanvasId.value && !isCollaborative.value) {
      saveCanvasData(activeCanvasId.value)
    }

    const now = Date.now()
    const canvasId = generateCanvasId()
    const canvasName = name || getRandomPaintingName()

    // Add to index
    const meta: CanvasMeta = {
      id: canvasId,
      name: canvasName,
      createdAt: now,
      updatedAt: now
    }
    canvasIndex.value.push(meta)

    // Create empty canvas data
    const data: CanvasData = {
      id: canvasId,
      name: canvasName,
      createdAt: now,
      updatedAt: now,
      boxes: [],
      nextBoxId: 1
    }
    saveItem(`canvas:${canvasId}`, data).catch(console.error)

    // Switch to new canvas
    activeCanvasId.value = canvasId
    boxes.value = []
    nextBoxId.value = 1
    selectedBoxId.value = null
    selectedBoxIds.value.clear()
    selectionHistory.value = []
    undoStack.value = []
    redoStack.value = []

    saveIndex()
    return canvasId
  }

  const switchCanvas = async (canvasId: string) => {
    if (canvasId === activeCanvasId.value) return

    // Disconnect collaboration before switching canvases
    disableCollaboration()

    // Flush pending saves before switching (IDB only)
    if (!isCollaborative.value) debouncedSaveState.flush()

    // Save current canvas (IDB only; Hocuspocus handles collaborative saves)
    if (activeCanvasId.value && !isCollaborative.value) {
      saveCanvasData(activeCanvasId.value)
    }

    // Load new canvas
    const data = await loadCanvasData(canvasId)
    if (data) {
      activeCanvasId.value = canvasId
      boxes.value = data.boxes
      nextBoxId.value = data.nextBoxId
      selectedBoxId.value = null
      selectedBoxIds.value.clear()
      selectionHistory.value = []
      undoStack.value = []
      redoStack.value = []
      saveIndex()
    }
  }

  const deleteCanvas = async (canvasId: string) => {
    const index = canvasIndex.value.findIndex(c => c.id === canvasId)
    if (index === -1) return

    // Don't delete the last canvas
    if (canvasIndex.value.length === 1) {
      console.warn('Cannot delete the last canvas')
      return
    }

    // Remove from index
    canvasIndex.value.splice(index, 1)

    // Delete canvas data
    deleteCanvasData(canvasId)

    // If deleting active canvas, switch to another
    if (canvasId === activeCanvasId.value) {
      const newActive = canvasIndex.value[0]
      await switchCanvas(newActive.id)
    } else {
      saveIndex()
    }
  }

  const duplicateCanvas = async (canvasId: string): Promise<string | null> => {
    const sourceMeta = canvasIndex.value.find(c => c.id === canvasId)
    if (!sourceMeta) return null

    const sourceData = await loadCanvasData(canvasId)
    if (!sourceData) return null

    // Save current canvas first (IDB only)
    if (activeCanvasId.value && !isCollaborative.value) {
      saveCanvasData(activeCanvasId.value)
    }

    const now = Date.now()
    const newCanvasId = generateCanvasId()
    const newName = `${sourceMeta.name} (copy)`

    // Create new canvas meta
    const meta: CanvasMeta = {
      id: newCanvasId,
      name: newName,
      createdAt: now,
      updatedAt: now
    }
    canvasIndex.value.push(meta)

    // Deep clone boxes with new IDs
    const idMapping = new Map<number, number>()
    let newNextBoxId = 1
    const newBoxes = sourceData.boxes.map(box => {
      const newId = newNextBoxId++
      idMapping.set(box.id, newId)
      return { ...box, id: newId }
    })

    // Update dependencies to use new IDs
    newBoxes.forEach(box => {
      box.dependencies = box.dependencies.map(depId => idMapping.get(depId) ?? depId)
    })

    // Create canvas data
    const data: CanvasData = {
      id: newCanvasId,
      name: newName,
      createdAt: now,
      updatedAt: now,
      boxes: newBoxes,
      nextBoxId: newNextBoxId
    }
    saveItem(`canvas:${newCanvasId}`, data).catch(console.error)

    // Switch to new canvas
    activeCanvasId.value = newCanvasId
    boxes.value = newBoxes
    nextBoxId.value = newNextBoxId
    selectedBoxId.value = null
    selectedBoxIds.value.clear()
    selectionHistory.value = []
    undoStack.value = []
    redoStack.value = []

    saveIndex()
    return newCanvasId
  }

  const renameCanvas = async (canvasId: string, newName: string) => {
    const meta = canvasIndex.value.find(c => c.id === canvasId)
    if (!meta) return

    meta.name = newName
    meta.updatedAt = Date.now()

    // If renaming active canvas, also update stored data
    if (canvasId === activeCanvasId.value) {
      saveCanvasData(canvasId)
    } else {
      // Update stored canvas data name
      const data = await loadCanvasData(canvasId)
      if (data) {
        data.name = newName
        data.updatedAt = meta.updatedAt
        saveItem(`canvas:${canvasId}`, data).catch(console.error)
      }
    }

    saveIndex()
  }

  const setCanvasShared = (canvasId: string, isShared: boolean) => {
    const meta = canvasIndex.value.find(c => c.id === canvasId)
    if (!meta) return
    meta.isShared = isShared
    saveIndex()
  }

  const setShareToken = (canvasId: string, token: string, permission: 'read' | 'write') => {
    const meta = canvasIndex.value.find(c => c.id === canvasId)
    if (!meta) return
    meta.shareToken = token
    meta.sharePermission = permission
    saveIndex()
  }

  const clearShareToken = (canvasId: string) => {
    const meta = canvasIndex.value.find(c => c.id === canvasId)
    if (!meta) return
    delete meta.shareToken
    delete meta.sharePermission
    saveIndex()
  }

  const getCanvasList = (): CanvasMeta[] => {
    return [...canvasIndex.value].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ============================================
  // Box management (unchanged from original)
  // ============================================

  const getMaxZIndex = (): number => {
    if (boxes.value.length === 0) return 0
    return Math.max(...boxes.value.map(box => box.zIndex || 0))
  }

  const saveToUndoStack = () => {
    // In collaborative mode, Y.UndoManager tracks history automatically
    if (isCollaborative.value) return
    undoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })
    if (undoStack.value.length > 50) {
      undoStack.value.shift()
    }
    redoStack.value = []
  }

  const undo = () => {
    if (isCollaborative.value) {
      session.value!.undoManager.undo()
      return
    }
    if (undoStack.value.length === 0) return

    redoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })

    const previousState = undoStack.value.pop()!
    boxes.value = previousState.boxes
    selectedBoxId.value = previousState.selectedBoxId
    nextBoxId.value = previousState.nextBoxId
  }

  const redo = () => {
    if (isCollaborative.value) {
      session.value!.undoManager.redo()
      return
    }
    if (redoStack.value.length === 0) return

    undoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })

    const nextState = redoStack.value.pop()!
    boxes.value = nextState.boxes
    selectedBoxId.value = nextState.selectedBoxId
    nextBoxId.value = nextState.nextBoxId
  }

  const addBox = (
    type: BoxType = 'sql',
    position: Position | null = null,
    engine?: DatabaseEngine,
    connectionId?: string
  ): number => {
    saveToUndoStack()

    let centerPosition: Position | null = null
    if (!position && canvasRef.value) {
      centerPosition = canvasRef.value.getViewportCenter()
    }

    const defaultX = 100 + Math.random() * 200
    const defaultY = 100 + Math.random() * 200

    const boxId = nextBoxId.value++

    const width = type === 'note' ? 400 :
                  type === 'detail' ? 400 :
                  type === 'analytics' ? 800 :
                  type === 'schema' ? 800 :
                  type === 'history' ? 700 :
                  type === 'chat' ? 1000 :
                  type === 'explain' ? 600 : 600
    const height = type === 'note' ? 300 :
                   type === 'detail' ? 500 :
                   type === 'analytics' ? 500 :
                   type === 'schema' ? 600 :
                   type === 'history' ? 500 :
                   type === 'chat' ? 600 :
                   type === 'explain' ? 500 : 500

    const newBox: Box = {
      id: boxId,
      type: type,
      x: position ? position.x - width / 2 : (centerPosition ? centerPosition.x - width / 2 : defaultX),
      y: position ? position.y - height / 2 : (centerPosition ? centerPosition.y - height / 2 : defaultY),
      width: width,
      height: height,
      zIndex: getMaxZIndex() + 1,
      query: type === 'sql' ? getDefaultQuery(engine) : '',
      name: type === 'sql' ? getUniqueTreeName(boxes.value.map(b => b.name)) :
            type === 'note' ? `note_${boxId}` :
            type === 'detail' ? `row_detail_${boxId}` :
            type === 'analytics' ? `analytics_${boxId}` :
            type === 'history' ? 'Query history' :
            type === 'schema' ? 'Schema browser' :
            type === 'chat' ? getUniqueWizardName(boxes.value.map(b => b.name)) :
            type === 'explain' ? `explain_${boxId}` :
            `box_${boxId}`,
      dependencies: [],
      connectionId: connectionId
    }
    if (isCollaborative.value) {
      const s = session.value!
      s.doc.transact(() => {
        s.boxesArray.push([boxToYmap(newBox)])
        s.canvasMap.set('nextBoxId', nextBoxId.value)
      })
    } else {
      boxes.value.push(newBox)
    }
    return newBox.id
  }

  /**
   * Replace a SQL box with one box per CTE plus a box for the final query.
   * Boxes are arranged in topological order (left → right by dependency depth).
   * The original box is removed; undo covers the whole operation.
   */
  const explodeBox = (boxId: number, exploded: ExplodedQuery): number[] => {
    const origBox = boxes.value.find(b => b.id === boxId)
    if (!origBox || exploded.ctes.length === 0) return []

    saveToUndoStack()

    const BOX_W = 600
    const BOX_H = 500
    const layout = computeExplodeLayout(
      exploded,
      origBox.name,
      origBox.x,
      origBox.y,
      origBox.height,
      BOX_W,
      BOX_H,
    )

    // Build new boxes
    const nameToId = new Map<string, number>()
    const newBoxes: Box[] = layout.items.map(item => {
      const id = nextBoxId.value++
      nameToId.set(item.name.toLowerCase(), id)
      return {
        id,
        type: 'sql' as BoxType,
        x: item.x,
        y: item.y,
        width: BOX_W,
        height: BOX_H,
        zIndex: getMaxZIndex() + 1,
        query: item.query,
        name: item.name,
        connectionId: origBox.connectionId,
        dependencies: [],
      }
    })

    // Wire up dependencies between CTE boxes
    for (const cte of exploded.ctes) {
      const boxForCTE = newBoxes.find(b => b.name === cte.name)
      if (!boxForCTE) continue
      boxForCTE.dependencies = cte.referencedCTEs
        .map(refName => nameToId.get(refName.toLowerCase()))
        .filter((id): id is number => id !== undefined)
    }
    // Final query box depends on all CTE boxes
    const finalBox = newBoxes.find(b => b.name === origBox.name)
    if (finalBox) {
      finalBox.dependencies = [...nameToId.values()].filter(id => id !== finalBox.id)
    }

    if (isCollaborative.value) {
      const s = session.value!
      s.doc.transact(() => {
        const origIndex = boxes.value.findIndex(b => b.id === boxId)
        if (origIndex !== -1) s.boxesArray.delete(origIndex, 1)
        for (const box of newBoxes) s.boxesArray.push([boxToYmap(box)])
        s.canvasMap.set('nextBoxId', nextBoxId.value)
      })
    } else {
      const origIndex = boxes.value.findIndex(b => b.id === boxId)
      if (origIndex !== -1) boxes.value.splice(origIndex, 1)
      boxes.value.push(...newBoxes)
    }

    return newBoxes.map(b => b.id)
  }

  const setCanvasRef = (ref: CanvasExposed | null) => {
    canvasRef.value = ref
  }

  const removeBox = (id: number): number | null => {
    const index = boxes.value.findIndex(box => box.id === id)
    if (index !== -1) {
      saveToUndoStack()
      if (isCollaborative.value) {
        session.value!.doc.transact(() => {
          session.value!.boxesArray.delete(index, 1)
        })
      } else {
        boxes.value.splice(index, 1)
      }

      selectionHistory.value = selectionHistory.value.filter(historyId => historyId !== id)

      if (selectedBoxId.value === id) {
        selectedBoxId.value = null

        while (selectionHistory.value.length > 0) {
          const prevId = selectionHistory.value.pop()!
          if (boxes.value.find(b => b.id === prevId)) {
            return prevId
          }
        }
      }
    }
    return null
  }

  const selectBox = (id: number) => {
    if (selectedBoxId.value !== null && selectedBoxId.value !== id) {
      selectionHistory.value.push(selectedBoxId.value)
      if (selectionHistory.value.length > 50) {
        selectionHistory.value.shift()
      }
    }

    selectedBoxId.value = id
    selectedBoxIds.value.clear() // Clear multi-selection when selecting a single box

    const box = boxes.value.find(b => b.id === id)
    if (box) {
      const maxZ = getMaxZIndex()
      if (box.zIndex < maxZ) {
        updateBoxZIndex(id, maxZ + 1)
      }
    }
  }

  const deselectBox = () => {
    selectedBoxId.value = null
    selectedBoxIds.value.clear()
  }

  const isBoxSelected = (id: number): boolean => {
    return selectedBoxId.value === id || selectedBoxIds.value.has(id)
  }

  // Pre-computed selection map: avoids per-box method calls in template
  const boxSelectionMap = computed(() => {
    const map = new Map<number, boolean>()
    if (selectedBoxId.value !== null) {
      map.set(selectedBoxId.value, true)
    }
    for (const id of selectedBoxIds.value) {
      map.set(id, true)
    }
    return map
  })

  const selectMultipleBoxes = (boxIds: number[]) => {
    selectedBoxId.value = null
    selectedBoxIds.value = new Set(boxIds)
  }

  const clearSelection = () => {
    selectedBoxId.value = null
    selectedBoxIds.value.clear()
  }

  const setRectangleSelection = (coords: { startX: number; startY: number; endX: number; endY: number } | null) => {
    rectangleSelection.value = coords
  }

  const setDraggingBox = (dragging: boolean) => {
    isDraggingBox.value = dragging
  }

  const removeMultipleBoxes = (boxIds: number[]) => {
    if (boxIds.length === 0) return

    saveToUndoStack()

    const idsToRemove = new Set(boxIds)
    if (isCollaborative.value) {
      const s = session.value!
      s.doc.transact(() => {
        // Delete from highest index to lowest to preserve indices
        const indices: number[] = []
        s.boxesArray.toArray().forEach((ymap, i) => {
          if (idsToRemove.has(ymap.get('id') as number)) indices.push(i)
        })
        for (let i = indices.length - 1; i >= 0; i--) {
          s.boxesArray.delete(indices[i], 1)
        }
      })
    } else {
      boxes.value = boxes.value.filter(box => !idsToRemove.has(box.id))
    }

    selectedBoxId.value = null
    selectedBoxIds.value.clear()
  }

  // Helper: update one or more fields on a box Y.Map (collaborative) or plain object (local)
  const updateBoxFields = (id: number, fields: Partial<Box>) => {
    if (isCollaborative.value) {
      const s = session.value!
      const ymap = s.boxesArray.toArray().find(m => m.get('id') === id)
      if (ymap) {
        s.doc.transact(() => {
          for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) ymap.set(key, value)
          }
        })
      }
    } else {
      const box = boxes.value.find(b => b.id === id)
      if (box) Object.assign(box, fields)
    }
  }

  const updateBoxPosition = (id: number, position: Position) => {
    updateBoxFields(id, { x: position.x, y: position.y })
  }

  const updateBoxSize = (id: number, size: Size) => {
    updateBoxFields(id, { width: size.width, height: size.height })
  }

  const updateBoxQuery = (id: number, query: string) => {
    updateBoxFields(id, { query })
  }

  const updateBoxName = (id: number, name: string) => {
    updateBoxFields(id, { name })
  }

  const updateBoxEditorHeight = (id: number, height: number) => {
    updateBoxFields(id, { editorHeight: height })
  }

  const updateBoxZIndex = (id: number, zIndex: number) => {
    updateBoxFields(id, { zIndex })
  }

  const updateBoxDependencies = (id: number, dependencies: number[]) => {
    updateBoxFields(id, { dependencies })
  }

  const getDownstreamBoxIds = (boxId: number): number[] => {
    return boxes.value
      .filter(b => b.dependencies?.includes(boxId))
      .map(b => b.id)
  }

  const updateBoxConnectionId = (id: number, connectionId: string | undefined) => {
    updateBoxFields(id, { connectionId })
  }

  const clearAll = () => {
    boxes.value = []
    selectedBoxId.value = null
    nextBoxId.value = 1
  }

  const resetToDefault = () => {
    boxes.value = []
    selectedBoxId.value = null
    nextBoxId.value = 1
  }

  const copyBox = (id: number): number | null => {
    const originalBox = boxes.value.find(b => b.id === id)
    if (!originalBox) return null

    saveToUndoStack()
    const OFFSET = 30
    const boxId = nextBoxId.value++

    const newName = originalBox.type === 'sql' ? getUniqueTreeName(boxes.value.map(b => b.name)) :
                    originalBox.type === 'note' ? `note_${boxId}` :
                    originalBox.type === 'detail' ? `row_detail_${boxId}` :
                    originalBox.type === 'analytics' ? `analytics_${boxId}` :
                    originalBox.type === 'history' ? 'Query history' :
                    originalBox.type === 'explain' ? `explain_${boxId}` :
                    `schema_${boxId}`

    const newBox: Box = {
      id: boxId,
      type: originalBox.type,
      x: originalBox.x + OFFSET,
      y: originalBox.y + OFFSET,
      width: originalBox.width,
      height: originalBox.height,
      zIndex: getMaxZIndex() + 1,
      query: originalBox.query,
      name: newName,
      dependencies: [],
      connectionId: originalBox.connectionId,
      editorHeight: originalBox.editorHeight
    }
    if (isCollaborative.value) {
      const s = session.value!
      s.doc.transact(() => {
        s.boxesArray.push([boxToYmap(newBox)])
        s.canvasMap.set('nextBoxId', nextBoxId.value)
      })
    } else {
      boxes.value.push(newBox)
    }
    return newBox.id
  }

  const copyMultipleBoxes = (ids: number[]): number[] => {
    if (ids.length === 0) return []

    const originalBoxes = ids
      .map(id => boxes.value.find(b => b.id === id))
      .filter(box => box !== undefined) as Box[]

    if (originalBoxes.length === 0) return []

    saveToUndoStack()
    const OFFSET = 30
    const newBoxIds: number[] = []

    originalBoxes.forEach(originalBox => {
      const boxId = nextBoxId.value++

      const newName = originalBox.type === 'sql' ? getUniqueTreeName(boxes.value.map(b => b.name)) :
                      originalBox.type === 'note' ? `note_${boxId}` :
                      originalBox.type === 'detail' ? `row_detail_${boxId}` :
                      originalBox.type === 'analytics' ? `analytics_${boxId}` :
                      originalBox.type === 'history' ? 'Query history' :
                      originalBox.type === 'explain' ? `explain_${boxId}` :
                      `schema_${boxId}`

      const newBox: Box = {
        id: boxId,
        type: originalBox.type,
        x: originalBox.x + OFFSET,
        y: originalBox.y + OFFSET,
        width: originalBox.width,
        height: originalBox.height,
        zIndex: getMaxZIndex() + 1,
        query: originalBox.query,
        name: newName,
        dependencies: [],
        connectionId: originalBox.connectionId,
        editorHeight: originalBox.editorHeight
      }
      if (isCollaborative.value) {
        const s = session.value!
        s.doc.transact(() => {
          s.boxesArray.push([boxToYmap(newBox)])
          s.canvasMap.set('nextBoxId', nextBoxId.value)
        })
      } else {
        boxes.value.push(newBox)
      }
      newBoxIds.push(boxId)
    })

    return newBoxIds
  }

  // ============================================
  // Collaboration (Yjs + Hocuspocus, Pro only)
  // ============================================

  /**
   * Enable real-time collaboration for a canvas.
   * Connects to Hocuspocus and syncs state via Yjs.
   *
   * forceLocalMigration=true (owner paths): local IDB is always the source of
   * truth on first sync — overwrites any stale server state. Safe because this
   * only applies to the very first synced event; reconnects use server state.
   *
   * forceLocalMigration=false (share-link recipients): server is source of truth.
   */
  const enableCollaboration = (canvasId: string, token: string, forceLocalMigration = false) => {
    // Snapshot local IDB boxes NOW — before disableCollaboration or clearing
    const localBoxes = [...boxes.value]
    const localNextBoxId = nextBoxId.value
    console.log(`[collab] enableCollaboration canvas=${canvasId} localBoxes=${localBoxes.length} forceLocal=${forceLocalMigration}`)

    // Tear down any existing session first
    disableCollaboration()

    // Clear stale content immediately; Yjs will repopulate once synced
    boxes.value = []

    const s = createCollaborationSession(canvasId, token)
    session.value = s

    // Observe Yjs changes → keep boxes.value in sync
    const syncFromYjs = () => {
      const incoming = s.boxesArray.toArray().map(ymapToBox)
      console.log(`[collab] syncFromYjs boxes=${incoming.length}`)
      boxes.value = incoming
      const nextId = s.canvasMap.get('nextBoxId') as number | undefined
      if (nextId !== undefined) nextBoxId.value = nextId
    }
    s.boxesArray.observeDeep(syncFromYjs)
    s.canvasMap.observe(syncFromYjs)
    unobserveYjs = () => {
      s.boxesArray.unobserveDeep(syncFromYjs)
      s.canvasMap.unobserve(syncFromYjs)
    }

    // Track WebSocket connection status
    s.provider.on('status', ({ status }: { status: string }) => {
      console.log(`[collab] status=${status}`)
      isHocuspocusConnected.value = status === 'connected'
    })

    s.provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      console.error(`[collab] authenticationFailed: ${reason}`)
      // Share token was revoked or expired — clear it so we don't keep retrying
      clearShareToken(canvasId)
      disableCollaboration()
    })

    // After initial sync: migrate or sync.
    // syncedOnce guards against re-migration on WebSocket reconnects —
    // reconnects just re-apply current Yjs state without touching localBoxes.
    let syncedOnce = false
    s.provider.on('synced', () => {
      console.log(`[collab] synced yjsBoxes=${s.boxesArray.length} localBoxes=${localBoxes.length} syncedOnce=${syncedOnce}`)

      if (syncedOnce) {
        // Reconnect — Yjs already has the live state; just ensure boxes.value is current
        syncFromYjs()
        return
      }
      syncedOnce = true

      // Only the owner (forceLocalMigration=true) ever pushes local IDB to Yjs.
      // Share-link recipients always trust the server, even if it's empty.
      const shouldMigrate = forceLocalMigration && localBoxes.length > 0
      if (shouldMigrate) {
        console.log(`[collab] migrating ${localBoxes.length} local boxes to Yjs (force=${forceLocalMigration})`)
        s.doc.transact(() => {
          // Clear any stale server data before pushing local state
          if (s.boxesArray.length > 0) s.boxesArray.delete(0, s.boxesArray.length)
          s.canvasMap.set('nextBoxId', localNextBoxId)
          for (const box of localBoxes) {
            s.boxesArray.push([boxToYmap(box)])
          }
        })
      } else {
        console.log(`[collab] syncing ${s.boxesArray.length} boxes from server`)
        syncFromYjs()
      }
    })

    // Awareness: track other users' cursors
    if (s.awareness) {
      const awareness = s.awareness
      const handleAwarenessChange = () => {
        const states = awareness.getStates()
        const newMap = new Map<number, CursorState>()
        states.forEach((state, clientId) => {
          if (clientId === s.doc.clientID) return
          const cursor = state.cursor as (Omit<CursorState, 'clientId'> | null | undefined)
          if (cursor) newMap.set(clientId, { ...cursor, clientId })
        })
        remoteCursors.value = newMap
      }
      awareness.on('change', handleAwarenessChange)
      unobserveAwareness = () => awareness.off('change', handleAwarenessChange)
    }
  }

  const setLocalCursor = (x: number, y: number, name: string, color: string) => {
    const awareness = session.value?.awareness
    if (!awareness) return
    awareness.setLocalStateField('cursor', { x, y, name, color })
  }

  const clearLocalCursor = () => {
    session.value?.awareness?.setLocalStateField('cursor', null)
  }

  /**
   * Disable collaborative mode and disconnect from Hocuspocus.
   * Canvas data stays in PostgreSQL; local boxes.value is unchanged.
   */
  const disableCollaboration = () => {
    if (unobserveYjs) { unobserveYjs(); unobserveYjs = null }
    if (unobserveAwareness) { unobserveAwareness(); unobserveAwareness = null }
    if (session.value) {
      destroyCollaborationSession(session.value)
      session.value = null
    }
    isHocuspocusConnected.value = false
    isReadOnly.value = false
    remoteCursors.value = new Map()
  }

  // Clean up on store dispose
  onScopeDispose(() => {
    disableCollaboration()
  })

  return {
    // Multi-canvas state
    canvasIndex,
    activeCanvasId,
    activeCanvasName,

    // Canvas management actions
    createCanvas,
    switchCanvas,
    deleteCanvas,
    duplicateCanvas,
    renameCanvas,
    setCanvasShared,
    setShareToken,
    clearShareToken,
    getCanvasList,

    // Current canvas state
    boxes,
    selectedBoxId,
    selectionHistory,
    selectedBoxIds,
    rectangleSelection,
    isDraggingBox,
    canvasRef,

    // State management
    loadState,

    // Box management
    addBox,
    explodeBox,
    removeBox,
    selectBox,
    deselectBox,
    isBoxSelected,
    boxSelectionMap,
    selectMultipleBoxes,
    clearSelection,
    setRectangleSelection,
    setDraggingBox,
    removeMultipleBoxes,
    updateBoxPosition,
    updateBoxSize,
    updateBoxQuery,
    updateBoxName,
    updateBoxEditorHeight,
    updateBoxZIndex,
    updateBoxDependencies,
    getDownstreamBoxIds,
    updateBoxConnectionId,
    getMaxZIndex,
    clearAll,
    resetToDefault,
    copyBox,
    copyMultipleBoxes,
    undo,
    redo,
    setCanvasRef,

    // Collaboration
    isCollaborative,
    isHocuspocusConnected,
    isReadOnly,
    remoteCursors,
    setLocalCursor,
    clearLocalCursor,
    enableCollaboration,
    disableCollaboration,
  }
})
