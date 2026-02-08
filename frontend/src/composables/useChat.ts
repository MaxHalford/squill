/**
 * Minimal chat composable with SSE streaming and agent loop.
 *
 * The agent loop follows this pattern in a loop:
 * 1. Send messages to backend
 * 2. Stream response (text deltas + tool calls)
 * 3. If tool calls: execute on frontend, add results, repeat
 * 4. If no tool calls: done
 */

import { ref, type Ref } from 'vue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** SSE event from backend */
interface SSEEvent {
  type: 'text-delta' | 'tool-call' | 'finish' | 'error'
  content?: string
  id?: string
  name?: string
  args?: Record<string, unknown>
  reason?: string
  message?: string
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
}

export interface UseChatOptions {
  apiUrl: string
  sessionToken: Ref<string | null>
  dialect: Ref<string>
  connectionInfo: Ref<string>
  currentQuery: Ref<string>
  onToolCall: (toolCall: ToolCall) => Promise<string>
  maxSteps?: number
  initialMessages?: ChatMessage[]
  initialTokenUsage?: TokenUsage
}

// ---------------------------------------------------------------------------
// SSE reader
// ---------------------------------------------------------------------------

async function* readSSE(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6) // Remove 'data: ' prefix
        if (data === '[DONE]') return

        try {
          yield JSON.parse(data) as SSEEvent
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions) {
  const { apiUrl, sessionToken, dialect, connectionInfo, currentQuery, onToolCall, maxSteps = 10, initialMessages, initialTokenUsage } = options

  const messages = ref<ChatMessage[]>(initialMessages ? [...initialMessages] : [])
  const isStreaming = ref(false)
  const streamingText = ref('')
  const error = ref<string | null>(null)
  const tokenUsage = ref<TokenUsage>(initialTokenUsage ? { ...initialTokenUsage } : { inputTokens: 0, outputTokens: 0, totalTokens: 0 })

  let abortController: AbortController | null = null

  /** Convert messages to OpenAI format for the backend */
  function toOpenAIMessages(msgs: ChatMessage[]): object[] {
    const result: object[] = []

    for (const msg of msgs) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        const entry: Record<string, unknown> = { role: 'assistant', content: msg.content || null }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          entry.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }))
        }
        result.push(entry)
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        })
      }
    }

    return result
  }

  /** Send messages to backend and stream the response */
  async function streamFromBackend(signal: AbortSignal): Promise<{ text: string; toolCalls: ToolCall[]; error?: string }> {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {}),
      },
      body: JSON.stringify({
        messages: toOpenAIMessages(messages.value),
        dialect: dialect.value,
        connection_info: connectionInfo.value,
        current_query: currentQuery.value || undefined,
      }),
      signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Chat request failed (${response.status}): ${body}`)
    }

    let text = ''
    const toolCalls: ToolCall[] = []
    let errorMsg: string | undefined

    for await (const event of readSSE(response, signal)) {
      switch (event.type) {
        case 'text-delta':
          text += event.content || ''
          streamingText.value = text
          break
        case 'tool-call':
          if (event.id && event.name) {
            toolCalls.push({
              id: event.id,
              name: event.name,
              args: event.args || {},
            })
          }
          break
        case 'error':
          errorMsg = event.message || 'Unknown error'
          break
        case 'finish':
          if (event.usage) {
            tokenUsage.value.inputTokens += event.usage.input_tokens
            tokenUsage.value.outputTokens += event.usage.output_tokens
            tokenUsage.value.totalTokens += event.usage.total_tokens
          }
          break
      }
    }

    return { text, toolCalls, error: errorMsg }
  }

  /** The agent loop */
  async function sendMessage(text: string) {
    if (isStreaming.value) return

    error.value = null
    isStreaming.value = true
    streamingText.value = ''

    abortController = new AbortController()
    const signal = abortController.signal

    // Add user message
    messages.value.push({ role: 'user', content: text })

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) break

        // Reset streaming text for this turn
        streamingText.value = ''

        const result = await streamFromBackend(signal)

        if (result.error) {
          error.value = result.error
          // Still add any text as assistant message
          if (result.text) {
            messages.value.push({ role: 'assistant', content: result.text })
          }
          break
        }

        // Add assistant message
        messages.value.push({
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        })

        // If no tool calls, we're done
        if (result.toolCalls.length === 0) break

        // Execute tools and add results
        for (const tc of result.toolCalls) {
          if (signal.aborted) break

          try {
            const toolResult = await onToolCall(tc)
            messages.value.push({
              role: 'tool',
              content: toolResult,
              toolCallId: tc.id,
            })
          } catch (err) {
            messages.value.push({
              role: 'tool',
              content: JSON.stringify({ error: String(err) }),
              toolCallId: tc.id,
            })
          }
        }

        // Loop continues — send tool results to backend
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        error.value = (err as Error).message || 'Failed to send message'
      }
    } finally {
      isStreaming.value = false
      streamingText.value = ''
      abortController = null
    }
  }

  function stop() {
    abortController?.abort()
  }

  function clear() {
    messages.value = []
    error.value = null
    streamingText.value = ''
  }

  return {
    messages,
    isStreaming,
    streamingText,
    error,
    tokenUsage,
    sendMessage,
    stop,
    clear,
  }
}
