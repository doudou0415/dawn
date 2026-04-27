/**
 * MCPClient — 轻量级 MCP 协议客户端
 *
 * 移植自 Dawn 本体 src/services/mcp/client.ts 的核心能力：
 * - stdio 传输：通过子进程运行 MCP 服务器
 * - SSE 传输：通过 HTTP 连接远程 MCP 服务器
 * - 工具发现（listTools）
 * - 工具调用（callTool）
 *
 * 参考 MCP 规范：https://spec.modelcontextprotocol.io/
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { logger } from '../../utils/index.js';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPConnectionState,
  MCPServerStatus,
} from './types.js';

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type MessageCallback = (msg: JSONRPCMessage) => void;

const STDIO_TIMEOUT = 30_000; // 30s
const SSE_TIMEOUT = 60_000;   // 60s
const MAX_RECONNECT_DELAY = 30_000;

/**
 * MCP 协议客户端
 * 每个实例管理一个 MCP 服务器连接
 */
export class MCPClient extends EventEmitter {
  public readonly name: string;
  public state: MCPConnectionState = 'disconnected';
  public tools: MCPToolDefinition[] = [];

  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private msgId = 0;
  private handlers = new Set<MessageCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.name = config.name;
  }

  /** 连接 MCP 服务器 */
  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    this.state = 'connecting';
    this.emit('state', this.state);

    try {
      switch (this.config.transport) {
        case 'stdio':
          await this.connectStdio();
          break;
        case 'sse':
        case 'http':
          await this.connectSSE();
          break;
        default:
          throw new Error(`不支持的传输类型: ${this.config.transport}`);
      }
      this.state = 'connected';
      this.connected = true;
      this.emit('state', this.state);
      logger.info(`[MCP] ${this.name} 已连接`);

      // 连接后自动发现工具
      await this.discoverTools();
    } catch (err) {
      this.state = 'error';
      this.emit('state', this.state);
      this.emit('error', err);
      logger.error(`[MCP] ${this.name} 连接失败: ${(err as Error).message}`);
      throw err;
    }
  }

  /** 发现服务器工具 */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
    this.tools = (result.tools || []).map(t => ({
      name: `${this.name}_${t.name}`,
      originalName: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
      serverName: this.name,
    }));
    this.emit('tools', this.tools);
    return this.tools;
  }

  /** 调用工具 */
  async callTool(request: MCPToolCallRequest): Promise<MCPToolCallResult> {
    const result = await this.sendRequest('tools/call', {
      name: request.toolName,
      arguments: request.arguments,
    }) as { content?: MCPToolCallResult['content']; isError?: boolean };

    return {
      success: !result.isError,
      content: result.content || [],
      isError: result.isError,
    };
  }

  /** 列出资源 */
  async listResources(): Promise<Array<{ uri: string; name: string; description?: string }>> {
    const result = await this.sendRequest('resources/list', {}) as { resources?: Array<{ uri: string; name: string; description?: string }> };
    return result.resources || [];
  }

  /** 读取资源 */
  async readResource(uri: string): Promise<string | null> {
    const result = await this.sendRequest('resources/read', { uri }) as { contents?: Array<{ text: string }> };
    return result.contents?.[0]?.text || null;
  }

  /** 断开连接 */
  disconnect(): void {
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error('连接已断开'));
      clearTimeout(pending.timer);
    }
    this.pending.clear();
    this.state = 'disconnected';
    this.emit('state', this.state);
  }

  /** 获取状态 */
  getStatus(): MCPServerStatus {
    return {
      name: this.name,
      state: this.state,
      tools: this.tools.length,
    };
  }

  // ── stdio 传输 ──
  private async connectStdio(): Promise<void> {
    const cmd = this.config.command;
    if (!cmd) throw new Error('stdio 模式需要 command');

    this.process = spawn(cmd, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logger.warn(`[MCP:${this.name}] stderr: ${text}`);
    });
    this.process.on('exit', (code) => {
      logger.warn(`[MCP] ${this.name} 进程退出 (code=${code})`);
      if (this.connected) {
        this.scheduleReconnect();
      }
    });
    this.process.on('error', (err) => {
      logger.error(`[MCP] ${this.name} 进程错误: ${err.message}`);
    });

    // 发送初始化请求
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dawn-new', version: '1.0.0' },
    });
  }

  // ── SSE 传输 ──
  private async connectSSE(): Promise<void> {
    const url = this.config.url;
    if (!url) throw new Error('SSE/HTTP 模式需要 url');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SSE_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (!response.ok) throw new Error(`SSE 连接失败: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('SSE body 不可读');

      const decoder = new TextDecoder();
      const readLoop = async () => {
        while (this.connected) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const msg = JSON.parse(line.slice(6)) as JSONRPCMessage;
                this.onMessage(msg);
              } catch { /* 忽略解析错误 */ }
            }
          }
        }
      };
      readLoop().catch(() => {});
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── 消息处理 ──
  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCMessage;
        this.onMessage(msg);
      } catch {
        /* 忽略非 JSON 行（如日志输出） */
      }
    }
  }

  private onMessage(msg: JSONRPCMessage): void {
    // 通知所有处理器
    for (const handler of this.handlers) {
      try { handler(msg); } catch { /* 忽略处理器错误 */ }
    }

    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP 错误 [${msg.error.code}]: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }

    // 处理通知
    if (msg.method && !msg.id) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const msg: JSONRPCMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, STDIO_TIMEOUT);

      this.pending.set(id, { resolve, reject, timer });

      const payload = JSON.stringify(msg) + '\n';
      if (this.process?.stdin) {
        this.process.stdin.write(payload);
      } else {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('MCP 进程未就绪'));
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.tools.length), MAX_RECONNECT_DELAY);
    logger.info(`[MCP] ${this.name} 将在 ${delay}ms 后重连`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }
}
