/**
 * MemoryCompressor — 记忆压缩器
 *
 * 职责：
 * - 按主题聚类记忆
 * - 压缩内容（智能截断 + 摘要生成）
 * - **集成分级遗忘策略**（ForgettingStrategy）
 * - 支持自定义压缩策略
 *
 * 集成方式：上层调用 compressAndForget() 即可同时完成压缩和遗忘。
 */

import type { StoredEntry } from '../store/MemoryStore.js';
import {
  ForgettingLevel,
  calculateImportance,
  applyForgetting,
} from './ForgettingStrategy.js';
import type { ForgettingConfig, ForgettingResult } from './ForgettingStrategy.js';

export interface CompressedEntry {
  id: string;
  key: string;
  summary: string;
  originalCount: number;
  importance: number;
}

export interface CompressAndForgetResult {
  compressed: CompressedEntry[];
  forgotten: ForgettingResult;
}

export const DEFAULT_FORGETTING_CONFIGS: Record<ForgettingLevel, ForgettingConfig> = {
  [ForgettingLevel.SHORT_TERM]: {
    level: ForgettingLevel.SHORT_TERM,
    maxEntries: 200,
    importanceThreshold: 0,
    decayDays: 0,
  },
  [ForgettingLevel.MEDIUM_TERM]: {
    level: ForgettingLevel.MEDIUM_TERM,
    maxEntries: 100,
    importanceThreshold: 0.2,
    decayDays: 7,
  },
  [ForgettingLevel.LONG_TERM]: {
    level: ForgettingLevel.LONG_TERM,
    maxEntries: 50,
    importanceThreshold: 0.4,
    decayDays: 30,
  },
};

export class MemoryCompressor {
  /**
   * 压缩 + 遗忘一站式处理
   * 1. 先应用遗忘策略过滤
   * 2. 对保留的条目做聚类压缩
   */
  async compressAndForget(
    entries: StoredEntry[],
    config: ForgettingConfig,
  ): Promise<CompressAndForgetResult> {
    // Step 1: 遗忘
    const { kept, result: forgotten } = applyForgetting(entries, config);

    // Step 2: 对保留的压缩
    const compressed = await this.compress(kept);

    return { compressed, forgotten };
  }

  /**
   * 压缩一批条目为摘要
   */
  async compress(entries: StoredEntry[]): Promise<CompressedEntry[]> {
    if (entries.length === 0) return [];
    if (entries.length <= 10) {
      return entries.map(e => ({
        id: e.id,
        key: e.key,
        summary:
          typeof e.value === 'string'
            ? this.compressContent(e.value, 200)
            : JSON.stringify(e.value).slice(0, 200),
        originalCount: 1,
        importance: calculateImportance(e),
      }));
    }

    // 按 key 前缀聚类
    const groups = new Map<string, StoredEntry[]>();
    for (const entry of entries) {
      const prefix = entry.key.split('_')[0] || 'other';
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix)!.push(entry);
    }

    const result: CompressedEntry[] = [];
    for (const [prefix, group] of groups) {
      const lastEntry = group[group.length - 1]!;
      const totalImportance = group.reduce(
        (sum, e) => sum + calculateImportance(e),
        0,
      );
      const summary = `[${prefix}] ${group.length} 条记录，最近: ${new Date(lastEntry.timestamp).toISOString().slice(0, 10)}`;
      result.push({
        id: `compressed_${prefix}_${Date.now()}`,
        key: prefix,
        summary,
        originalCount: group.length,
        importance: totalImportance / group.length,
      });
    }

    return result.sort((a, b) => b.originalCount - a.originalCount);
  }

  /**
   * 压缩单条内容
   */
  compressContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    const sentences = content.split(/[.!?。！？]/);
    let compressed = '';
    for (const sentence of sentences) {
      if ((compressed + sentence).length > maxLength) break;
      compressed += sentence + '.';
    }
    if (compressed.length < maxLength * 0.3) {
      compressed = content.substring(0, maxLength - 3) + '...';
    }
    return compressed;
  }

  /**
   * 按层获取默认遗忘配置
   */
  getDefaultConfig(level: ForgettingLevel): ForgettingConfig {
    return { ...DEFAULT_FORGETTING_CONFIGS[level] };
  }
}
