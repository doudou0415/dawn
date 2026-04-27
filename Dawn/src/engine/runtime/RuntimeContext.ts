import type { AgentConfig, OrchestratorConfig } from '../../../packages/core/src/types.js';
import type { MemorySystem } from '../../memory/MemorySystem.js';

export interface RuntimeOptions {
  sessionId?: string;
  allowedDirectories?: string[];
  maxExecutionTimeMs?: number;
  /** 注入 MemorySystem 引用 */
  memorySystem?: MemorySystem;
}

export interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  averageDurationMs: number;
}

export class RuntimeContext {
  public readonly sessionId: string;
  public readonly startTime: Date;
  public readonly allowedDirectories: string[];
  public readonly maxExecutionTimeMs: number;
  /** 持有 MemorySystem 引用（通过外部注入） */
  public readonly memorySystem?: MemorySystem;

  private executionCount = 0;
  private successCount = 0;
  private totalDurationMs = 0;

  constructor(options: RuntimeOptions = {}) {
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.startTime = new Date();
    this.allowedDirectories = options.allowedDirectories || [];
    this.maxExecutionTimeMs = options.maxExecutionTimeMs || 30000;
    this.memorySystem = options.memorySystem;
  }

  /** 检查路径是否在白名单内 */
  isPathAllowed(targetPath: string): boolean {
    if (this.allowedDirectories.length === 0) return true;
    const normalized = targetPath.replace(/\\/g, '/');
    return this.allowedDirectories.some(dir =>
      normalized.startsWith(dir.replace(/\\/g, '/')),
    );
  }

  /** 记录一次执行（同时写入记忆系统） */
  recordExecution(durationMs: number, success: boolean): void {
    this.executionCount++;
    if (success) this.successCount++;
    this.totalDurationMs += durationMs;
  }

  /** 获取执行统计 */
  getStats(): ExecutionStats {
    return {
      totalExecutions: this.executionCount,
      successfulExecutions: this.successCount,
      averageDurationMs: this.executionCount > 0
        ? Math.round(this.totalDurationMs / this.executionCount)
        : 0,
    };
  }

  /** 检查是否超过最大执行时间 */
  isExecutionTimeExceeded(startTime: number): boolean {
    return Date.now() - startTime > this.maxExecutionTimeMs;
  }

  /** 获取会话运行时间（毫秒） */
  getUptimeMs(): number {
    return Date.now() - this.startTime.getTime();
  }
}
