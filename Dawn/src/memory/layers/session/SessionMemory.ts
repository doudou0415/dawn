/**
 * SessionMemory — 短期会话记忆（内存驻留）
 *
 * 特征：
 * - 纯内存，不写磁盘
 * - 滑动窗口机制（固定容量，超限自动丢弃最老）
 * - 重要性打分：每次访问增加重要性，新条目初始权重高
 * - 当容量超限且需要丢弃时，优先丢弃重要性最低的条目
 */

import type { StoredEntry } from '../../store/MemoryStore.js';
import { calculateImportance } from '../../compressor/ForgettingStrategy.js';

export interface SessionMemoryConfig {
  maxSize: number;
  /** 低于此重要性的条目优先被淘汰（0-1） */
  evictionThreshold: number;
}

export class SessionMemory {
  private entries: StoredEntry[] = [];
  private config: SessionMemoryConfig;

  constructor(maxSize = 200) {
    this.config = {
      maxSize,
      evictionThreshold: 0.2,
    };
  }

  configure(config: Partial<SessionMemoryConfig>): void {
    Object.assign(this.config, config);
  }

  async store(
    key: string,
    value: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<StoredEntry> {
    // 如果 key 已存在，更新而非追加（滑动窗口更新）
    const existingIdx = this.entries.findIndex(e => e.key === key);
    if (existingIdx !== -1) {
      const existing = this.entries[existingIdx]!;
      existing.value = value;
      existing.metadata = { ...existing.metadata, ...metadata };
      existing.lastAccessed = Date.now();
      existing.accessCount++;
      this.entries.splice(existingIdx, 1);
      this.entries.push(existing);
      return existing;
    }

    const entry: StoredEntry = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      key,
      value,
      metadata: { ...metadata, importance: 1.0 },
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    this.entries.push(entry);

    // 滑动窗口：超限时智能淘汰（保留高重要性）
    if (this.entries.length > this.config.maxSize) {
      this.evict();
    }

    return entry;
  }

  async query(text?: string, limit = 10): Promise<StoredEntry[]> {
    let results = this.entries;
    if (text) {
      const keywords = this.extractKeywords(text);
      const scored = results.map(e => ({
        entry: e,
        score: this.scoreRelevance(e, keywords),
      }));
      results = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.entry);
    }
    return results.slice(0, limit);
  }

  /** 按重要性查询（用于遗忘决策） */
  queryByImportance(limit = 10): StoredEntry[] {
    return [...this.entries]
      .map(e => ({ entry: e, importance: calculateImportance(e) }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
      .map(s => s.entry);
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  getAll(): StoredEntry[] {
    return [...this.entries];
  }

  count(): number {
    return this.entries.length;
  }

  /** 更新条目的重要性评分（元数据中的 importance 字段） */
  updateImportance(key: string, delta: number): void {
    for (const e of this.entries) {
      if (e.key === key) {
        const current = (e.metadata?.importance as number) ?? 0.5;
        e.metadata = { ...e.metadata, importance: Math.min(1, Math.max(0, current + delta)) };
        e.accessCount++;
        e.lastAccessed = Date.now();
        break;
      }
    }
  }

  // ── 私有方法 ──

  /** 智能淘汰：优先丢弃重要性最低的条目 */
  private evict(): void {
    const over = this.entries.length - this.config.maxSize;
    if (over <= 0) return;

    const scored = this.entries.map(e => ({
      entry: e,
      importance: calculateImportance(e),
    }));

    // 按重要性升序排列，取最低的 over 条淘汰
    scored.sort((a, b) => a.importance - b.importance);

    const toRemove = new Set(scored.slice(0, over).map(s => s.entry.id));
    this.entries = this.entries.filter(e => !toRemove.has(e.id));
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不',
      '人', '都', '一', '一个', '上', '也', '很', '到', '说',
      '要', '去', '你', '会', '着', '没有', '看', '好', '自己',
      '这', '他', '她', '它', '们', '那', '些', '吗', '吧',
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    ]);
    return text
      .split(/[\s,，。；;：:、！!？?()（）\[\]【】{}"'"\/\\|_\-+=*&^%$#@~`]/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  private scoreRelevance(entry: StoredEntry, keywords: string[]): number {
    const lower = JSON.stringify({
      key: entry.key,
      value: entry.value,
      metadata: entry.metadata,
    }).toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    // 加上重要性加权
    const importance = (entry.metadata?.importance as number) ?? 0.5;
    score *= 0.5 + importance * 0.5;
    return score;
  }
}

export type { StoredEntry };
