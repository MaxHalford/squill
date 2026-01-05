import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Box, BoxType, Position, Size, CanvasState } from '../types/canvas'
import { getDefaultQuery, type QueryEngine } from '../constants/defaultQueries'

const STORAGE_KEY = 'squill_canvas_state'

interface UndoRedoState {
  boxes: Box[]
  selectedBoxId: number | null
  nextBoxId: number
}

export const useCanvasStore = defineStore('canvas', () => {
  const boxes = ref<Box[]>([])
  const selectedBoxId = ref<number | null>(null)
  const selectionHistory = ref<number[]>([]) // Stack of previously selected box IDs
  const nextBoxId = ref(1)

  // Canvas reference for getting viewport center
  const canvasRef = ref<any>(null)

  // Multi-selection state
  const selectedBoxIds = ref<Set<number>>(new Set())

  // Rectangle selection state (for visual rendering during drag)
  const rectangleSelection = ref<{ startX: number; startY: number; endX: number; endY: number } | null>(null)

  // Undo/Redo stacks
  const undoStack = ref<UndoRedoState[]>([])
  const redoStack = ref<UndoRedoState[]>([])

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state: CanvasState = JSON.parse(saved)
        boxes.value = state.boxes || []
        nextBoxId.value = state.nextBoxId || 1

        // Ensure all boxes have required properties and filter out invalid boxes
        boxes.value = boxes.value
          .filter(box => box && box.id != null)
          .map(box => ({
            id: box.id,
            type: box.type || 'sql',
            x: box.x || 100,
            y: box.y || 100,
            width: box.width || 600,
            height: box.height || 500,
            zIndex: box.zIndex || 1,
            query: box.query || '',
            name: box.name || `query_${box.id}`,
            dependencies: box.dependencies || [],
            connectionId: box.connectionId
          }))
      } else {
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
  }

  // Save state to localStorage
  const saveState = () => {
    try {
      const state: CanvasState = {
        boxes: boxes.value,
        nextBoxId: nextBoxId.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save canvas state:', error)
    }
  }

  // Watch for changes and auto-save
  watch([boxes, nextBoxId], () => {
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
    if (undoStack.value.length > 50) {
      undoStack.value.shift()
    }
    redoStack.value = []
  }

  // Undo last action
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

  // Redo last undone action
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

  // Add a new box
  const addBox = (
    type: BoxType = 'sql',
    position: Position | null = null,
    engine?: QueryEngine,
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
                  type === 'schema' ? 800 : 600
    const height = type === 'note' ? 300 :
                   type === 'detail' ? 500 :
                   type === 'schema' ? 600 : 500

    const newBox: Box = {
      id: boxId,
      type: type,
      x: position ? position.x - width / 2 : (centerPosition ? centerPosition.x - width / 2 : defaultX),
      y: position ? position.y - height / 2 : (centerPosition ? centerPosition.y - height / 2 : defaultY),
      width: width,
      height: height,
      zIndex: getMaxZIndex() + 1,
      query: type === 'sql' ? getDefaultQuery(engine) : '',
      name: type === 'sql' ? `query_${boxId}` :
            type === 'note' ? `note_${boxId}` :
            type === 'detail' ? `row_detail_${boxId}` :
            `schema_${boxId}`,
      dependencies: [],
      connectionId: connectionId
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  // Set canvas ref
  const setCanvasRef = (ref: any) => {
    canvasRef.value = ref
  }

  // Remove a SQL box
  const removeBox = (id: number): number | null => {
    const index = boxes.value.findIndex(box => box.id === id)
    if (index !== -1) {
      saveToUndoStack()
      boxes.value.splice(index, 1)

      // Also remove deleted box from selection history
      selectionHistory.value = selectionHistory.value.filter(historyId => historyId !== id)

      if (selectedBoxId.value === id) {
        selectedBoxId.value = null

        // Pop from history until we find a box that still exists
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

  // Select a box and bring to front
  const selectBox = (id: number) => {
    if (selectedBoxId.value !== null && selectedBoxId.value !== id) {
      // Push current selection to history stack
      selectionHistory.value.push(selectedBoxId.value)
      // Keep history bounded to prevent memory issues
      if (selectionHistory.value.length > 50) {
        selectionHistory.value.shift()
      }
    }

    selectedBoxId.value = id

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
    selectedBoxIds.value.clear()
  }

  // Check if a box is selected (single or multi)
  const isBoxSelected = (id: number): boolean => {
    return selectedBoxId.value === id || selectedBoxIds.value.has(id)
  }

  // Select multiple boxes (for rectangle selection)
  const selectMultipleBoxes = (boxIds: number[]) => {
    selectedBoxId.value = null
    selectedBoxIds.value = new Set(boxIds)
  }

  // Clear all selections
  const clearSelection = () => {
    selectedBoxId.value = null
    selectedBoxIds.value.clear()
  }

  // Set rectangle selection coordinates (for visual rendering)
  const setRectangleSelection = (coords: { startX: number; startY: number; endX: number; endY: number } | null) => {
    rectangleSelection.value = coords
  }

  // Remove multiple boxes (for multi-selection delete)
  const removeMultipleBoxes = (boxIds: number[]) => {
    if (boxIds.length === 0) return

    saveToUndoStack()

    const idsToRemove = new Set(boxIds)
    boxes.value = boxes.value.filter(box => !idsToRemove.has(box.id))

    selectedBoxId.value = null
    selectedBoxIds.value.clear()
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

  // Update box connection ID
  const updateBoxConnectionId = (id: number, connectionId: string | undefined) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.connectionId = connectionId
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
    const OFFSET = 30
    const boxId = nextBoxId.value++

    const newName = originalBox.type === 'sql' ? `query_${boxId}` :
                    originalBox.type === 'note' ? `note_${boxId}` :
                    originalBox.type === 'detail' ? `row_detail_${boxId}` :
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

  // Copy multiple boxes (duplicate with offset)
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

      const newName = originalBox.type === 'sql' ? `query_${boxId}` :
                      originalBox.type === 'note' ? `note_${boxId}` :
                      originalBox.type === 'detail' ? `row_detail_${boxId}` :
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
    boxes,
    selectedBoxId,
    selectionHistory,
    selectedBoxIds,
    rectangleSelection,
    canvasRef,
    loadState,
    addBox,
    removeBox,
    selectBox,
    deselectBox,
    isBoxSelected,
    selectMultipleBoxes,
    clearSelection,
    setRectangleSelection,
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
