/**
 * CompactService — 上下文压缩引擎
 *
 * 移植自早期 DawnHub 原型的 autoCompact 核心思想：
 * - 阈值触发：对话历史接近上下文窗口时自动压缩
 * - LLM 摘要生成：调用 DeepSeek 生成对话摘要
 * - 摘要替换：用摘要消息替换早期对话历史
 * - 电路断路器：连续失败自动停止重试
 *
 * 差异点（适配 Dawn）：
 * - 不依赖 Claude API / Ink UI / 权限系统
 * - 使用 Dawn 已有的 callDeepSeek / MemorySystem
 * - 轻量无状态，可嵌入 ExecutionLoop 或 Coordinator
 */

import { callDeepSeek } from '../llmService.js';
import type { StoredEntry } from '../../memory/store/MemoryStore.js';

// ================================================================
// 类型定义
// ================================================================

export interface CompactConfig {
  /** 触发压缩的 token 阈值（默认 3000） */
  thresholdTokens: number;
  /** 压缩后保留的最近消息数 */
  keepRecentMessages: number;
  /** 最大连续失败次数（电路断路器） */
  maxConsecutiveFailures: number;
  /** 是否启用自动压缩 */
  enabled: boolean;
}

export interface CompactResult {
  wasCompacted: boolean;
  summary: string;
  entriesCompacted: number;
  entriesRemaining: number;
  consecutiveFailures?: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

const DEFAULT_CONFIG: CompactConfig = {
  thresholdTokens: 3000,
  keepRecentMessages: 10,
  maxConsecutiveFailures: 3,
  enabled: true,
};

// 简易 token 估算（4 chars ≈ 1 token）
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ConversationTurn[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// ================================================================
// 压缩提示词
// ================================================================

const COMPACT_SYSTEM_PROMPT = `你是一个对话摘要专家。你的任务是将一段对话历史压缩为简洁但信息完整的摘要。

要求：
1. 保留所有关键决策、技术方案和代码变更
2. 保留用户明确提出的需求和约束
3. 保留未完成的任务和待办事项
4. 保留重要的错误信息和解决方案
5. 输出纯文本，不要 Markdown 格式
6. 摘要长度控制在 300-500 字`;

const COMPACT_USER_PROMPT = (messages: string) =>
  `请压缩以下对话历史为摘要，保留关键信息：\n\n${messages}`;

// ================================================================
// 上下文压缩摘要系统提示（用于记忆系统）
// ================================================================

const MEMORY_COMPACT_SYSTEM_PROMPT = `你是一个记忆压缩专家。将多条记忆条目合并为简洁摘要。

要求：
1. 保留所有独特的关键信息
2. 消除重复内容
3. 按主题分组
4. 输出纯文本，300 字以内`;

// ================================================================
// CompactService
// ================================================================

export class CompactService {
  private config: CompactConfig;
  private consecutiveFailures = 0;

  constructor(config?: Partial<CompactConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 判断是否需要压缩
   */
  shouldCompact(messages: ConversationTurn[]): boolean {
    if (!this.config.enabled) return false;
    const tokens = estimateMessagesTokens(messages);
    return tokens >= this.config.thresholdTokens;
  }

  /**
   * 获取压缩阈值状态
   */
  getStatus(messages: ConversationTurn[]): {
    estimatedTokens: number;
    threshold: number;
    shouldCompact: boolean;
    percentUsed: number;
  } {
    const estimatedTokens = estimateMessagesTokens(messages);
    return {
      estimatedTokens,
      threshold: this.config.thresholdTokens,
      shouldCompact: estimatedTokens >= this.config.thresholdTokens,
      percentUsed: Math.round(
        (estimatedTokens / this.config.thresholdTokens) * 100,
      ),
    };
  }

  /**
   * 执行压缩 — 用 LLM 摘要替换早期对话历史
   *
   * @param messages 完整对话历史
   * @param systemPromptOverride 可选的系统提示覆盖
   * @returns 压缩结果
   */
  async compact(
    messages: ConversationTurn[],
    systemPromptOverride?: string,
  ): Promise<CompactResult> {
    // 电路断路器
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return {
        wasCompacted: false,
        summary: '',
        entriesCompacted: 0,
        entriesRemaining: messages.length,
        consecutiveFailures: this.consecutiveFailures,
      };
    }

    if (messages.length < 3) {
      return {
        wasCompacted: false,
        summary: '',
        entriesCompacted: 0,
        entriesRemaining: messages.length,
      };
    }

    const keepCount = Math.min(
      this.config.keepRecentMessages,
      messages.length - 1,
    );
    const toCompact = messages.slice(0, messages.length - keepCount);
    const toKeep = messages.slice(messages.length - keepCount);

    const compactText = toCompact
      .map(
        (m, i) =>
          `[${m.role}]${m.timestamp ? ` (${new Date(m.timestamp).toISOString()})` : ''}: ${m.content}`,
      )
      .join('\n---\n');

    try {
      const summary = await callDeepSeek([
        {
          role: 'system',
          content: systemPromptOverride || COMPACT_SYSTEM_PROMPT,
        },
        { role: 'user', content: COMPACT_USER_PROMPT(compactText) },
      ]);

      if (!summary || summary.trim().length === 0) {
        this.consecutiveFailures++;
        return {
          wasCompacted: false,
          summary: '',
          entriesCompacted: 0,
          entriesRemaining: messages.length,
          consecutiveFailures: this.consecutiveFailures,
        };
      }

      // 成功 — 重置失败计数
      this.consecutiveFailures = 0;

      return {
        wasCompacted: true,
        summary: summary.trim(),
        entriesCompacted: toCompact.length,
        entriesRemaining: toKeep.length + 1, // +1 for the summary entry
      };
    } catch (error) {
      this.consecutiveFailures++;
      return {
        wasCompacted: false,
        summary: '',
        entriesCompacted: 0,
        entriesRemaining: messages.length,
        consecutiveFailures: this.consecutiveFailures,
      };
    }
  }

  /**
   * 压缩记忆条目 — 将多条 StoredEntry 合并摘要
   */
  async compactMemoryEntries(
    entries: StoredEntry[],
  ): Promise<{ summary: string; compressed: StoredEntry[] }> {
    if (entries.length <= 5) {
      return { summary: '', compressed: entries };
    }

    const entriesText = entries
      .map(
        (e) =>
          `[${e.key}] ${JSON.stringify(e.value)} (${new Date(e.timestamp).toISOString()})`,
      )
      .join('\n');

    try {
      const summary = await callDeepSeek([
        { role: 'system', content: MEMORY_COMPACT_SYSTEM_PROMPT },
        { role: 'user', content: `压缩以下记忆条目：\n${entriesText}` },
      ]);

      if (!summary) {
        return { summary: '', compressed: entries };
      }

      return {
        summary: summary.trim(),
        compressed: [entries[entries.length - 1]!],
      };
    } catch {
      return { summary: '', compressed: entries };
    }
  }

  /**
   * 将压缩摘要整合为 ConversationTurn
   */
  createSummaryTurn(summary: string): ConversationTurn {
    return {
      role: 'system',
      content: `[对话摘要] ${summary}`,
      timestamp: Date.now(),
    };
  }

  /**
   * 将压缩结果应用到对话历史
   * 返回：摘要消息 + 保留的最近消息
   */
  applyCompaction(
    messages: ConversationTurn[],
    summary: string,
  ): ConversationTurn[] {
    if (!summary) return messages;

    const keepCount = Math.min(
      this.config.keepRecentMessages,
      messages.length - 1,
    );
    const toKeep = messages.slice(messages.length - keepCount);

    return [this.createSummaryTurn(summary), ...toKeep];
  }

  /** 重置电路断路器 */
  reset(): void {
    this.consecutiveFailures = 0;
  }

  /** 更新配置 */
  updateConfig(config: Partial<CompactConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
