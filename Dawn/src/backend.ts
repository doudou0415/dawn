/**
 * backend.ts — Tauri/IPC 后端服务入口
 *
 * 供 Tauri 或独立进程调用，初始化 Orchestrator + 能力注册。
 */

import { Coordinator } from './engine/coordinator/Coordinator.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { ReadTool, WriteTool } from './tools/index.js';
import { getLogger } from '@dawn/core';
const logger = getLogger('Backend');

export interface BackendOptions {
  memoryBasePath?: string;
  evolutionEnabled?: boolean;
}

export class DawnBackend {
  public orchestrator: Coordinator;
  public toolRegistry: ToolRegistry;

  constructor(options: BackendOptions = {}) {
    this.orchestrator = new Coordinator({} as any);
    this.toolRegistry = new ToolRegistry();

    // 注册内置工具
    this.toolRegistry.register(ReadTool);
    this.toolRegistry.register(WriteTool);
  }

  async execute(input: string): Promise<{ response: string }> {
    const result = await this.orchestrator.execute(input);
    return { response: result.response };
  }

  getStats() {
    return this.orchestrator.getStats();
  }
}

export default DawnBackend;
