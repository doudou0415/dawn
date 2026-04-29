/**
 * MCP 管理器 — 管理多个 MCP 客户端连接
 *
 * 提供统一注册、发现、调用接口。
 * 可在 Coordinator 初始化时加载配置中的 MCP 服务器。
 */

import { getLogger } from '@dawn/core';
const logger = getLogger('MCPManager');
import { MCPClient } from './client.js';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPServerStatus,
} from './types.js';

export class MCPManager {
  private clients = new Map<string, MCPClient>();
  private toolIndex = new Map<string, string>(); // toolName → serverName

  /** 注册并连接 MCP 服务器 */
  async registerServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      logger.warn(`[MCP] 服务器 ${config.name} 已注册`);
      return;
    }

    const client = new MCPClient(config);
    this.clients.set(config.name, client);

    client.on('tools', (tools: MCPToolDefinition[]) => {
      for (const t of tools) {
        this.toolIndex.set(t.name, config.name);
      }
      logger.info(`[MCP] ${config.name} 注册了 ${tools.length} 个工具`);
    });

    if (config.enabled) {
      await client.connect();
    }
  }

  /** 获取所有可用 MCP 工具 */
  getAllTools(): MCPToolDefinition[] {
    const tools: MCPToolDefinition[] = [];
    for (const [name, client] of this.clients) {
      if (client.state === 'connected') {
        tools.push(...client.tools);
      }
    }
    return tools;
  }

  /** 调用 MCP 工具 */
  async callTool(request: MCPToolCallRequest): Promise<MCPToolCallResult> {
    const client = this.clients.get(request.serverName);
    if (!client) {
      return { success: false, content: [{ type: 'text', text: `服务器 ${request.serverName} 未注册` }], isError: true };
    }
    if (client.state !== 'connected') {
      return { success: false, content: [{ type: 'text', text: `服务器 ${request.serverName} 未连接` }], isError: true };
    }
    return client.callTool(request);
  }

  /** 按工具名查找并调用 */
  async callToolByName(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const serverName = this.toolIndex.get(toolName);
    if (!serverName) {
      return { success: false, content: [{ type: 'text', text: `工具 ${toolName} 未找到` }], isError: true };
    }
    const client = this.clients.get(serverName);
    if (!client) {
      return { success: false, content: [{ type: 'text', text: `服务器 ${serverName} 未注册` }], isError: true };
    }
    const tool = client.tools.find(t => t.name === toolName);
    return client.callTool({
      serverName,
      toolName: tool?.originalName || toolName,
      arguments: args,
    });
  }

  /** 断开所有 MCP 连接 */
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      client.disconnect();
      logger.info(`[MCP] ${name} 已断开`);
    }
    this.clients.clear();
    this.toolIndex.clear();
  }

  /** 获取所有服务器状态 */
  getAllStatus(): MCPServerStatus[] {
    const statuses: MCPServerStatus[] = [];
    for (const [name, client] of this.clients) {
      statuses.push(client.getStatus());
    }
    return statuses;
  }

  /** 获取客户端 */
  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }
}

// 全局单例
export const mcpManager = new MCPManager();
