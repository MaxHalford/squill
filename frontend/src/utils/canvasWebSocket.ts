/**
 * WebSocket client for real-time canvas sync.
 * Replaces HocuspocusProvider with a simpler JSON-based protocol.
 */

export interface CanvasWSEvent {
  type: string
  data: Record<string, unknown>
  version?: number
  by?: string | null
  client_id?: string
}

export interface CanvasWebSocketOptions {
  url: string
  canvasId: string
  token: string
  onEvent: (event: CanvasWSEvent) => void
  onStatusChange: (connected: boolean) => void
}

export class CanvasWebSocket {
  private ws: WebSocket | null = null
  private options: CanvasWebSocketOptions
  private reconnectAttempts = 0
  private maxReconnectDelay = 30_000
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(options: CanvasWebSocketOptions) {
    this.options = options
    this.connect()
  }

  private connect() {
    if (this.disposed) return

    const wsUrl = this.options.url.replace(/^http/, 'ws')
    const fullUrl = `${wsUrl}/ws/canvas/${this.options.canvasId}?token=${encodeURIComponent(this.options.token)}`

    this.ws = new WebSocket(fullUrl)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.options.onStatusChange(true)
      this.startHeartbeat()
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as CanvasWSEvent
        if (data.type === 'pong') return
        this.options.onEvent(data)
      } catch {
        console.error('[canvasWS] Failed to parse message:', event.data)
      }
    }

    this.ws.onclose = () => {
      this.options.onStatusChange(false)
      this.stopHeartbeat()
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30_000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.disposed) return
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      this.maxReconnectDelay,
    )
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  send(message: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  dispose() {
    this.disposed = true
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }
}
