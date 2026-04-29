/**
 * CodeOptimizer — 代码优化器（P2 重构：从 ExecutionLoop 提取）
 *
 * 负责：
 * - 代码静态分析与优化（var→const/let、==→===、空 catch 移除）
 * - 返回优化后的代码文本
 */

export interface OptimizationResult {
  code: string;
  changes: string[];
  score: number;
}

export class CodeOptimizer {
  /**
   * 优化代码文本，应用常见静态优化规则
   */
  optimize(code: string, _task?: string): OptimizationResult {
    const lines = code.split('\n');
    const optimized: string[] = [];
    const changes: string[] = [];
    let hasChange = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine: string = lines[i] ?? '';
      let line = rawLine;

      // 1. var -> const/let
      const varMatch = line.match(/^(\s*)var\s+/);
      if (varMatch) {
        const varName = line.replace(/var\s+/, '').match(/^(\w+)/);
        const isReassigned = code.includes(`${varName?.[1]} =`);
        optimized.push(
          line.replace(/^(\s*)var\s+/, `$1${isReassigned ? 'let' : 'const'} `),
        );
        if (!hasChange) {
          hasChange = true;
          changes.push('var -> const/let');
        }
        continue;
      }

      // 2. 双等号 -> 三等号
      line = line.replace(/==(?!=)/g, '===');
      if (line !== rawLine && line.includes('===')) {
        if (!changes.includes('== -> ===')) changes.push('== -> ===');
        hasChange = true;
      }

      // 3. 移除空的 catch(e) {}
      if (/catch\s*\(.*?\)\s*\{/.test(line) && lines[i + 1]?.trim() === '}') {
        const indent = line.match(/^\s*/)?.[0] || '';
        optimized.push(`${indent}// 已移除空的 catch`);
        i++;
        if (!hasChange) {
          hasChange = true;
          changes.push('移除空 catch');
        }
        continue;
      }

      optimized.push(line);
    }

    const result = optimized.join('\n');
    const score = this.scoreCode(result);

    if (hasChange) {
      return {
        code: result + '\n\n// 已应用的优化：\n' + changes.map((c) => `// - ${c}`).join('\n'),
        changes,
        score,
      };
    }

    return { code: result, changes: [], score };
  }

  /**
   * 对代码进行质量评分（基于简单静态规则）
   */
  private scoreCode(code: string): number {
    const lines = code.split('\n');
    let score = 100;
    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i] ?? '';
      if (line.includes('as any') || line.match(/: any\b/)) score -= 5;
      if (line.includes('console.log')) score -= 2;
      if (line.match(/catch\s*\(/i) && line.includes('{}')) score -= 5;
      if (line.length > 120) score -= 1;
      if (line.match(/\bvar\s+/)) score -= 5;
      if (line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) score -= 3;
    }
    return Math.max(0, score);
  }

  /**
   * 生成代码审查报告
   */
  review(code: string): { score: number; issues: Array<{ severity: string; message: string }> } {
    const issues: Array<{ severity: string; message: string }> = [];
    const lines = code.split('\n');
    let score = 100;
    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i] ?? '';
      const lineNum = i + 1;
      if (line.includes('as any') || line.match(/: any\b/)) {
        issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 使用了 any 类型` });
        score -= 5;
      }
      if (line.includes('console.log')) {
        issues.push({ severity: 'info', message: `第 ${lineNum} 行: console.log 残留` });
        score -= 2;
      }
      if (line.match(/catch\s*\(/i) && line.includes('{}')) {
        issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 空的 catch 块` });
        score -= 5;
      }
      if (line.length > 120) {
        issues.push({ severity: 'info', message: `第 ${lineNum} 行: 行过长 (${line.length} 字符)` });
        score -= 1;
      }
      if (line.match(/\bvar\s+/)) {
        issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 使用了 var` });
        score -= 5;
      }
      if (line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) {
        issues.push({ severity: 'info', message: `第 ${lineNum} 行: 未完成的标记` });
        score -= 3;
      }
    }
    return { score: Math.max(0, score), issues };
  }
}

/** 单例导出，便于直接引用 */
export const codeOptimizer = new CodeOptimizer();

/** SmartCodeReviewer 后向兼容别名（review 签名对齐） */
export const SmartCodeReviewer = { review: (code: string) => codeOptimizer.review(code) };
