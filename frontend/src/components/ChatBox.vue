<script setup lang="ts">
import { ref, inject, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryEditor from './QueryEditor.vue'
import ResultsTable from './ResultsTable.vue'
import { useChat, type ChatMessage } from '../composables/useChat'
import { useChatTools } from '../composables/useChatTools'
import { useUserStore } from '../stores/user'
import { marked } from 'marked'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

const userStore = useUserStore()

// Debounce helper
let saveTimeout: ReturnType<typeof setTimeout> | null = null

// Inject canvas zoom for splitter dragging
const canvasZoom = inject('canvasZoom', ref(1))

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 1000 },
  initialHeight: { type: Number, default: 600 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialName: { type: String, default: 'Chat' },
  connectionId: { type: String, default: undefined },
  initialQuery: { type: String, default: '' },
})

const emit = defineEmits([
  'select', 'update:position', 'update:size', 'delete',
  'maximize', 'update:name', 'update:query', 'drag-start', 'drag-end',
])

// Connection
const connectionIdRef = computed(() => props.connectionId)

// Chat tools
const { handleToolCall, dialect, connectionInfo, scratchpadState } = useChatTools(connectionIdRef)

// Restore persisted state (messages + query)
function parsePersistedState(): { messages: ChatMessage[]; query: string } {
  if (!props.initialQuery) return { messages: [], query: '' }
  try {
    const parsed = JSON.parse(props.initialQuery)
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.messages)) {
      return { messages: parsed.messages, query: parsed.query || '' }
    }
    // Legacy format: plain array of messages
    if (Array.isArray(parsed)) return { messages: parsed, query: '' }
  } catch {
    // Not valid JSON, ignore
  }
  return { messages: [], query: '' }
}

const persisted = parsePersistedState()

// Chat composable
const {
  messages,
  isStreaming,
  streamingText,
  error: chatError,
  sendMessage,
  stop,
} = useChat({
  apiUrl: `${BACKEND_URL}/chat/`,
  sessionToken: computed(() => userStore.sessionToken),
  dialect,
  connectionInfo,
  currentQuery: scratchpadState.query,
  onToolCall: handleToolCall,
  initialMessages: persisted.messages,
})

// Chat input
const inputText = ref('')
const messagesContainerRef = ref<HTMLElement | null>(null)

// Vertical splitter (between chat and scratchpad)
const isDraggingVerticalSplitter = ref(false)
const chatPanelWidth = ref(450)
const verticalDragStart = ref({ x: 0 })

// Horizontal splitter (between editor and results in scratchpad)
const isDraggingHorizontalSplitter = ref(false)
const editorHeight = ref(150)
const horizontalDragStart = ref({ y: 0 })

const HEADER_HEIGHT = 32
const MIN_CHAT_WIDTH = 200
const MIN_SCRATCHPAD_WIDTH = 200
const MIN_EDITOR_HEIGHT = 80

// Box dimensions tracking
const boxWidth = ref(props.initialWidth)
const boxHeight = ref(props.initialHeight)

// SQL dialect for QueryEditor
const currentDialect = computed((): 'bigquery' | 'duckdb' | 'postgres' => {
  const d = dialect.value
  if (d === 'snowflake') return 'postgres'
  if (d === 'bigquery' || d === 'duckdb' || d === 'postgres') return d
  return 'duckdb'
})

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function handleSend() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return
  inputText.value = ''
  sendMessage(text)
}

function handleInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// Auto-scroll to bottom when new messages arrive
watch(
  [() => messages.value.length, streamingText],
  async () => {
    await nextTick()
    if (messagesContainerRef.value) {
      messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
    }
  },
)

// Persist messages + scratchpad query to localStorage (debounced)
function persistState() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    // Only persist user and assistant messages (skip tool messages — they're ephemeral)
    const msgs = messages.value.filter(
      m => m.role === 'user' || (m.role === 'assistant' && m.content),
    )
    emit('update:query', JSON.stringify({
      messages: msgs,
      query: scratchpadState.query.value,
    }))
  }, 500)
}

watch(() => messages.value.length, persistState)
watch(scratchpadState.query, persistState)

// ---------------------------------------------------------------------------
// Render markdown
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { async: false }) as string
}

// ---------------------------------------------------------------------------
// Tool call display helpers
// ---------------------------------------------------------------------------

function toolCallLabel(name: string): string {
  switch (name) {
    case 'list_schemas': return 'Listing schemas'
    case 'list_tables': return 'Listing tables'
    case 'run_query': return 'Running query'
    default: return name
  }
}

function isToolCallPending(msg: ChatMessage, toolCall: { id: string }): boolean {
  // A tool call is pending if there's no subsequent tool message with this ID
  const msgIndex = messages.value.indexOf(msg)
  return !messages.value.slice(msgIndex + 1).some(
    m => m.role === 'tool' && m.toolCallId === toolCall.id
  )
}

// ---------------------------------------------------------------------------
// Vertical splitter (chat ↔ scratchpad)
// ---------------------------------------------------------------------------

function handleVerticalSplitterMouseDown(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  isDraggingVerticalSplitter.value = true
  verticalDragStart.value.x = e.clientX
}

function handleMouseMove(e: MouseEvent) {
  const zoom = canvasZoom.value

  if (isDraggingVerticalSplitter.value) {
    const deltaX = (e.clientX - verticalDragStart.value.x) / zoom
    const newWidth = chatPanelWidth.value + deltaX
    const maxChatWidth = boxWidth.value - MIN_SCRATCHPAD_WIDTH - 4 // splitter width
    if (newWidth >= MIN_CHAT_WIDTH && newWidth <= maxChatWidth) {
      chatPanelWidth.value = newWidth
      verticalDragStart.value.x = e.clientX
    }
  }

  if (isDraggingHorizontalSplitter.value) {
    const deltaY = (e.clientY - horizontalDragStart.value.y) / zoom
    const newHeight = editorHeight.value + deltaY
    const contentHeight = boxHeight.value - HEADER_HEIGHT
    const maxEditorHeight = contentHeight * 0.8
    if (newHeight >= MIN_EDITOR_HEIGHT && newHeight <= maxEditorHeight) {
      editorHeight.value = newHeight
      horizontalDragStart.value.y = e.clientY
    }
  }
}

function handleMouseUp() {
  isDraggingVerticalSplitter.value = false
  isDraggingHorizontalSplitter.value = false
}

// ---------------------------------------------------------------------------
// Horizontal splitter (editor ↔ results in scratchpad)
// ---------------------------------------------------------------------------

function handleHorizontalSplitterMouseDown(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  isDraggingHorizontalSplitter.value = true
  horizontalDragStart.value.y = e.clientY
}

// ---------------------------------------------------------------------------
// Box size tracking
// ---------------------------------------------------------------------------

function handleUpdateSize(newSize: { width: number; height: number }) {
  boxWidth.value = newSize.width
  boxHeight.value = newSize.height
  // Clamp chat panel width
  const maxChatWidth = newSize.width - MIN_SCRATCHPAD_WIDTH - 4
  if (chatPanelWidth.value > maxChatWidth) {
    chatPanelWidth.value = Math.max(MIN_CHAT_WIDTH, maxChatWidth)
  }
  emit('update:size', newSize)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  // Restore query from persisted state
  if (persisted.query) {
    scratchpadState.query.value = persisted.query
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  if (saveTimeout) clearTimeout(saveTimeout)
  stop()
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
    @update:size="handleUpdateSize"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <div class="chat-layout">
      <!-- Left: Chat panel -->
      <div class="chat-panel" :style="{ width: chatPanelWidth + 'px' }">
        <!-- Messages -->
        <div ref="messagesContainerRef" class="messages">
          <div class="connection-label">{{ connectionInfo }}</div>

          <div v-if="messages.length === 0" class="empty-state">
            Ask a question about your data
          </div>

          <template v-for="(msg, i) in messages" :key="i">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="message user-message">
              <div class="message-content">{{ msg.content }}</div>
            </div>

            <!-- Assistant message -->
            <div v-else-if="msg.role === 'assistant'" class="message assistant-message">
              <!-- Tool calls -->
              <div v-if="msg.toolCalls" class="tool-calls">
                <div
                  v-for="tc in msg.toolCalls"
                  :key="tc.id"
                  class="tool-call"
                  :class="{ pending: isToolCallPending(msg, tc) }"
                >
                  <span class="tool-icon">{{ isToolCallPending(msg, tc) ? '...' : '\u2713' }}</span>
                  <span class="tool-label">{{ toolCallLabel(tc.name) }}</span>
                </div>
              </div>
              <!-- Text content -->
              <div
                v-if="msg.content"
                class="message-content markdown"
                v-html="renderMarkdown(msg.content)"
              />
            </div>

            <!-- Tool result messages are not rendered directly - they're shown via the tool call status -->
          </template>

          <!-- Streaming indicator -->
          <div v-if="isStreaming && streamingText" class="message assistant-message">
            <div class="message-content markdown" v-html="renderMarkdown(streamingText)" />
          </div>
          <div v-else-if="isStreaming" class="message assistant-message">
            <div class="message-content typing">Thinking...</div>
          </div>

          <!-- Error -->
          <div v-if="chatError" class="message error-message">
            <div class="message-content">{{ chatError }}</div>
          </div>
        </div>

        <!-- Input -->
        <div class="input-area">
          <textarea
            v-model="inputText"
            class="chat-input"
            placeholder="Ask about your data..."
            rows="2"
            :disabled="isStreaming"
            @keydown="handleInputKeydown"
          />
          <button
            class="send-button"
            :disabled="!inputText.trim() || isStreaming"
            @click="handleSend"
          >
            {{ isStreaming ? 'Stop' : 'Send' }}
          </button>
        </div>
      </div>

      <!-- Vertical splitter -->
      <div
        class="vertical-splitter"
        @mousedown="handleVerticalSplitterMouseDown"
      />

      <!-- Right: Scratchpad -->
      <div class="scratchpad-panel">
        <QueryEditor
          v-model="scratchpadState.query.value"
          :height="editorHeight"
          :is-running="scratchpadState.isRunning.value"
          :dialect="currentDialect"
        />

        <!-- Horizontal splitter -->
        <div
          class="horizontal-splitter"
          @mousedown="handleHorizontalSplitterMouseDown"
        />

        <ResultsTable
          :table-name="scratchpadState.tableName.value"
          :stats="scratchpadState.stats.value"
          :error="scratchpadState.error.value"
          :show-row-detail="false"
          :show-analytics="false"
        />
      </div>
    </div>
  </BaseBox>
</template>

<style scoped>
.chat-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Chat panel (left) */
.chat-panel {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  flex-shrink: 0;
  overflow: hidden;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.connection-label {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  padding-bottom: var(--space-2);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  flex-shrink: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body-sm);
  font-style: italic;
}

/* Messages */
.message {
  max-width: 100%;
}

.user-message .message-content {
  background: var(--surface-secondary);
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-normal);
  white-space: pre-wrap;
  word-break: break-word;
}

.assistant-message .message-content {
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-normal);
  word-break: break-word;
}

.assistant-message .message-content.typing {
  color: var(--text-tertiary);
  font-style: italic;
}

.error-message .message-content {
  color: var(--color-error);
  font-size: var(--font-size-body-sm);
}

/* Markdown rendering */
.markdown :deep(p) {
  margin: 0 0 var(--space-2) 0;
}

.markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown :deep(code) {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  background: var(--surface-secondary);
  padding: 1px 4px;
}

.markdown :deep(pre) {
  background: var(--surface-secondary);
  padding: var(--space-2);
  overflow-x: auto;
  margin: var(--space-2) 0;
  font-size: var(--font-size-caption);
}

.markdown :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: var(--space-4);
  margin: var(--space-1) 0;
}

.markdown :deep(li) {
  margin: var(--space-1) 0;
}

.markdown :deep(table) {
  border-collapse: collapse;
  font-size: var(--font-size-caption);
  margin: var(--space-2) 0;
}

.markdown :deep(th),
.markdown :deep(td) {
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: var(--space-1) var(--space-2);
}

/* Tool calls */
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}

.tool-call {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
}

.tool-call.pending {
  color: var(--text-tertiary);
}

.tool-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.tool-call.pending .tool-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.tool-label {
  font-weight: 500;
}

/* Input area */
.input-area {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  resize: none;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body-sm);
  padding: var(--space-1) 0;
  line-height: var(--line-height-normal);
  outline: none;
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.send-button {
  padding: var(--space-1) var(--space-2);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.send-button:hover:not(:disabled) {
  color: var(--text-primary);
}

.send-button:disabled {
  opacity: 0.3;
  cursor: default;
}

/* Vertical splitter (between chat and scratchpad) */
.vertical-splitter {
  width: var(--border-width-thin);
  background: var(--border-primary);
  cursor: ew-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.vertical-splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -6px;
  right: -6px;
  z-index: 10;
}

/* Scratchpad panel (right) */
.scratchpad-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  overflow: hidden;
}

/* Horizontal splitter (between editor and results) */
.horizontal-splitter {
  height: var(--border-width-thin);
  background: var(--border-primary);
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.horizontal-splitter::before {
  content: '';
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: 0;
  right: 0;
  z-index: 10;
}
</style>
