<script setup lang="ts">
import { ref, computed, watch, inject, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import BaseBox from './BaseBox.vue'
import PlanTree from './PlanTree.vue'
import CopyButton from './CopyButton.vue'
import { parsePlan, type PlanNode } from '../utils/planParser'

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 600 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialData: { type: String, default: '{}' },
  initialName: { type: String, default: 'Explain' }
})

const emit = defineEmits([
  'select', 'update:position', 'update:size',
  'delete', 'maximize', 'update:name'
])

const canvasZoom = inject<{ value: number }>('canvasZoom', ref(1))

const parsedData = computed(() => {
  try {
    return JSON.parse(props.initialData)
  } catch {
    return {}
  }
})

const engine = computed(() => parsedData.value.engine ?? '')
const plan = computed(() => parsedData.value.plan ?? null)
const planTree = computed(() => parsePlan(engine.value, plan.value))

const planJson = computed(() => {
  if (plan.value === null) return ''
  if (typeof plan.value === 'string') return plan.value
  return JSON.stringify(plan.value, null, 2)
})

// Selected node detail — track by id to avoid Vue proxy reference issues
const selectedNodeId = ref<number | null>(null)
const detailEditorRef = ref<HTMLElement | null>(null)
let detailEditorView: EditorView | null = null

const findNode = (root: PlanNode | null, id: number): PlanNode | null => {
  if (!root) return null
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

const selectedNode = computed(() =>
  selectedNodeId.value !== null ? findNode(planTree.value, selectedNodeId.value) : null
)

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syntax-property)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-keyword)' },
  { tag: tags.null, color: 'var(--syntax-keyword)' },
  { tag: tags.punctuation, color: 'var(--syntax-punctuation)' },
])

const detailTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-caption)',
    background: 'transparent',
  },
  '.cm-content': {
    fontFamily: 'var(--font-family-mono)',
    color: 'var(--text-secondary)',
    padding: 'var(--space-2) var(--space-3)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
  },
  '.cm-gutters': { display: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
})

const selectedNodeJson = computed(() => {
  if (!selectedNode.value) return ''
  const { children, ...rest } = selectedNode.value
  return JSON.stringify(rest, null, 2)
})

const updateDetailEditor = () => {
  const doc = selectedNodeJson.value
  if (!doc) {
    detailEditorView?.destroy()
    detailEditorView = null
    return
  }
  if (detailEditorView) {
    detailEditorView.dispatch({
      changes: { from: 0, to: detailEditorView.state.doc.length, insert: doc },
    })
  } else if (detailEditorRef.value) {
    detailEditorView = new EditorView({
      parent: detailEditorRef.value,
      state: EditorState.create({
        doc,
        extensions: [
          json(),
          syntaxHighlighting(jsonHighlightStyle, { fallback: true }),
          detailTheme,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    })
  }
}

watch(selectedNode, async () => {
  await nextTick()
  updateDetailEditor()
})

const onSelectNode = (node: PlanNode) => {
  selectedNodeId.value = selectedNodeId.value === node.id ? null : node.id
}

const closeDetail = () => {
  selectedNodeId.value = null
}

// Pan & zoom state
const viewportEl = ref<HTMLElement | null>(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
let panStartX = 0
let panStartY = 0
let panStartPanX = 0
let panStartPanY = 0

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

const onWheel = (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) return
  e.preventDefault()
  e.stopPropagation()

  if (!viewportEl.value) return

  // getBoundingClientRect is affected by ancestor CSS zoom, but clientX/Y are not.
  // Divide by canvasZoom to get correct mouse position relative to the viewport.
  const cz = canvasZoom.value
  const rect = viewportEl.value.getBoundingClientRect()
  const mouseX = (e.clientX - rect.left) / cz
  const mouseY = (e.clientY - rect.top) / cz

  const mouseXInWorld = (mouseX - panX.value) / zoom.value
  const mouseYInWorld = (mouseY - panY.value) / zoom.value

  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
    zoom.value * (1 - e.deltaY * 0.001),
  ))

  panX.value = mouseX - mouseXInWorld * newZoom
  panY.value = mouseY - mouseYInWorld * newZoom
  zoom.value = newZoom
}

const onPointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return
  isPanning.value = true
  panStartX = e.clientX
  panStartY = e.clientY
  panStartPanX = panX.value
  panStartPanY = panY.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!isPanning.value) return
  const cz = canvasZoom.value
  panX.value = panStartPanX + (e.clientX - panStartX) / cz
  panY.value = panStartPanY + (e.clientY - panStartY) / cz
}

const onPointerUp = () => {
  isPanning.value = false
}

onMounted(() => {
  viewportEl.value?.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  viewportEl.value?.removeEventListener('wheel', onWheel)
  detailEditorView?.destroy()
})

</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    :show-header-name="true"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="explain-content">
      <div
        ref="viewportEl"
        class="explain-viewport"
        :class="{ panning: isPanning }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div
          v-if="planTree"
          class="plan-surface"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          }"
        >
          <PlanTree
            :root="planTree"
            :selected-node-id="selectedNodeId"
            @select-node="onSelectNode"
          />
        </div>
        <pre
          v-else-if="planJson"
          class="plan-text"
        >{{ planJson }}</pre>
        <div
          v-else
          class="empty-state"
        >
          No plan data available
        </div>
      </div>

      <!-- Node detail panel -->
      <div
        v-if="selectedNode"
        class="node-detail"
        data-scrollable
        @wheel.stop
      >
        <button
          class="detail-close"
          @click.stop="closeDetail"
        >
          &times;
        </button>
        <div ref="detailEditorRef" class="detail-editor code-editor" />
      </div>

      <CopyButton
        v-if="planJson"
        :text="planJson"
        tooltip="Copy raw JSON"
        size="md"
        class="plan-copy-btn"
      />
    </div>
  </BaseBox>
</template>

<style scoped>
.explain-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-primary);
  position: relative;
}

.explain-viewport {
  flex: 1;
  overflow: hidden;
  cursor: grab;
  position: relative;
  user-select: none;

}

.explain-viewport.panning {
  cursor: grabbing;
}

.plan-surface {
  transform-origin: 0 0;
  display: inline-block;
  padding: var(--space-6);
  will-change: transform;
}

.plan-text {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
  padding: var(--space-4);
  user-select: text;
  cursor: text;
}

.plan-text::selection {
  background: var(--color-selection);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

/* Node detail panel */
.node-detail {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 40%;
  display: flex;
  flex-direction: column;
  background: var(--surface-primary);
  border-top: var(--border-width-thin) solid var(--border-secondary);
  overflow: hidden;
}

.detail-close {
  position: absolute;
  top: var(--space-1);
  right: var(--space-2);
  z-index: 1;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: var(--space-1);
}

.detail-close:hover {
  color: var(--text-primary);
}

.detail-editor {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.detail-editor::-webkit-scrollbar {
  display: none;
}

.detail-editor :deep(.cm-scroller) {
  scrollbar-width: none;
}

.detail-editor :deep(.cm-scroller)::-webkit-scrollbar {
  display: none;
}

.plan-copy-btn {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}
</style>
