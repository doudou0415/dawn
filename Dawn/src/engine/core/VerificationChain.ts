/**
 * VerificationChain — 执行验证链（P2 重构：从 ExecutionLoop 提取）
 *
 * 负责：
 * - 代码预检验证（格式、语法级检查）
 * - 执行结果验证
 * - 作为独立可注入模块供 ExecutionLoop 使用
 */

import { codeOptimizer } from './CodeOptimizer.js';

export interface VerificationResult {
  passed: boolean;
  score: number;
  issues: Array<{ severity: string; message: string }>;
  details?: string;
}

export class VerificationChain {
  /**
   * 执行完整的验证链：审查代码并返回结果
   */
  verify(code: string, _context?: string): VerificationResult {
    const { score, issues } = codeOptimizer.review(code);

    return {
      passed: score >= 60,
      score,
      issues,
      details: issues.length > 0
        ? issues.map((i) => `[${i.severity}] ${i.message}`).join('\n')
        : '审查通过',
    };
  }

  /**
   * 预检验证：在代码执行/生成前做快速检查
   */
  preVerify(code: string): { canProceed: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i] ?? '';
      if (line.match(/\/\/\s*(TODO|FIXME|HACK)/i)) {
        warnings.push(`第 ${i + 1} 行: 包含未完成标记`);
      }
    }

    return { canProceed: warnings.length < 5, warnings };
  }

  /**
   * 执行结果验证
   */
  validateResult(result: string, expected?: string): { match: boolean; confidence: number } {
    if (!expected) {
      return { match: true, confidence: 0.5 };
    }

    const normalizedResult = result.trim().toLowerCase();
    const normalizedExpected = expected.trim().toLowerCase();

    // 简单字符串匹配（后续可升级为语义匹配）
    const exactMatch = normalizedResult === normalizedExpected;
    const containsMatch = normalizedResult.includes(normalizedExpected) || normalizedExpected.includes(normalizedResult);

    if (exactMatch) return { match: true, confidence: 1.0 };
    if (containsMatch) return { match: true, confidence: 0.7 };
    return { match: false, confidence: 0 };
  }
}

/** 单例导出 */
export const verificationChain = new VerificationChain();
