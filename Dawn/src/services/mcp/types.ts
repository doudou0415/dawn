/**
 * MCP 类型定义 — 轻量版
 *
 * 移植自 Dawn 本体 src/services/mcp/types.ts 的核心类型：
 * - Transport 类型（stdio/sse/http）
 * - MCP 服务器配置
 * - 工具发现/调用结果类型
 */

/** MCP 服务器配置 */
export interface MCPServerConfig {
  /** 唯一标识 */
  name: string;
  /** 传输类型 */
  transport: 'stdio' | 'sse' | 'http';
  /** stdio 命令（transport=stdio） */
  command?: string;
  /** stdio 参数 */
  args?: string[];
  /** 环境变量覆盖 */
  env?: Record<string, string>;
  /** SSE/HTTP URL */
  url?: string;
  /** 是否启用 */
  enabled: boolean;
}

/** MCP 工具定义 */
export interface MCPToolDefinition {
  /** 工具名（含命名空间前缀） */
  name: string;
  /** 原始工具名 */
  originalName: string;
  /** 描述 */
  description: string;
  /** 参数 schema（JSON Schema） */
  inputSchema: Record<string, unknown>;
  /** 所属服务器 */
  serverName: string;
}

/** 工具调用请求 */
export interface MCPToolCallRequest {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/** 工具调用结果 */
export interface MCPToolCallResult {
  success: boolean;
  content: Array<{
    type: 'text' | 'resource' | 'image';
    text?: string;
    resource?: { uri: string; text: string; mimeType?: string };
  }>;
  isError?: boolean;
}

/** MCP 客户端连接状态 */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP 服务器状态 */
export interface MCPServerStatus {
  name: string;
  state: MCPConnectionState;
  tools: number;
  error?: string;
  lastConnected?: number;
}
