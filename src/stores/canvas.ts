import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Box, BoxType, Position, Size, CanvasState } from '../types/canvas'

const STORAGE_KEY = 'squill_canvas_state'

interface UndoRedoState {
  boxes: Box[]
  selectedBoxId: number | null
  nextBoxId: number
}

export const useCanvasStore = defineStore('canvas', () => {
  const boxes = ref<Box[]>([])
  const selectedBoxId = ref<number | null>(null)
  const nextBoxId = ref(1)

  // Active project ID (database type determined by active connection)
  const activeProjectId = ref<string | null>(null)

  // Canvas reference for getting viewport center
  const canvasRef = ref<any>(null)

  // Undo/Redo stacks
  const undoStack = ref<UndoRedoState[]>([])
  const redoStack = ref<UndoRedoState[]>([])

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state: CanvasState & { selectedProject?: string | null } = JSON.parse(saved)
        boxes.value = state.boxes || []
        nextBoxId.value = state.nextBoxId || 1
        activeProjectId.value = state.activeProjectId || state.selectedProject || null

        // Ensure all boxes have required properties and filter out invalid boxes
        boxes.value = boxes.value
          .filter(box => box && box.id != null) // Filter out boxes with null/undefined IDs
          .map(box => ({
            id: box.id,
            type: box.type || 'sql', // 'sql' or 'schema'
            x: box.x || 100,
            y: box.y || 100,
            width: box.width || 600,
            height: box.height || 500,
            zIndex: box.zIndex || 1,
            query: box.query || `SELECT *\nFROM bigquery-public-data.samples.shakespeare\nLIMIT 50`,
            name: box.name || `query_${box.id}`,
            dependencies: box.dependencies || [] // Array of box IDs this box depends on
          }))
      } else {
        // Initialize with default boxes if no saved state
        initializeDefaultBoxes()
      }
    } catch (error) {
      console.error('Failed to load canvas state:', error)
      initializeDefaultBoxes()
    }
  }

  // Initialize with default boxes
  const initializeDefaultBoxes = () => {
    boxes.value = []
    nextBoxId.value = 1
    activeProjectId.value = null
  }

  // Save state to localStorage
  const saveState = () => {
    try {
      const state: CanvasState = {
        boxes: boxes.value,
        nextBoxId: nextBoxId.value,
        activeProjectId: activeProjectId.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save canvas state:', error)
    }
  }

  // Watch for changes and auto-save
  watch([boxes, nextBoxId, activeProjectId], () => {
    saveState()
  }, { deep: true })

  // Get max z-index
  const getMaxZIndex = (): number => {
    if (boxes.value.length === 0) return 0
    return Math.max(...boxes.value.map(box => box.zIndex || 0))
  }

  // Save current state to undo stack
  const saveToUndoStack = () => {
    undoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })
    // Limit undo stack size to 50 items
    if (undoStack.value.length > 50) {
      undoStack.value.shift()
    }
    // Clear redo stack when new action is performed
    redoStack.value = []
  }

  // Undo last action
  const undo = () => {
    if (undoStack.value.length === 0) return

    // Save current state to redo stack
    redoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })

    // Restore previous state
    const previousState = undoStack.value.pop()!
    boxes.value = previousState.boxes
    selectedBoxId.value = previousState.selectedBoxId
    nextBoxId.value = previousState.nextBoxId
  }

  // Redo last undone action
  const redo = () => {
    if (redoStack.value.length === 0) return

    // Save current state to undo stack
    undoStack.value.push({
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      selectedBoxId: selectedBoxId.value,
      nextBoxId: nextBoxId.value
    })

    // Restore next state
    const nextState = redoStack.value.pop()!
    boxes.value = nextState.boxes
    selectedBoxId.value = nextState.selectedBoxId
    nextBoxId.value = nextState.nextBoxId
  }

  // Add a new box
  const addBox = (type: BoxType = 'sql', position: Position | null = null): number => {
    saveToUndoStack()

    // Get viewport center if canvas ref is available
    let centerPosition: Position | null = null
    if (!position && canvasRef.value) {
      centerPosition = canvasRef.value.getViewportCenter()
    }

    // Default position if none provided
    const defaultX = 100 + Math.random() * 200
    const defaultY = 100 + Math.random() * 200

    const boxId = nextBoxId.value++

    // Size depends on type
    const width = type === 'note' ? 400 : (type === 'schema' ? 800 : 600)
    const height = type === 'note' ? 300 : (type === 'schema' ? 600 : 500)

    const newBox: Box = {
      id: boxId,
      type: type, // 'sql', 'schema', or 'note'
      x: position ? position.x - width / 2 : (centerPosition ? centerPosition.x - width / 2 : defaultX),
      y: position ? position.y - height / 2 : (centerPosition ? centerPosition.y - height / 2 : defaultY),
      width: width,
      height: height,
      zIndex: getMaxZIndex() + 1,
      query: type === 'sql' ? 'SELECT *\nFROM bigquery-public-data.samples.shakespeare\nLIMIT 50' : '',
      name: type === 'sql' ? `query_${boxId}` : (type === 'note' ? `note_${boxId}` : `schema_${boxId}`),
      dependencies: []
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  // Set active project ID
  const setActiveProjectId = (projectId: string | null) => {
    activeProjectId.value = projectId
  }

  // Set canvas ref
  const setCanvasRef = (ref: any) => {
    canvasRef.value = ref
  }

  // Remove a SQL box
  const removeBox = (id: number) => {
    const index = boxes.value.findIndex(box => box.id === id)
    if (index !== -1) {
      saveToUndoStack()
      boxes.value.splice(index, 1)
      if (selectedBoxId.value === id) {
        selectedBoxId.value = null
      }
    }
  }

  // Select a box and bring to front
  const selectBox = (id: number) => {
    selectedBoxId.value = id

    // Bring selected box to front
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      const maxZ = getMaxZIndex()
      if (box.zIndex < maxZ) {
        box.zIndex = maxZ + 1
      }
    }
  }

  // Deselect all boxes
  const deselectBox = () => {
    selectedBoxId.value = null
  }

  // Check if a box is selected
  const isBoxSelected = (id: number): boolean => {
    return selectedBoxId.value === id
  }

  // Update box position
  const updateBoxPosition = (id: number, position: Position) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.x = position.x
      box.y = position.y
    }
  }

  // Update box size
  const updateBoxSize = (id: number, size: Size) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.width = size.width
      box.height = size.height
    }
  }

  // Update box query
  const updateBoxQuery = (id: number, query: string) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.query = query
    }
  }

  // Update box name
  const updateBoxName = (id: number, name: string) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.name = name
    }
  }

  // Update box z-index
  const updateBoxZIndex = (id: number, zIndex: number) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.zIndex = zIndex
    }
  }

  // Update box dependencies (array of box IDs this box depends on)
  const updateBoxDependencies = (id: number, dependencies: number[]) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.dependencies = dependencies
    }
  }

  // Clear all boxes
  const clearAll = () => {
    boxes.value = []
    selectedBoxId.value = null
    nextBoxId.value = 1
  }

  // Reset to default state
  const resetToDefault = () => {
    initializeDefaultBoxes()
    selectedBoxId.value = null
  }

  // Copy a box (duplicate with offset)
  const copyBox = (id: number): number | null => {
    const originalBox = boxes.value.find(b => b.id === id)
    if (!originalBox) return null

    saveToUndoStack()
    const OFFSET = 30 // Offset for copied box
    const boxId = nextBoxId.value++

    // Generate incremented name based on type
    const newName = originalBox.type === 'sql' ? `query_${boxId}` : (originalBox.type === 'note' ? `note_${boxId}` : `schema_${boxId}`)

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
      dependencies: [] // Copied box starts with no dependencies
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  return {
    boxes,
    selectedBoxId,
    activeProjectId,
    canvasRef,
    loadState,
    addBox,
    removeBox,
    selectBox,
    deselectBox,
    isBoxSelected,
    updateBoxPosition,
    updateBoxSize,
    updateBoxQuery,
    updateBoxName,
    updateBoxZIndex,
    updateBoxDependencies,
    getMaxZIndex,
    clearAll,
    resetToDefault,
    copyBox,
    undo,
    redo,
    setActiveProjectId,
    setCanvasRef
  }
})
