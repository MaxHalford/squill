<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import type { Box } from '../types/canvas'
import { useCanvasStore } from '../stores/canvas'
import { useSettingsStore } from '../stores/settings'
import { calculateBoundingBox } from '../utils/geometry'
import CursorOverlay from './CursorOverlay.vue'

interface Point {
  x: number
  y: number
}

const emit = defineEmits<{
  'canvas-click': []
  'file-drop': [payload: { csvFiles: File[]; duckdbFiles?: File[]; nonCsvFiles: File[]; position: Point }]
  'cursor-move': [x: number, y: number]
  'cursor-leave': []
}>()

const canvasStore = useCanvasStore()
const settingsStore = useSettingsStore()

// Compute canvas pattern class based on settings
const canvasPatternClass = computed(() => {
  const pattern = settingsStore.canvasPattern
  if (pattern === 'dots') return '' // Default, no extra class needed
  return `canvas-${pattern}`
})

const props = defineProps<{
  boxes: Box[]
}>()

const canvasRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)

// Canvas state
const pan = ref<Point>({ x: 0, y: 0 })
const zoom = ref(1)
const isPanning = ref(false)
const isActuallyPanning = ref(false)
const panStart = ref<Point>({ x: 0, y: 0 })

// Rectangle selection state
const isRectangleSelecting = ref(false)
const rectangleStart = ref<Point>({ x: 0, y: 0 })
const rectangleCurrent = ref<Point>({ x: 0, y: 0 })

// Space key panning state
const isSpaceHeld = ref(false)
const isMetaHeld = ref(false)

// CSV drag state
const isDraggingFile = ref(false)
const dragCounter = ref(0)

// Zoom uses transform: scale() exclusively (no CSS zoom).
// CSS zoom was removed because WebKit (Tauri/WKWebView) returns zoomed values from
// getBoundingClientRect() while clientX/clientY remain unzoomed, breaking coordinate-
// dependent interactions (CodeMirror selection, tooltips, etc.). A single transform-
// based approach works identically across all browsers and platforms.
const isZooming = ref(false)
let zoomIdleTimer: ReturnType<typeof setTimeout> | null = null
const ZOOM_IDLE_MS = 150

// Set during wheel events, cleared after ZOOM_IDLE_MS — drives hit-test blocker
const markZoomActive = () => {
  isZooming.value = true
  if (zoomIdleTimer) clearTimeout(zoomIdleTimer)
  zoomIdleTimer = setTimeout(() => { isZooming.value = false }, ZOOM_IDLE_MS)
}

// Precision rounding — keeps CSS transform strings short, avoids sub-pixel jitter
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

const viewportStyle = computed(() => ({
  transform: `translate3d(${r4(pan.value.x)}px, ${r4(pan.value.y)}px, 0) scale(${r4(zoom.value)})`
}))

// Provide live zoom to children (used for coordinate correction in drag/resize)
provide('canvasZoom', zoom)

// LOD: disable expensive effects at very low zoom levels
const isLowZoom = computed(() => zoom.value < 0.35)

const isAnimatingPan = ref(false)

const PADDING = 100

let animationFrameId: number | null = null

const animateTo = (
  targets: { pan: Point; zoom?: number },
  onComplete?: () => void,
) => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  isAnimatingPan.value = true
  const startPan = { ...pan.value }
  const startZoom = zoom.value
  const startTime = performance.now()
  const duration = 400
  const animate = (currentTime: number) => {
    const progress = Math.min((currentTime - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    pan.value = {
      x: r4(startPan.x + (targets.pan.x - startPan.x) * eased),
      y: r4(startPan.y + (targets.pan.y - startPan.y) * eased),
    }
    if (targets.zoom !== undefined) {
      zoom.value = startZoom + (targets.zoom - startZoom) * eased
    }
    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate)
    } else {
      animationFrameId = null
      isAnimatingPan.value = false
      onComplete?.()
    }
  }
  animationFrameId = requestAnimationFrame(animate)
}

const fitToBounds = (targetBoxes: { x: number; y: number; width: number; height: number }[]) => {
  if (!canvasRef.value || !targetBoxes.length) return

  const rect = canvasRef.value.getBoundingClientRect()
  const bb = calculateBoundingBox(targetBoxes)
  const { minX, minY, maxX, maxY } = bb ?? { minX: 0, minY: 0, maxX: 800, maxY: 600 }

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  const zoomX = (rect.width - PADDING * 2) / contentWidth
  const zoomY = (rect.height - PADDING * 2) / contentHeight
  const targetZoom = Math.min(Math.max(Math.min(zoomX, zoomY, 1), 0.15), 3)

  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  animateTo({
    pan: {
      x: rect.width / 2 - contentCenterX * targetZoom,
      y: rect.height / 2 - contentCenterY * targetZoom,
    },
    zoom: targetZoom,
  })
}

const fitToView = () => {
  fitToBounds(props.boxes ?? [])
}

const fitToBoxIds = (boxIds: number[]) => {
  const subset = props.boxes.filter(b => boxIds.includes(b.id))
  fitToBounds(subset)
}

const getViewportCenter = (): Point => {
  if (!canvasRef.value) return { x: 400, y: 300 }

  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (rect.width / 2 - pan.value.x) / zoom.value,
    y: (rect.height / 2 - pan.value.y) / zoom.value
  }
}

const panToBox = (boxId: number) => {
  const box = props.boxes.find(b => b.id === boxId)
  if (!box || !canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  animateTo({
    pan: {
      x: rect.width / 2 - (box.x + box.width / 2) * zoom.value,
      y: rect.height / 2 - (box.y + box.height / 2) * zoom.value,
    },
  })
}

const screenToCanvas = (screenX: number, screenY: number): Point => {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (screenX - rect.left - pan.value.x) / zoom.value,
    y: (screenY - rect.top - pan.value.y) / zoom.value
  }
}

defineExpose({ fitToView, fitToBoxIds, getViewportCenter, panToBox, screenToCanvas, zoom })

const isOverBox = (element: HTMLElement | null): boolean => {
  let current = element
  while (current && current !== canvasRef.value) {
    if (current.classList?.contains('resizable-box')) return true
    if (current.classList?.contains('box-creation-buttons')) return true
    current = current.parentElement
  }
  return false
}

const SCROLLABLE_SELECTOR = '.table-container, .sql-editor, .query-editor, .datasets-list, .schema-browser, .detail-content, .search-results, .history-list, .preview-panel, .code-editor, .column-dropdown, .sticky-note-content, .messages, .explain-viewport, .node-detail, [data-scrollable]'

const isOverScrollableArea = (element: HTMLElement | null): boolean => {
  if (!element) return false
  return element.closest(SCROLLABLE_SELECTOR) !== null
}

const boxIntersectsRectangle = (box: Box, startX: number, startY: number, endX: number, endY: number): boolean => {
  const rectLeft = Math.min(startX, endX)
  const rectRight = Math.max(startX, endX)
  const rectTop = Math.min(startY, endY)
  const rectBottom = Math.max(startY, endY)

  return !(box.x + box.width < rectLeft || box.x > rectRight || box.y + box.height < rectTop || box.y > rectBottom)
}

const handleWheel = (e: WheelEvent) => {
  if (isOverScrollableArea(e.target as HTMLElement) && !(e.ctrlKey || e.metaKey)) return

  e.preventDefault()
  if (!canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  const mouseXInCanvas = (mouseX - pan.value.x) / zoom.value
  const mouseYInCanvas = (mouseY - pan.value.y) / zoom.value

  const newZoom = Math.min(Math.max(zoom.value * (1 - e.deltaY * 0.001), 0.15), 3)

  pan.value = {
    x: mouseX - mouseXInCanvas * newZoom,
    y: mouseY - mouseYInCanvas * newZoom
  }
  zoom.value = newZoom
  markZoomActive()
}

// Capture-phase handler: intercepts CMD/Space + mousedown before children see it
const handleMouseDownCapture = (e: MouseEvent) => {
  if (e.button !== 0 || !canvasRef.value) return
  const target = e.target as HTMLElement
  const wantsPan = isSpaceHeld.value || ((e.ctrlKey || e.metaKey) && isOverBox(target))
  if (!wantsPan) return

  // Stop the event from reaching child elements (e.g. CodeMirror)
  e.preventDefault()
  e.stopPropagation()
  isPanning.value = true
  isActuallyPanning.value = false
  panStart.value = {
    x: e.clientX - pan.value.x,
    y: e.clientY - pan.value.y
  }
  canvasRef.value.classList.remove('space-ready', 'meta-ready')
  canvasRef.value.classList.add('pan-active')
}

const handleMouseDown = (e: MouseEvent) => {
  if (e.button !== 0 || !canvasRef.value) return
  // Already handled by capture phase
  if (isPanning.value) return

  const target = e.target as HTMLElement

  // Rectangle selection with Cmd/Ctrl on empty canvas
  if ((e.ctrlKey || e.metaKey) && !isOverBox(target)) {
    e.preventDefault()
    isRectangleSelecting.value = true
    rectangleStart.value = screenToCanvas(e.clientX, e.clientY)
    rectangleCurrent.value = { ...rectangleStart.value }
    canvasRef.value.style.cursor = 'crosshair'
    return
  }

  if (isOverBox(target)) return

  e.preventDefault()
  isPanning.value = true
  isActuallyPanning.value = false
  panStart.value = {
    x: e.clientX - pan.value.x,
    y: e.clientY - pan.value.y
  }
  canvasRef.value.classList.add('pan-active')
}

let panRafId: number | null = null
let latestMoveX = 0
let latestMoveY = 0

const handleMouseMove = (e: MouseEvent) => {
  latestMoveX = e.clientX
  latestMoveY = e.clientY

  // Set flag immediately — mouseup checks it synchronously
  if (isPanning.value) isActuallyPanning.value = true

  if (panRafId !== null) return

  panRafId = requestAnimationFrame(() => {
    panRafId = null

    if (isRectangleSelecting.value) {
      rectangleCurrent.value = screenToCanvas(latestMoveX, latestMoveY)
      canvasStore.setRectangleSelection({
        startX: rectangleStart.value.x,
        startY: rectangleStart.value.y,
        endX: rectangleCurrent.value.x,
        endY: rectangleCurrent.value.y
      })
      return
    }

    if (isPanning.value) {
      pan.value = {
        x: latestMoveX - panStart.value.x,
        y: latestMoveY - panStart.value.y
      }
    }

    // Emit canvas-space cursor position for awareness
    const pos = screenToCanvas(latestMoveX, latestMoveY)
    emit('cursor-move', pos.x, pos.y)
  })
}

const handleMouseUp = () => {
  if (!canvasRef.value) return

  if (panRafId !== null) {
    cancelAnimationFrame(panRafId)
    panRafId = null
  }

  if (isRectangleSelecting.value) {
    const selectedIds = props.boxes
      .filter(box => boxIntersectsRectangle(box, rectangleStart.value.x, rectangleStart.value.y, rectangleCurrent.value.x, rectangleCurrent.value.y))
      .map(box => box.id)

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    if (selectedIds.length > 0) {
      canvasStore.selectMultipleBoxes(selectedIds)
    } else {
      canvasStore.clearSelection()
    }

    canvasStore.setRectangleSelection(null)
    isRectangleSelecting.value = false
    canvasRef.value.style.cursor = ''
    updateModifierCursor()
    return
  }

  if (isPanning.value) {
    if (!isActuallyPanning.value && !isSpaceHeld.value && !isMetaHeld.value) emit('canvas-click')
    isPanning.value = false
    isActuallyPanning.value = false
    canvasRef.value.classList.remove('pan-active')
    updateModifierCursor()
  }
}

const updateModifierCursor = () => {
  if (!canvasRef.value) return
  const active = !isPanning.value
  canvasRef.value.classList.toggle('space-ready', active && isSpaceHeld.value)
  canvasRef.value.classList.toggle('meta-ready', active && isMetaHeld.value && !isSpaceHeld.value)
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.code === 'Space' && !isSpaceHeld.value) {
    // Don't activate space-pan if focus is in an input/textarea
    const activeEl = document.activeElement
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
      return
    }
    e.preventDefault()
    isSpaceHeld.value = true
    updateModifierCursor()
  }
  if ((e.key === 'Meta' || e.key === 'Control') && !isMetaHeld.value) {
    isMetaHeld.value = true
    updateModifierCursor()
  }
}

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    isSpaceHeld.value = false
    updateModifierCursor()
  }
  if (e.key === 'Meta' || e.key === 'Control') {
    isMetaHeld.value = false
    updateModifierCursor()
  }
}

const handleWindowBlur = () => {
  // Reset modifier state when window loses focus to prevent stuck state
  isSpaceHeld.value = false
  isMetaHeld.value = false
  canvasRef.value?.classList.remove('space-ready', 'meta-ready', 'pan-active')
}

// File drag and drop
const handleDragEnter = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    dragCounter.value++
    isDraggingFile.value = true
  }
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  if (--dragCounter.value === 0) isDraggingFile.value = false
}

const handleDragOver = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  isDraggingFile.value = false
  dragCounter.value = 0

  const files = e.dataTransfer?.files
  if (!files?.length) return

  const csvFiles: File[] = []
  const duckdbFiles: File[] = []
  const nonSupportedFiles: File[] = []
  for (const f of Array.from(files)) {
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.csv') || f.type === 'text/csv') csvFiles.push(f)
    else if (lower.endsWith('.duckdb')) duckdbFiles.push(f)
    else nonSupportedFiles.push(f)
  }

  emit('file-drop', {
    csvFiles,
    duckdbFiles,
    nonCsvFiles: nonSupportedFiles,
    position: screenToCanvas(e.clientX, e.clientY)
  })
}

onMounted(() => {
  canvasRef.value?.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  canvasRef.value?.addEventListener('mousedown', handleMouseDownCapture, { capture: true })
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  canvasRef.value?.removeEventListener('wheel', handleWheel)
  canvasRef.value?.removeEventListener('mousedown', handleMouseDownCapture, { capture: true })
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', handleWindowBlur)

  // Clean up animation frames
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  if (panRafId !== null) {
    cancelAnimationFrame(panRafId)
    panRafId = null
  }

  // Clean up zoom idle timer
  if (zoomIdleTimer) {
    clearTimeout(zoomIdleTimer)
    zoomIdleTimer = null
  }
})
</script>

<template>
  <div
    ref="canvasRef"
    class="infinite-canvas"
    :class="[canvasPatternClass, { 'dragging-file': isDraggingFile, 'low-zoom': isLowZoom }]"
    @mousedown="handleMouseDown"
    @mouseleave="emit('cursor-leave')"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div
      ref="viewportRef"
      class="viewport"
      :style="viewportStyle"
    >
      <slot />

      <!-- Remote user cursors (awareness) -->
      <CursorOverlay v-if="canvasStore.persistenceMode === 'synced'" />

      <!-- Teleport target for box creation buttons -->
      <div id="box-creation-buttons-container" />

      <div
        v-if="canvasStore.rectangleSelection"
        class="selection-rectangle"
        :style="{
          left: `${Math.min(canvasStore.rectangleSelection.startX, canvasStore.rectangleSelection.endX)}px`,
          top: `${Math.min(canvasStore.rectangleSelection.startY, canvasStore.rectangleSelection.endY)}px`,
          width: `${Math.abs(canvasStore.rectangleSelection.endX - canvasStore.rectangleSelection.startX)}px`,
          height: `${Math.abs(canvasStore.rectangleSelection.endY - canvasStore.rectangleSelection.startY)}px`
        }"
      />
    </div>

    <!-- Hit-test blocker: single overlay at max z-index blocks all pointer events
         during camera movement, avoiding per-element style recalculation -->
    <div v-show="isPanning || isRectangleSelecting || isZooming || isAnimatingPan" class="hit-test-blocker" />
  </div>
</template>

<style scoped>
.infinite-canvas {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(circle, var(--canvas-dot-color) var(--canvas-dot-size), transparent var(--canvas-dot-size));
  background-size: var(--canvas-dot-spacing) var(--canvas-dot-spacing);
  cursor: grab;
  /* CSS containment for performance */
  contain: layout size style;
}

/* Space held: grab cursor everywhere (pan from anywhere) */
.infinite-canvas.space-ready,
.infinite-canvas.space-ready :deep(*) {
  cursor: grab !important;
}

/* Meta/Ctrl held: default cursor on canvas (rectangle select), grab over boxes (pan) */
.infinite-canvas.meta-ready {
  cursor: crosshair !important;
}
.infinite-canvas.meta-ready :deep(.resizable-box),
.infinite-canvas.meta-ready :deep(.resizable-box *) {
  cursor: grab !important;
}

/* Actively panning: grabbing cursor everywhere */
.infinite-canvas.pan-active,
.infinite-canvas.pan-active :deep(*) {
  cursor: grabbing !important;
}

.viewport {
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  position: relative;
  /* Contain layout recalcs to this element */
  contain: layout style;
  /* Permanent GPU layer — viewport always uses transform: scale() */
  will-change: transform;
}

/* Single overlay that blocks all hit-testing during camera movement */
.hit-test-blocker {
  position: fixed;
  inset: 0;
  z-index: 99999;
  pointer-events: all;
}

/* Disable expensive effects at very low zoom levels */
.infinite-canvas.low-zoom :deep(.resizable-box) {
  box-shadow: none !important;
  border-color: var(--border-secondary) !important;
}
.infinite-canvas.low-zoom :deep(.dependency-arrows) {
  shape-rendering: auto;
}

.selection-rectangle {
  position: absolute;
  border: 2px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
  background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  pointer-events: none;
  z-index: 9999;
}

/* File drag overlay */
.infinite-canvas.dragging-file::before {
  content: 'Drop file to import';
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  border: 3px dashed color-mix(in srgb, var(--color-accent) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 600;
  color: color-mix(in srgb, var(--color-accent) 90%, transparent);
  pointer-events: none;
  z-index: 10000;
}
</style>
