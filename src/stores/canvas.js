import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'squill_canvas_state'

export const useCanvasStore = defineStore('canvas', () => {
  const boxes = ref([])
  const selectedBoxId = ref(null)
  const nextBoxId = ref(1)

  // Undo/Redo stacks
  const undoStack = ref([])
  const redoStack = ref([])

  // Load state from localStorage
  const loadState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
        boxes.value = state.boxes || []
        nextBoxId.value = state.nextBoxId || 1

        // Ensure all boxes have required properties
        boxes.value = boxes.value.map(box => ({
          id: box.id,
          x: box.x || 100,
          y: box.y || 100,
          width: box.width || 600,
          height: box.height || 500,
          zIndex: box.zIndex || 1,
          query: box.query || 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50',
          name: box.name || `Query ${box.id}`
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
    boxes.value = [
      {
        id: 1,
        x: 100,
        y: 100,
        width: 600,
        height: 500,
        zIndex: 1,
        query: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50',
        name: 'Query 1'
      },
      {
        id: 2,
        x: 750,
        y: 100,
        width: 600,
        height: 500,
        zIndex: 2,
        query: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50',
        name: 'Query 2'
      },
      {
        id: 3,
        x: 100,
        y: 650,
        width: 600,
        height: 500,
        zIndex: 3,
        query: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50',
        name: 'Query 3'
      }
    ]
    nextBoxId.value = 4
  }

  // Save state to localStorage
  const saveState = () => {
    try {
      const state = {
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
  const getMaxZIndex = () => {
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
    const previousState = undoStack.value.pop()
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
    const nextState = redoStack.value.pop()
    boxes.value = nextState.boxes
    selectedBoxId.value = nextState.selectedBoxId
    nextBoxId.value = nextState.nextBoxId
  }

  // Add a new SQL box
  const addBox = (position = null) => {
    saveToUndoStack()

    // Default position if none provided
    const defaultX = 100 + Math.random() * 200
    const defaultY = 100 + Math.random() * 200

    const boxId = nextBoxId.value++
    const newBox = {
      id: boxId,
      x: position ? position.x - 300 : defaultX, // Center the 600px wide box
      y: position ? position.y - 250 : defaultY, // Center the 500px tall box
      width: 600,
      height: 500,
      zIndex: getMaxZIndex() + 1,
      query: 'SELECT * FROM bigquery-public-data.samples.shakespeare LIMIT 50',
      name: `Query ${boxId}`
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  // Remove a SQL box
  const removeBox = (id) => {
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
  const selectBox = (id) => {
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

  // Update box position
  const updateBoxPosition = (id, position) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.x = position.x
      box.y = position.y
    }
  }

  // Update box size
  const updateBoxSize = (id, size) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.width = size.width
      box.height = size.height
    }
  }

  // Update box query
  const updateBoxQuery = (id, query) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.query = query
    }
  }

  // Update box name
  const updateBoxName = (id, name) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.name = name
    }
  }

  // Update box z-index
  const updateBoxZIndex = (id, zIndex) => {
    const box = boxes.value.find(b => b.id === id)
    if (box) {
      box.zIndex = zIndex
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
  const copyBox = (id) => {
    const originalBox = boxes.value.find(b => b.id === id)
    if (!originalBox) return null

    saveToUndoStack()
    const OFFSET = 30 // Offset for copied box
    const boxId = nextBoxId.value++
    const newBox = {
      id: boxId,
      x: originalBox.x + OFFSET,
      y: originalBox.y + OFFSET,
      width: originalBox.width,
      height: originalBox.height,
      zIndex: getMaxZIndex() + 1,
      query: originalBox.query,
      name: `${originalBox.name} (copy)`
    }
    boxes.value.push(newBox)
    return newBox.id
  }

  return {
    boxes,
    selectedBoxId,
    loadState,
    addBox,
    removeBox,
    selectBox,
    deselectBox,
    updateBoxPosition,
    updateBoxSize,
    updateBoxQuery,
    updateBoxName,
    updateBoxZIndex,
    getMaxZIndex,
    clearAll,
    resetToDefault,
    copyBox,
    undo,
    redo
  }
})
