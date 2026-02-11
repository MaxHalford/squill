import { defineStore } from 'pinia'
import { ref, watch, computed, onScopeDispose } from 'vue'
import type { Box, BoxType, Position, Size, CanvasMeta, CanvasData, MultiCanvasIndex, ViewportBounds } from '../types/canvas'
import type { DatabaseEngine } from '../types/database'
import { getDefaultQuery } from '../constants/defaultQueries'
import { CanvasDataSchema, MultiCanvasIndexSchema } from '../utils/storageSchemas'
import { loadItem, saveItem, deleteItem } from '../utils/storage'

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

  // Undo/Redo stacks
  const undoStack = ref<UndoRedoState[]>([])
  const redoStack = ref<UndoRedoState[]>([])

  // Viewport culling state
  const viewportBounds = ref<ViewportBounds | null>(null)
  const VIEWPORT_PADDING = 200 // Extra padding around viewport for culling

  // Computed: active canvas name for display
  const activeCanvasName = computed(() => {
    const canvas = canvasIndex.value.find(c => c.id === activeCanvasId.value)
    return canvas?.name ?? 'Canvas'
  })

  // Computed: boxes that intersect the viewport (with padding)
  const visibleBoxes = computed(() => {
    const bounds = viewportBounds.value
    // If no viewport bounds set yet, return all boxes
    if (!bounds) return boxes.value

    const { left, top, right, bottom } = bounds
    const padding = VIEWPORT_PADDING

    return boxes.value.filter(box => {
      // Box intersects viewport if it's not completely outside
      return box.x + box.width > left - padding &&
             box.x < right + padding &&
             box.y + box.height > top - padding &&
             box.y < bottom + padding
    })
  })

  // Action: update viewport bounds (called by InfiniteCanvas)
  const setViewportBounds = (bounds: ViewportBounds) => {
    viewportBounds.value = bounds
  }

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

  // Watch for changes and auto-save (debounced)
  watch([boxes, nextBoxId], () => {
    debouncedSaveState()
  }, { deep: true })

  // Flush pending saves when store scope is disposed
  onScopeDispose(() => {
    debouncedSaveState.flush()
  })

  // ============================================
  // Canvas management actions
  // ============================================

  const createCanvas = (name?: string): string => {
    // Save current canvas first if exists
    if (activeCanvasId.value) {
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

    // Flush pending saves before switching
    debouncedSaveState.flush()

    // Save current canvas
    if (activeCanvasId.value) {
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

    // Save current canvas first
    if (activeCanvasId.value) {
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
                  type === 'analytics' ? 450 :
                  type === 'schema' ? 800 :
                  type === 'history' ? 700 :
                  type === 'chat' ? 1000 : 600
    const height = type === 'note' ? 300 :
                   type === 'detail' ? 500 :
                   type === 'analytics' ? 400 :
                   type === 'schema' ? 600 :
                   type === 'history' ? 500 :
                   type === 'chat' ? 600 : 500

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
            `box_${boxId}`,
      dependencies: [],
      connectionId: connectionId
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  const setCanvasRef = (ref: CanvasExposed | null) => {
    canvasRef.value = ref
  }

  const removeBox = (id: number): number | null => {
    const index = boxes.value.findIndex(box => box.id === id)
    if (index !== -1) {
      saveToUndoStack()
      boxes.value.splice(index, 1)

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
        box.zIndex = maxZ + 1
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
    boxes.value = boxes.value.filter(box => !idsToRemove.has(box.id))

    selectedBoxId.value = null
    selectedBoxIds.value.clear()
  }

  const updateBoxPosition = (id: number, position: Position) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.x = position.x
      box.y = position.y
    }
  }

  const updateBoxSize = (id: number, size: Size) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.width = size.width
      box.height = size.height
    }
  }

  const updateBoxQuery = (id: number, query: string) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.query = query
    }
  }

  const updateBoxName = (id: number, name: string) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.name = name
    }
  }

  const updateBoxZIndex = (id: number, zIndex: number) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.zIndex = zIndex
    }
  }

  const updateBoxDependencies = (id: number, dependencies: number[]) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.dependencies = dependencies
    }
  }

  const updateBoxConnectionId = (id: number, connectionId: string | undefined) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.connectionId = connectionId
    }
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
      connectionId: originalBox.connectionId
    }
    boxes.value.push(newBox)
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
        connectionId: originalBox.connectionId
      }
      boxes.value.push(newBox)
      newBoxIds.push(boxId)
    })

    return newBoxIds
  }

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
    getCanvasList,

    // Current canvas state
    boxes,
    visibleBoxes,
    selectedBoxId,
    selectionHistory,
    selectedBoxIds,
    rectangleSelection,
    isDraggingBox,
    canvasRef,
    viewportBounds,
    setViewportBounds,

    // State management
    loadState,

    // Box management
    addBox,
    removeBox,
    selectBox,
    deselectBox,
    isBoxSelected,
    selectMultipleBoxes,
    clearSelection,
    setRectangleSelection,
    setDraggingBox,
    removeMultipleBoxes,
    updateBoxPosition,
    updateBoxSize,
    updateBoxQuery,
    updateBoxName,
    updateBoxZIndex,
    updateBoxDependencies,
    updateBoxConnectionId,
    getMaxZIndex,
    clearAll,
    resetToDefault,
    copyBox,
    copyMultipleBoxes,
    undo,
    redo,
    setCanvasRef
  }
})
