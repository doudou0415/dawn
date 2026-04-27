/**
 * CodeReviewCapability — 代码审查原子能力
 * 包装 CodeReviewEngine 为 AtomicCapability 接口。
 */
import type { AtomicCapability, CapabilityInput } from '@dawn/core';
import type { CapabilityResult } from '../../registry/types.js';
import { CodeReviewEngine } from './CodeReview.js';

export class CodeReviewCapability implements AtomicCapability {
  readonly name = 'code_review';
  readonly description = '代码审查：检查安全、性能、最佳实践问题';
  readonly intentTypes = ['code_review'] as any;
  readonly permissions = ['fs:read'];

  private engine = new CodeReviewEngine();

  async execute(input: CapabilityInput): Promise<CapabilityResult> {
    const rawInput = (input as any).rawInput || '';
    const memory = (input as any).memory;

    // 尝试从输入中提取文件路径
    const fileMatch = rawInput.match(/(?:review|审查|检查)\s+([^\s]+\.(?:ts|tsx|js|jsx))/i);
    const filePath = fileMatch?.[1];

    if (filePath) {
      const issues = await this.engine.reviewFile(filePath);
      return {
        success: true,
        output: this.engine.generateReport(issues),
        metadata: { filePath, issues },
        permissionsUsed: ['fs:read'],
      };
    }

    // 无具体文件时，尝试从记忆上下文获取
    if (memory?.currentFile) {
      const issues = await this.engine.reviewFile(memory.currentFile as string);
      return {
        success: true,
        output: this.engine.generateReport(issues),
        metadata: { filePath: memory.currentFile, issues },
        permissionsUsed: ['fs:read'],
      };
    }

    return {
      success: true,
      output: '请指定要审查的文件路径，例如：review src/file.ts',
      metadata: { type: 'prompt' },
    };
  }
}
