/**
 * ToolRegistry — 统一工具注册中心
 * 管理所有对外工具调用（文件读写、搜索、终端等）。
 * 提供统一的 Tool Calling 适配器接口。
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }
    return tool.handler(args);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  get size(): number {
    return this.tools.size;
  }
}
