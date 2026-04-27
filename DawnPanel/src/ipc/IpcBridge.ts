/**
 * IpcBridge — 双端强健通信层
 *
 * 核心能力：
 * - 心跳机制（每 3-5 秒 ping）
 * - 自动重连 + 指数退避（最大 30s）
 * - 请求队列 + 超时重试（默认 30s）
 * - 状态回执（pending / success / error / timeout）
 * - 事件总线（onConnectionChange, onHeartbeatLost 等）
 */

export type RequestStatus = 'pending' | 'success' | 'error' | 'timeout'

export interface IpcRequest<T = unknown> {
  id: string
  method: string
  params: unknown[]
  resolve: (value: T) => void
  reject: (reason: Error) => void
  status: RequestStatus
  createdAt: number
  timeout: number
  retriesLeft: number
}

export interface IpcBridgeOptions {
  /** 后端 URL，默认 http://localhost:3457 */
  baseUrl?: string
  /** 心跳间隔（ms），默认 5000 */
  heartbeatInterval?: number
  /** 请求超时（ms），默认 30000 */
  requestTimeout?: number
  /** 最大重试次数，默认 3 */
  maxRetries?: number
  /** 初始重连延迟（ms），默认 1000 */
  reconnectBaseDelay?: number
  /** 最大重连延迟（ms），默认 30000 */
  reconnectMaxDelay?: number
  /** 心跳丢失阈值次数，默认 3 */
  heartbeatLostThreshold?: number
}

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'heartbeat_lost'

export interface IpcEventMap {
  connectionChange: (state: ConnectionState) => void
  heartbeatLost: (lastSeen: number) => void
  reconnecting: (attempt: number) => void
  requestComplete: (id: string, status: RequestStatus, duration: number) => void
  error: (error: Error) => void
}

type Listener = (...args: any[]) => void

export class IpcBridge {
  private baseUrl: string
  private heartbeatInterval: number
  private requestTimeout: number
  private maxRetries: number
  private reconnectBaseDelay: number
  private reconnectMaxDelay: number
  private heartbeatLostThreshold: number

  private connectionState: ConnectionState = 'disconnected'
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastHeartbeatResponse: number = 0
  private heartbeatMissCount: number = 0
  private reconnectAttempt: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private pendingRequests: Map<string, IpcRequest<any>> = new Map()
  private requestQueue: Array<() => void> = []
  private listeners: Map<string, Set<Listener>> = new Map()

  /** WebSocket 连接（用于实时日志） */
  private ws: WebSocket | null = null
  private wsSessionId: string = ''
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** 日志订阅回调 */
  private onLog: ((level: string, text: string) => void) | null = null
  private onTaskDone: ((response: string) => void) | null = null

  /** 获取 WebSocket Session ID */
  getWsSessionId(): string {
    return this.wsSessionId
  }

  /** 连接 WebSocket 并订阅实时日志 */
  connectWs(onLog?: (level: string, text: string) => void, onTaskDone?: (response: string) => void): void {
    this.onLog = onLog || null
    this.onTaskDone = onTaskDone || null
    this.wsSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.tryConnectWs()
  }

  private tryConnectWs(): void {
    if (this.ws) {
      try { this.ws.close() } catch {}
      this.ws = null
    }
    try {
      const baseUrl = this.baseUrl || 'http://localhost:3457'
      const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws?sessionId=${this.wsSessionId}`
      this.ws = new WebSocket(wsUrl)
      this.ws.onopen = () => {
        console.log('[IpcBridge WS] 已连接')
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'task_log' && this.onLog) {
            this.onLog(data.level, data.text)
          } else if (data.type === 'task_done' && this.onTaskDone) {
            this.onTaskDone(data.response)
          }
        } catch {}
      }
      this.ws.onclose = () => {
        console.log('[IpcBridge WS] 断开，3秒后重连')
        this.wsReconnectTimer = setTimeout(() => this.tryConnectWs(), 3000)
      }
      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch {}
  }

  /** 断开 WebSocket */
  disconnectWs(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    if (this.ws) {
      try { this.ws.close() } catch {}
      this.ws = null
    }
  }

  /** 当前权限级别（前端可设置，每次请求自动带上） */
  public permissionLevel: number = 3

  /** 统计 */
  public stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timedOutRequests: 0,
    reconnections: 0,
  }

  constructor(options: IpcBridgeOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:3457'
    this.heartbeatInterval = options.heartbeatInterval ?? 5000
    this.requestTimeout = options.requestTimeout ?? 30000
    this.maxRetries = options.maxRetries ?? 3
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 1000
    this.reconnectMaxDelay = options.reconnectMaxDelay ?? 30000
    this.heartbeatLostThreshold = options.heartbeatLostThreshold ?? 3
  }

  // ─── 事件总线 ───────────────────────────────────────────

  on<K extends keyof IpcEventMap>(event: K, listener: IpcEventMap[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as Listener)
    return () => this.listeners.get(event)?.delete(listener as Listener)
  }

  private emit<K extends keyof IpcEventMap>(event: K, ...args: Parameters<IpcEventMap[K]>): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
  }

  // ─── 连接管理 ───────────────────────────────────────────

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      this.emit('connectionChange', state)
    }
  }

  /** 启动连接（开始心跳并立即执行排队请求） */
  connect(): void {
    if (this.heartbeatTimer) {
      // 已有心跳定时器，但检查是否需要恢复状态
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connected')
      }
      return
    }
    this.setConnectionState('connected')
    this.lastHeartbeatResponse = Date.now()
    this.heartbeatMissCount = 0
    this.startHeartbeat()
    this.drainQueue()
  }

  /** 断开连接（停止所有定时器） */
  disconnect(): void {
    this.stopHeartbeat()
    this.stopReconnect()
    this.setConnectionState('disconnected')
    // 拒绝所有 pending 请求
    for (const [id, req] of this.pendingRequests) {
      req.reject(new Error('Connection closed'))
      this.pendingRequests.delete(id)
    }
  }

  // ─── 心跳 ────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.ping(), this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async ping(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/__heartbeat`, { method: 'GET', signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        this.lastHeartbeatResponse = Date.now()
        this.heartbeatMissCount = 0
        if (this.connectionState === 'reconnecting' || this.connectionState === 'heartbeat_lost') {
          this.setConnectionState('connected')
          this.reconnectAttempt = 0
          this.stats.reconnections++
          this.emit('reconnecting', 0) // recovered
          // 清空队列
          this.drainQueue()
        }
      } else {
        this.handleMissedHeartbeat()
      }
    } catch {
      this.handleMissedHeartbeat()
    }
  }

  private handleMissedHeartbeat(): void {
    this.heartbeatMissCount++
    if (this.heartbeatMissCount >= this.heartbeatLostThreshold) {
      this.setConnectionState('heartbeat_lost')
      this.emit('heartbeatLost', this.lastHeartbeatResponse)
      this.startReconnect()
    }
  }

  // ─── 自动重连（指数退避） ─────────────────────────────

  private startReconnect(): void {
    if (this.reconnectTimer) return
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.setConnectionState('reconnecting')
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempt),
      this.reconnectMaxDelay,
    )
    this.reconnectAttempt++
    this.emit('reconnecting', this.reconnectAttempt)
    this.reconnectTimer = setTimeout(() => this.tryReconnect(), delay)
  }

  private async tryReconnect(): Promise<void> {
    this.reconnectTimer = null
    try {
      const res = await fetch(`${this.baseUrl}/__heartbeat`, { method: 'GET', signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        this.lastHeartbeatResponse = Date.now()
        this.heartbeatMissCount = 0
        this.setConnectionState('connected')
        this.reconnectAttempt = 0
        this.stats.reconnections++
        this.drainQueue()
      } else {
        this.scheduleReconnect()
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ─── 请求队列 ────────────────────────────────────────────

  private enqueue(fn: () => void): void {
    this.requestQueue.push(fn)
  }

  private drainQueue(): void {
    const queue = [...this.requestQueue]
    this.requestQueue = []
    queue.forEach((fn) => fn())
  }

  // ─── 核心 invoke ─────────────────────────────────────────

  async invoke<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.stats.totalRequests++

    return new Promise<T>((resolve, reject) => {
      const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const request: IpcRequest<T> = {
        id,
        method,
        params,
        resolve: resolve as (value: T) => void,
        reject,
        status: 'pending',
        createdAt: Date.now(),
        timeout: this.requestTimeout,
        retriesLeft: this.maxRetries,
      }

      this.pendingRequests.set(id, request)

      const execute = () => {
        this.sendRequest(request)
      }

      if (this.connectionState === 'disconnected' || this.connectionState === 'heartbeat_lost') {
        // 队列等待，触发重连
        this.enqueue(execute)
        if (this.connectionState === 'disconnected') {
          this.connect()
        }
      } else {
        execute()
      }
    })
  }

  private async sendRequest<T>(request: IpcRequest<any>): Promise<void> {
    const { id, method, params, timeout } = request
    const url = `${this.baseUrl}/api/${method}`

    // 超时控制器
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // 构建 body：针对已知后端格式做适配
    let body: string
    if (method === 'runFullTask') {
      // 后端期望 { task: string, wsSessionId: string }，params[0] 是用户文本
      body = JSON.stringify({
        task: (params[0] as string) || '',
        wsSessionId: this.wsSessionId,
      })
    } else {
      body = JSON.stringify({ method, params, id })
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Permission-Level': String(this.permissionLevel),
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      request.status = 'success'
      this.stats.successfulRequests++
      const duration = Date.now() - request.createdAt
      this.emit('requestComplete', id, 'success', duration)
      ;(request as unknown as IpcRequest<T>).resolve(data)
    } catch (err: unknown) {
      clearTimeout(timeoutId)

      if (err instanceof DOMException && err.name === 'AbortError') {
        request.status = 'timeout'
        this.stats.timedOutRequests++
        const duration = Date.now() - request.createdAt
        this.emit('requestComplete', id, 'timeout', duration)

        if (request.retriesLeft > 0) {
          request.retriesLeft--
          // 指数退避重试
          const retryDelay = Math.min(1000 * Math.pow(2, this.maxRetries - request.retriesLeft), 10000)
          setTimeout(() => this.sendRequest(request), retryDelay)
          return
        }

        ;(request as unknown as IpcRequest<T>).reject(new Error(`Request timed out after ${timeout}ms: ${method}`))
      } else {
        request.status = 'error'
        this.stats.failedRequests++
        const duration = Date.now() - request.createdAt
        this.emit('requestComplete', id, 'error', duration)
        this.emit('error', err instanceof Error ? err : new Error(String(err)))

        if (request.retriesLeft > 0) {
          request.retriesLeft--
          const retryDelay = Math.min(1000 * Math.pow(2, this.maxRetries - request.retriesLeft), 10000)
          setTimeout(() => this.sendRequest(request), retryDelay)
          return
        }

        ;(request as unknown as IpcRequest<T>).reject(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      this.pendingRequests.delete(id)
    }
  }

  // ─── 便利方法 ────────────────────────────────────────────

  /** 检查后端是否在线 */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/__heartbeat`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** 获取当前连接状态 */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /** 获取队列长度 */
  getQueueLength(): number {
    return this.requestQueue.length
  }
}
