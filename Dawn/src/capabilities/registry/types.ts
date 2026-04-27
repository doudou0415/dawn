import type { TaskCategory } from '@dawn/core';

/**
 * 统一原子能力输入
 */
export interface AtomicInput {
  intentType: TaskCategory;
  params: Record<string, unknown>;
  context: {
    sessionId: string;
    workingDirectory?: string;
    permissions?: string[];
  };
}

/**
 * 统一原子能力输出
 */
export interface CapabilityResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
  permissionsUsed?: string[];
  durationMs?: number;
}

/**
 * 原子能力 — 最小不可拆能力单元
 * 每个 AtomicCapability 只做一件事，做得纯粹。
 */
export interface AtomicCapability {
  readonly name: string;
  readonly description: string;
  readonly intentTypes: TaskCategory[];
  readonly permissions: string[];
  execute(input: AtomicInput): Promise<CapabilityResult>;
  validate?(input: AtomicInput): boolean;
}

/**
 * 复合能力 — 编排多个原子能力完成高阶任务
 */
export interface CompositeCapability {
  readonly name: string;
  readonly description: string;
  readonly subCapabilities: string[];
  execute(input: AtomicInput, registry: { getAtomic(name: string): AtomicCapability | undefined }): Promise<CapabilityResult>;
}
