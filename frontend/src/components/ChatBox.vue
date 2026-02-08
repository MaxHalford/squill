<script setup lang="ts">
import { ref, inject, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import BaseBox from './BaseBox.vue'
import QueryPanel, { type QueryCompleteEvent } from './QueryPanel.vue'
import { useChat, type ChatMessage, type TokenUsage } from '../composables/useChat'
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

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

interface ChatStats {
  totalExecutionTimeMs: number
  totalBytesProcessed: number
  totalQueries: number
}

function parsePersistedState(): {
  messages: ChatMessage[]
  query: string
  chatStats: ChatStats
  tokenUsage: TokenUsage
} {
  const defaults = {
    messages: [] as ChatMessage[],
    query: '',
    chatStats: { totalExecutionTimeMs: 0, totalBytesProcessed: 0, totalQueries: 0 },
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }
  if (!props.initialQuery) return defaults
  try {
    const parsed = JSON.parse(props.initialQuery)
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.messages)) {
      return {
        messages: parsed.messages,
        query: parsed.query || '',
        chatStats: parsed.chatStats || defaults.chatStats,
        tokenUsage: parsed.tokenUsage || defaults.tokenUsage,
      }
    }
    // Legacy format: plain array of messages
    if (Array.isArray(parsed)) return { ...defaults, messages: parsed }
  } catch {
    // Not valid JSON, ignore
  }
  return defaults
}

const persisted = parsePersistedState()

// ---------------------------------------------------------------------------
// QueryPanel
// ---------------------------------------------------------------------------

const queryPanelRef = ref<InstanceType<typeof QueryPanel> | null>(null)
const currentQuery = ref(persisted.query)

// ---------------------------------------------------------------------------
// Chat tools
// ---------------------------------------------------------------------------

const connectionIdRef = computed(() => props.connectionId)

const { handleToolCall, dialect, connectionInfo } = useChatTools(connectionIdRef, {
  onRunQuery: (query) => queryPanelRef.value!.runQuery(query),
})

// ---------------------------------------------------------------------------
// Chat composable
// ---------------------------------------------------------------------------

const {
  messages,
  isStreaming,
  streamingText,
  error: chatError,
  tokenUsage,
  sendMessage,
  stop,
} = useChat({
  apiUrl: `${BACKEND_URL}/ask-wizard/`,
  sessionToken: computed(() => userStore.sessionToken),
  dialect,
  connectionInfo,
  currentQuery,
  onToolCall: handleToolCall,
  initialMessages: persisted.messages,
  initialTokenUsage: persisted.tokenUsage,
})

// ---------------------------------------------------------------------------
// Cumulative stats
// ---------------------------------------------------------------------------

const chatStats = ref<ChatStats>({ ...persisted.chatStats })

function handleQueryComplete(result: QueryCompleteEvent) {
  chatStats.value.totalQueries++
  chatStats.value.totalExecutionTimeMs += result.executionTimeMs
  if (result.stats?.totalBytesProcessed) {
    chatStats.value.totalBytesProcessed += parseInt(result.stats.totalBytesProcessed, 10)
  }
}

const totalCost = computed(() => {
  const bytes = chatStats.value.totalBytesProcessed
  if (bytes === 0) return null
  const TB = 1024 ** 4
  const cost = (bytes / TB) * 5
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
})

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return String(count)
}

const hasStats = computed(() =>
  chatStats.value.totalQueries > 0 || tokenUsage.value.totalTokens > 0,
)

// ---------------------------------------------------------------------------
// Chat input
// ---------------------------------------------------------------------------

const inputText = ref('')
const messagesContainerRef = ref<HTMLElement | null>(null)

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

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function persistState() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    const msgs = messages.value.filter(
      m => m.role === 'user' || (m.role === 'assistant' && m.content),
    )
    emit('update:query', JSON.stringify({
      messages: msgs,
      query: currentQuery.value,
      chatStats: chatStats.value,
      tokenUsage: tokenUsage.value,
    }))
  }, 500)
}

watch(() => messages.value.length, persistState)
watch(currentQuery, persistState)
watch(chatStats, persistState, { deep: true })
watch(tokenUsage, persistState, { deep: true })

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
  const msgIndex = messages.value.indexOf(msg)
  return !messages.value.slice(msgIndex + 1).some(
    m => m.role === 'tool' && m.toolCallId === toolCall.id,
  )
}

// ---------------------------------------------------------------------------
// Vertical splitter (chat <-> QueryPanel)
// ---------------------------------------------------------------------------

const isDraggingVerticalSplitter = ref(false)
const chatPanelWidth = ref(450)
const verticalDragStart = ref({ x: 0 })

const MIN_CHAT_WIDTH = 200
const MIN_SCRATCHPAD_WIDTH = 200

const boxWidth = ref(props.initialWidth)

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
    const maxChatWidth = boxWidth.value - MIN_SCRATCHPAD_WIDTH - 4
    if (newWidth >= MIN_CHAT_WIDTH && newWidth <= maxChatWidth) {
      chatPanelWidth.value = newWidth
      verticalDragStart.value.x = e.clientX
    }
  }
}

function handleMouseUp() {
  isDraggingVerticalSplitter.value = false
}

function handleUpdateSize(newSize: { width: number; height: number }) {
  boxWidth.value = newSize.width
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
      <div
        class="chat-panel"
        :style="{ width: chatPanelWidth + 'px' }"
      >
        <!-- Messages -->
        <div
          ref="messagesContainerRef"
          class="messages"
        >
          <div class="connection-label">
            {{ connectionInfo }}
          </div>

          <div
            v-if="messages.length === 0"
            class="empty-state"
          >
            Ask a question about your data
          </div>

          <template
            v-for="(msg, i) in messages"
            :key="i"
          >
            <!-- User message -->
            <div
              v-if="msg.role === 'user'"
              class="message user-message"
            >
              <div class="message-content">
                {{ msg.content }}
              </div>
            </div>

            <!-- Assistant message -->
            <div
              v-else-if="msg.role === 'assistant'"
              class="message assistant-message"
            >
              <!-- Tool calls -->
              <div
                v-if="msg.toolCalls"
                class="tool-calls"
              >
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
          </template>

          <!-- Streaming indicator -->
          <div
            v-if="isStreaming && streamingText"
            class="message assistant-message"
          >
            <div
              class="message-content markdown"
              v-html="renderMarkdown(streamingText)"
            />
          </div>
          <div
            v-else-if="isStreaming"
            class="message assistant-message"
          >
            <div class="message-content typing">
              Thinking...
            </div>
          </div>

          <!-- Error -->
          <div
            v-if="chatError"
            class="message error-message"
          >
            <div class="message-content">
              {{ chatError }}
            </div>
          </div>
        </div>

        <!-- Session stats -->
        <div
          v-if="hasStats"
          class="session-stats"
        >
          <span
            v-if="chatStats.totalQueries > 0"
            class="stat"
          >
            {{ chatStats.totalQueries }} {{ chatStats.totalQueries === 1 ? 'query' : 'queries' }}
          </span>
          <span
            v-if="chatStats.totalExecutionTimeMs > 0"
            class="stat"
          >
            {{ formatTime(chatStats.totalExecutionTimeMs) }}
          </span>
          <span
            v-if="totalCost"
            class="stat"
          >{{ totalCost }}</span>
          <span
            v-if="tokenUsage.totalTokens > 0"
            class="stat"
          >
            {{ formatTokens(tokenUsage.totalTokens) }} tokens
          </span>
        </div>

        <!-- Input -->
        <div class="input-area">
          <textarea
            v-model="inputText"
            name="chat-input"
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

      <!-- Right: Query Panel -->
      <div class="scratchpad-panel">
        <QueryPanel
          ref="queryPanelRef"
          v-model="currentQuery"
          :connection-id="connectionId"
          :box-id="boxId"
          :box-name="`_chat_${boxId}`"
          :show-row-detail="false"
          :show-analytics="false"
          :show-autofix="false"
          @query-complete="handleQueryComplete"
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

/* Session stats */
.session-stats {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  border-top: var(--border-width-thin) solid var(--border-secondary);
  flex-shrink: 0;
}

.session-stats .stat {
  white-space: nowrap;
}

/* Input area */
.input-area {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  align-items: flex-end;
  border-top: var(--border-width-thin) solid var(--border-primary);
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
</style>
