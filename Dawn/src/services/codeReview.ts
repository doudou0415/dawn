/**
 * CodeReviewService — 代码审查 + 知识内化系统
 *
 * 移植自早期 DawnHub 原型的 codeReviewSystem.ts 核心能力：
 * - 根本原因分析（extractRootCause）
 * - 最佳实践生成（createBestPractice）
 * - 代码风险预警（checkPotentialRisks）
 * - 推荐引擎（getRecommendations）
 * - 知识持久化（文件存储）
 *
 * 保留现有 lint 检查（SmartCodeReviewer）并增强。
 */

import { getLogger } from '@dawn/core/Logger.js';
import fs from 'node:fs';
import path from 'node:path';

const log = getLogger('CodeReview');

// ================================================================
// 类型定义
// ================================================================

export interface ReviewResult {
  score: number;
  issues: Array<{ severity: string; message: string }>;
}

export interface CodeIssue {
  id: string;
  type: 'error' | 'warning' | 'suggestion';
  file: string;
  line?: number;
  description: string;
  rootCause: string;
  impact: 'high' | 'medium' | 'low';
  timestamp: Date;
}

export interface BestPractice {
  id: string;
  title: string;
  description: string;
  category: string;
  codeExample: string;
  antiPattern: string;
  tags: string[];
  createdAt: Date;
  appliedCount: number;
}

export interface KnowledgeEntry {
  id: string;
  issue: CodeIssue;
  solution: string;
  bestPractice?: BestPractice;
  learnedAt: Date;
}

export interface RiskWarning {
  risk: string;
  suggestion: string;
  bestPracticeId: string;
}

interface StorageData {
  knowledgeBase: KnowledgeEntry[];
  bestPractices: BestPractice[];
  lastUpdated: string;
}

// ================================================================
// 规则引擎：lint 检查
// ================================================================

function lintReview(code: string): ReviewResult {
  const issues: Array<{ severity: string; message: string }> = [];
  const lines = code.split('\n');
  let score = 100;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
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
    // 新增：检测 // @ts-ignore
    if (line.includes('// @ts-ignore') || line.includes('//@ts-ignore')) {
      issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 使用了 @ts-ignore` });
      score -= 4;
    }
    // 新增：检测嵌套过深（超过 4 层缩进）
    const indentLevel = (line.match(/^\s*/)?.[0]?.length ?? 0) / 2;
    if (indentLevel > 6 && line.trim().length > 0) {
      issues.push({ severity: 'info', message: `第 ${lineNum} 行: 缩进过深 (${Math.floor(indentLevel)} 层)` });
      score -= 1;
    }
  }

  return { score: Math.max(0, score), issues };
}

export const SmartCodeReviewer = { review: lintReview };

// ================================================================
// CodeReviewService — 知识内化系统
// ================================================================

export class CodeReviewService {
  private knowledgeBase: KnowledgeEntry[] = [];
  private bestPractices: BestPractice[] = [];
  private storagePath: string | null = null;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ?? null;
    this.loadFromStorage();
  }

  // ── 根本原因分析 ──

  extractRootCause(error: Error, _context?: unknown): string {
    const errorMsg = error.message.toLowerCase();

    if (errorMsg.includes('syntax') || errorMsg.includes('parse') || errorMsg.includes('unexpected token')) {
      return '语法错误：代码结构不符合语言规范';
    }
    if (errorMsg.includes('type') || errorMsg.includes('interface') || errorMsg.includes('not assignable')) {
      return '类型错误：变量类型不匹配或缺少类型定义';
    }
    if (errorMsg.includes('undefined') || errorMsg.includes('null') || errorMsg.includes('cannot read property')) {
      return '空值错误：未正确处理可能为 null/undefined 的值';
    }
    if (errorMsg.includes('permission') || errorMsg.includes('access') || errorMsg.includes('forbidden')) {
      return '权限错误：缺少必要的访问权限';
    }
    if (errorMsg.includes('memory') || errorMsg.includes('resource') || errorMsg.includes('heap')) {
      return '资源错误：内存或系统资源不足';
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      return '超时错误：操作超出时间限制';
    }
    if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('connection')) {
      return '网络错误：连接或请求失败';
    }

    return '未知错误：需要进一步分析';
  }

  // ── 记录问题并生成知识 ──

  recordIssue(issue: Omit<CodeIssue, 'id' | 'timestamp'>): KnowledgeEntry {
    const fullIssue: CodeIssue = {
      ...issue,
      id: `issue_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    const solution = this.generateSolution(fullIssue);
    const bestPractice = this.tryCreateBestPractice(fullIssue, solution);

    const knowledgeEntry: KnowledgeEntry = {
      id: `knowledge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      issue: fullIssue,
      solution,
      bestPractice,
      learnedAt: new Date(),
    };

    this.knowledgeBase.push(knowledgeEntry);
    if (bestPractice) {
      this.bestPractices.push(bestPractice);
    }

    this.saveToStorage();
    return knowledgeEntry;
  }

  // ── 从审查结果创建知识条目 ──

  recordFromReview(
    review: ReviewResult,
    filePath: string,
    code: string,
  ): KnowledgeEntry[] {
    const entries: KnowledgeEntry[] = [];

    for (const issue of review.issues) {
      const reviewIssue: Omit<CodeIssue, 'id' | 'timestamp'> = {
        type: issue.severity === 'warning' ? 'warning' : 'suggestion',
        file: filePath,
        description: issue.message,
        rootCause: this.mapSeverityToRootCause(issue.severity),
        impact: issue.severity === 'warning' ? 'medium' : 'low',
      };
      entries.push(this.recordIssue(reviewIssue));
    }

    // 检查潜在风险（基于已有最佳实践）
    const risks = this.checkPotentialRisks(code, filePath);
    for (const risk of risks) {
      const riskIssue: Omit<CodeIssue, 'id' | 'timestamp'> = {
        type: 'suggestion',
        file: filePath,
        description: risk.risk,
        rootCause: '最佳实践提醒',
        impact: 'low',
      };
      entries.push(this.recordIssue(riskIssue));
    }

    return entries;
  }

  // ── 生成解决方案 ──

  private generateSolution(issue: CodeIssue): string {
    switch (issue.rootCause) {
      case '语法错误：代码结构不符合语言规范':
        return [
          '1. 检查代码语法，确保符合语言规范',
          '2. 使用 IDE 的语法检查功能（如 tsc --noEmit）',
          '3. 参考官方文档的语法示例',
        ].join('\n');

      case '类型错误：变量类型不匹配或缺少类型定义':
        return [
          '1. 添加明确的 TypeScript 类型定义',
          '2. 使用类型守卫检查运行时类型',
          '3. 避免使用 any 类型，优先用 interface/type 定义',
        ].join('\n');

      case '空值错误：未正确处理可能为 null/undefined 的值':
        return [
          '1. 使用可选链操作符 ?.',
          '2. 使用空值合并运算符 ??',
          '3. 添加明确的空值检查守卫',
        ].join('\n');

      case '权限错误：缺少必要的访问权限':
        return [
          '1. 检查文件/目录权限设置',
          '2. 使用适当的权限管理机制',
          '3. 添加权限检查前置条件',
        ].join('\n');

      case '资源错误：内存或系统资源不足':
        return [
          '1. 优化内存使用，及时释放资源',
          '2. 使用流式处理大数据',
          '3. 添加资源使用监控',
        ].join('\n');

      case '超时错误：操作超出时间限制':
        return [
          '1. 增加超时时间配置',
          '2. 优化操作逻辑减少耗时',
          '3. 添加进度反馈机制',
        ].join('\n');

      case '网络错误：连接或请求失败':
        return [
          '1. 检查网络连接状态',
          '2. 添加重试机制（指数退避）',
          '3. 实现离线缓存或降级策略',
        ].join('\n');

      default:
        return [
          '1. 分析错误堆栈信息',
          '2. 查阅相关文档和社区',
          '3. 编写最小复现示例进行调试',
        ].join('\n');
    }
  }

  // ── 创建最佳实践 ──

  private tryCreateBestPractice(
    issue: CodeIssue,
    solution: string,
  ): BestPractice | undefined {
    const category = this.categorizeIssue(issue);

    return {
      id: `best_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: `避免${issue.rootCause.split('：')[0] ?? '常见问题'}`,
      description: `从错误中总结的最佳实践：${issue.description}`,
      category,
      codeExample: this.generateCodeExample(issue),
      antiPattern: this.describeAntiPattern(issue),
      tags: [category, issue.rootCause.split('：')[0] ?? '通用', issue.impact],
      createdAt: new Date(),
      appliedCount: 0,
    };
  }

  // ── 问题分类 ──

  private categorizeIssue(issue: CodeIssue): string {
    const rc = issue.rootCause;
    if (rc.includes('语法') || rc.includes('类型')) return '代码质量';
    if (rc.includes('空值') || rc.includes('资源') || rc.includes('超时')) return '健壮性';
    if (rc.includes('权限')) return '安全性';
    if (rc.includes('网络')) return '可靠性';
    return '通用';
  }

  // ── 生成代码示例 ──

  private generateCodeExample(issue: CodeIssue): string {
    switch (issue.rootCause) {
      case '空值错误：未正确处理可能为 null/undefined 的值':
        return [
          '// 反模式',
          "const value = data.nested.property;  // 可能崩溃",
          '',
          '// 最佳实践',
          'const value = data?.nested?.property ?? defaultValue;',
          '// 或',
          'if (data?.nested?.property !== undefined) {',
          '  const value = data.nested.property;',
          '}',
        ].join('\n');

      case '类型错误：变量类型不匹配或缺少类型定义':
        return [
          '// 反模式',
          'function process(data) {',
          '  return data.value;',
          '}',
          '',
          '// 最佳实践',
          'interface Data { value: string }',
          'function process(data: Data): string {',
          '  return data.value;',
          '}',
        ].join('\n');

      default:
        return [
          '// 解决方案',
          ...this.generateSolution(issue).split('\n').map(l => `// ${l}`),
        ].join('\n');
    }
  }

  // ── 反模式描述 ──

  private describeAntiPattern(issue: CodeIssue): string {
    return [
      `导致"${issue.rootCause}"的常见反模式：`,
      '1. 忽略错误处理',
      '2. 缺乏输入验证',
      '3. 硬编码配置',
      '4. 重复代码逻辑',
    ].join('\n');
  }

  // ── 风险预警 ──

  checkPotentialRisks(fileContent: string, _filePath: string): RiskWarning[] {
    const warnings: RiskWarning[] = [];

    // 检查空值处理（可选链但没有空值合并）
    if (fileContent.includes('?.') && !fileContent.includes('??')) {
      const related = this.bestPractices.find(
        p => p.tags.includes('空值错误') || p.title.includes('空值'),
      );
      if (related) {
        warnings.push({
          risk: '可能缺少空值回退处理',
          suggestion: '建议使用空值合并运算符 ?? 提供默认值',
          bestPracticeId: related.id,
        });
      }
    }

    // 检查宽松类型
    if (fileContent.includes(': any') || fileContent.includes('// @ts-ignore')) {
      const related = this.bestPractices.find(
        p => p.tags.includes('类型错误') || p.title.includes('类型'),
      );
      if (related) {
        warnings.push({
          risk: '使用了宽松的类型定义或忽略类型检查',
          suggestion: '建议使用具体的类型定义，避免 any 和 @ts-ignore',
          bestPracticeId: related.id,
        });
      }
    }

    // 检查 try 无 catch
    if (fileContent.includes('try {') && !fileContent.includes('.catch(')) {
      const lines = fileContent.split('\n');
      let depth = 0;
      let hasCatch = false;
      for (const line of lines) {
        if (line.includes('{')) depth++;
        if (line.includes('}')) depth--;
        if (line.includes('catch') && depth <= 1) {
          hasCatch = true;
          break;
        }
      }
      if (!hasCatch) {
        const related = this.bestPractices.find(p => p.category === '健壮性');
        if (related) {
          warnings.push({
            risk: 'try 块可能缺少对应的 catch 错误处理',
            suggestion: '建议添加完整的 try-catch 错误处理逻辑',
            bestPracticeId: related.id,
          });
        }
      }
    }

    return warnings;
  }

  // ── 推荐引擎 ──

  getRecommendations(context: string): BestPractice[] {
    const keywords = context.toLowerCase().split(/\s+/);

    return this.bestPractices
      .filter(practice => {
        const searchText = `${practice.title} ${practice.description} ${practice.tags.join(' ')}`.toLowerCase();
        return keywords.some(k => k.length > 2 && searchText.includes(k));
      })
      .sort((a, b) => b.appliedCount - a.appliedCount)
      .slice(0, 5);
  }

  // ── 应用最佳实践 ──

  applyBestPractice(practiceId: string): void {
    const practice = this.bestPractices.find(p => p.id === practiceId);
    if (practice) {
      practice.appliedCount++;
      this.saveToStorage();
    }
  }

  // ── 统计 ──

  getStats(): {
    totalIssues: number;
    totalPractices: number;
    byCategory: Record<string, number>;
    byImpact: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    const byImpact: Record<string, number> = {};

    for (const entry of this.knowledgeBase) {
      const cat = this.categorizeIssue(entry.issue);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      byImpact[entry.issue.impact] = (byImpact[entry.issue.impact] ?? 0) + 1;
    }

    return {
      totalIssues: this.knowledgeBase.length,
      totalPractices: this.bestPractices.length,
      byCategory,
      byImpact,
    };
  }

  // ── 持久化 ──

  private saveToStorage(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: StorageData = {
        knowledgeBase: this.knowledgeBase,
        bestPractices: this.bestPractices,
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      log.info(`知识库已保存到 ${this.storagePath}（${this.knowledgeBase.length} 条条目）`);
    } catch (error) {
      log.warn(`保存知识库失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private loadFromStorage(): void {
    if (!this.storagePath) return;
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const data: StorageData = JSON.parse(raw);
      this.knowledgeBase = data.knowledgeBase ?? [];
      this.bestPractices = data.bestPractices ?? [];
      log.info(`已加载知识库（${this.knowledgeBase.length} 条条目，${this.bestPractices.length} 条最佳实践）`);
    } catch (error) {
      log.warn(`加载知识库失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 强制重新加载 */
  reload(): void {
    this.loadFromStorage();
  }

  // ── 辅助 ──

  private mapSeverityToRootCause(severity: string): string {
    switch (severity) {
      case 'error': return '语法错误：代码结构不符合语言规范';
      case 'warning': return '类型错误：变量类型不匹配或缺少类型定义';
      default: return '代码质量建议';
    }
  }
}

// ================================================================
// 工具函数
// ================================================================

/**
 * 自动捕获错误并记录到知识库
 */
export function withErrorLearning<T extends (...args: unknown[]) => unknown>(
  fn: T,
  context: { file: string; function: string },
  service?: CodeReviewService,
): (...args: Parameters<T>) => ReturnType<T> {
  const reviewService = service ?? new CodeReviewService();
  return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    try {
      return fn.apply(this, args) as ReturnType<T>;
    } catch (error) {
      const issue: Omit<CodeIssue, 'id' | 'timestamp'> = {
        type: 'error',
        file: context.file,
        description: `函数 ${context.function} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
        rootCause: reviewService.extractRootCause(error as Error, { args, context }),
        impact: 'high',
      };
      reviewService.recordIssue(issue);
      throw error;
    }
  };
}

/** 创建默认单例 */
export const codeReviewService = new CodeReviewService();
