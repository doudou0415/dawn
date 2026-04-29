/**
 * PersistentMemory — 长时持久化记忆
 *
 * 特征：
 * - 基于 JsonFileStore，每次操作自动落盘
 * - 支持关键词检索、TTL 过期过滤
 * - **向量嵌入存根**：为后续接入真正向量数据库（如 Chroma、LanceDB）预留接口
 * - 支持重要性评分维护（老化衰减 + 访问提升）
 */

import { getLogger } from '@dawn/core';
const logger = getLogger('PersistentMemory');
import { JsonFileStore, type StoredEntry } from '../../store/MemoryStore.js';

export interface EmbeddingResult {
  vector: number[];
  dimension: number;
}

export interface PersistentMemoryConfig {
  maxEntries: number;
  /** 是否启用向量嵌入（默认 false，需外部提供嵌入函数） */
  enableEmbedding: boolean;
  /** 嵌入维度 */
  embeddingDimension: number;
}

export class PersistentMemory {
  private fileStore: JsonFileStore;
  private config: PersistentMemoryConfig;

  /** 外部的嵌入函数（由上层注入，如 OpenAI / local embedding） */
  public embedFunction: ((text: string) => Promise<EmbeddingResult>) | null = null;

  constructor(basePath: string, maxEntries = 500) {
    this.config = {
      maxEntries,
      enableEmbedding: false,
      embeddingDimension: 384,
    };
    this.fileStore = new JsonFileStore(
      `${basePath}/.dawn-memory/persistent.json`,
      maxEntries,
    );
  }

  configure(config: Partial<PersistentMemoryConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 存储记忆（可选同时生成向量嵌入）
   */
  async store(
    key: string,
    value: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<StoredEntry> {
    const entry = await this.fileStore.save({
      key,
      value,
      metadata,
      accessCount: 0,
      lastAccessed: Date.now(),
    });

    // 如果启用了嵌入且有嵌入函数，异步生成向量
    if (this.config.enableEmbedding && this.embedFunction) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      this.embedFunction(text).catch(err =>
        logger.warn('[PersistentMemory] Embedding failed:', err),
      );
    }

    return entry;
  }

  async query(text?: string, limit = 20): Promise<StoredEntry[]> {
    if (!text) return this.fileStore.getAll().then(e => e.slice(-limit));
    return this.fileStore.search(text, limit);
  }

  async findByKey(key: string): Promise<StoredEntry | null> {
    const results = await this.fileStore.findByKeyPrefix(key);
    return results.find(e => e.key === key) ?? results[0] ?? null;
  }

  async getAll(): Promise<StoredEntry[]> {
    return this.fileStore.getAll();
  }

  async delete(id: string): Promise<boolean> {
    return this.fileStore.delete(id);
  }

  async getPreference(key: string): Promise<string | null> {
    const results = await this.fileStore.findByKeyPrefix(`pref_${key}`);
    for (const r of results) {
      if (r.key === `pref_${key}`) return String(r.value);
    }
    return null;
  }

  async getAllPreferences(): Promise<Record<string, string>> {
    const all = await this.fileStore.getAll();
    const prefs: Record<string, string> = {};
    for (const e of all) {
      if (e.key.startsWith('pref_')) {
        prefs[e.key.replace('pref_', '')] = String(e.value);
      }
    }
    return prefs;
  }

  async savePreference(key: string, value: string): Promise<void> {
    await this.fileStore.save({
      key: `pref_${key}`,
      value,
      metadata: { type: 'user_preference', updatedAt: Date.now() },
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  /**
   * 按重要性排序获取条目（为遗忘策略准备）
   */
  async getAllWithImportance(): Promise<
    Array<{ entry: StoredEntry; importance: number }>
  > {
    const all = await this.getAll();
    return all
      .map(e => ({ entry: e, importance: calculateImportance(e) }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * 向量检索存根（后续接入真实向量数据库后实现）
   */
  async vectorSearch(
    _text: string,
    _limit = 10,
  ): Promise<StoredEntry[]> {
    if (!this.config.enableEmbedding) {
      // 未启用嵌入时降级为关键词检索
      return this.query(_text, _limit);
    }
    // 存根：后续实现
    logger.warn('[PersistentMemory] vectorSearch not yet implemented, falling back to keyword');
    return this.query(_text, _limit);
  }
}
