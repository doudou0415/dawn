/**
 * HybridRetriever — 多路检索器
 *
 * 组合多种检索策略：
 * - 关键词匹配（基础文本检索）
 * - 时间衰减排序（最新优先 + 老化降权）
 * - 重要性评分排序
 * - **跨层检索**（同时在 session / persistent / skill 中查）
 * - **向量语义检索**（可选，通过 VectorRetriever 集成）
 *
 * 移植自 Dawn 本体架构亮点：向量语义搜索能力。
 *
 * @see VectorRetriever — Ollama embedding + cosine 相似度
 */

import { getLogger } from '@dawn/core';
const logger = getLogger('HybridRetriever');
import type { StoredEntry, IMemoryStore } from '../store/MemoryStore.js';
import { VectorRetriever, isVectorSearchEnabled } from './VectorRetriever.js';

export interface RetrievalOptions {
  /** 检索文本 */
  text?: string;
  /** 最大返回数 */
  limit?: number;
  /** 是否偏向最新 */
  preferRecent?: boolean;
  /** 是否偏向高重要性 */
  preferImportant?: boolean;
  /** 时间衰减天数 */
  timeDecayDays?: number;
  /** 跨层检索：指定要查的层 */
  layers?: Array<'session' | 'persistent' | 'skill'>;
  /** 最低匹配分数 */
  minScore?: number;
  /** 是否启用向量语义检索（需 VECTOR_SEARCH_ENABLED=true） */
  useVectorSearch?: boolean;
}

export interface RetrievalResult {
  entries: StoredEntry[];
  strategy: string;
  totalScore: number;
  /** 各层统计 */
  layerStats: Record<string, number>;
}

export class HybridRetriever {
  private stores: IMemoryStore[];
  private sessionMem?: SessionMemory;
  private persistentMem?: PersistentMemory;
  private skillMem?: SkillMemory;
  private vectorRetriever?: VectorRetriever;

  // LRU 缓存：避免短时间内重复检索
  private cache = new Map<string, { result: RetrievalResult; time: number }>();
  private readonly CACHE_TTL = 5000; // 5 秒
  private readonly CACHE_MAX = 50;

  constructor(...stores: IMemoryStore[]) {
    this.stores = stores;
    if (isVectorSearchEnabled()) {
      this.vectorRetriever = new VectorRetriever();
    }
  }

  /** 生成缓存键 */
  private cacheKey(options: RetrievalOptions): string {
    return JSON.stringify(options);
  }

  /** 读取缓存 */
  private getCached(options: RetrievalOptions): RetrievalResult | null {
    const key = this.cacheKey(options);
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.time > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    // LRU：移到末尾
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.result;
  }

  /** 写入缓存 */
  private setCached(options: RetrievalOptions, result: RetrievalResult): void {
    const key = this.cacheKey(options);
    this.cache.delete(key); // ensure LRU order
    if (this.cache.size >= this.CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, time: Date.now() });
  }

  /**
   * 绑定三层记忆实例（支持跨层检索）
   */
  bindLayers(
    session: SessionMemory,
    persistent: PersistentMemory,
    skill: SkillMemory,
  ): void {
    this.sessionMem = session;
    this.persistentMem = persistent;
    this.skillMem = skill;
  }

  /**
   * 设置或替换向量检索器（外部注入，优先于构造函数自动初始化）
   */
  setVectorRetriever(retriever: VectorRetriever): void {
    this.vectorRetriever = retriever;
  }

  /**
   * 多路检索：关键词匹配 + 时间衰减 + 重要性 + 跨层
   */
  async retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
    // 尝试命中 LRU 缓存
    const cached = this.getCached(options);
    if (cached) return cached;

    const {
      text,
      limit = 10,
      preferRecent = false,
      preferImportant = false,
      timeDecayDays = 30,
      layers,
      minScore = 0,
    } = options;

    const layerStats: Record<string, number> = {};

    // ── 跨层检索 ──
    if (layers && layers.length > 0 && this.sessionMem && this.persistentMem && this.skillMem) {
      const result = await this.crossLayerRetrieve(layers, text, limit, minScore, preferRecent, preferImportant, timeDecayDays);
      this.setCached(options, result);
      return result;
    }

    // ── 传统 store 检索 ──
    let allEntries: StoredEntry[] = [];
    for (const store of this.stores) {
      const storeName = (store as any).constructor?.name || 'unknown';
      const results = text
        ? await store.search(text, limit * 2)
        : await store.getAll();
      layerStats[storeName] = results.length;
      allEntries = allEntries.concat(results);
    }

    if (allEntries.length === 0) {
      return { entries: [], strategy: 'no_results', totalScore: 0, layerStats };
    }

    // 去重
    const unique = this.deduplicate(allEntries);

    // 评分排序
    const scored = this.scoreEntries(unique, text, preferRecent, preferImportant, timeDecayDays);
    scored.sort((a, b) => b.score - a.score);

    // 按 minScore 过滤
    const filtered = minScore > 0 ? scored.filter(s => s.score >= minScore) : scored;

    const strategies: string[] = [];
    if (text) strategies.push('keyword');
    if (preferRecent) strategies.push('time_decay');
    if (preferImportant) strategies.push('importance');

    // ── 向量语义检索增强 ──
    // 在传统检索结果上，使用向量语义搜索重排序，
    // 语义分数 + 原始分数加权合并
    if (options.useVectorSearch && this.vectorRetriever && text && scored.length > 0) {
      try {
        const vectorResults = await this.vectorRetriever.search(text, unique, { limit, minScore: 0.3 });
        if (vectorResults.length > 0) {
          strategies.push('vector_semantic');
          // 构建语义分数字典
          const semanticScores = new Map<string, number>();
          for (const vr of vectorResults) {
            semanticScores.set(vr.entry.id, vr.score);
          }
          // 加权合并：语义分 40% + 传统分 60%
          for (const s of scored) {
            const semScore = semanticScores.get(s.entry.id) ?? 0;
            s.score = s.score * 0.6 + semScore * 0.4 * 10;
          }
          // 重新排序
          scored.sort((a, b) => b.score - a.score);
        }
      } catch (err) {
        logger.warn('[HybridRetriever] 向量检索异常，回退到传统检索: ' + String(err));
      }
    }

    const result: RetrievalResult = {
      entries: filtered.slice(0, limit).map(s => s.entry),
      strategy: strategies.join('+') || 'default',
      totalScore: scored.reduce((sum, s) => sum + s.score, 0),
      layerStats,
    };
    this.setCached(options, result);
    return result;
  }

  // ── 跨层检索 ──

  private async crossLayerRetrieve(
    layers: Array<'session' | 'persistent' | 'skill'>,
    text?: string,
    limit = 10,
    minScore = 0,
    preferRecent = false,
    preferImportant = false,
    timeDecayDays = 30,
  ): Promise<RetrievalResult> {
    const results: StoredEntry[] = [];
    const layerStats: Record<string, number> = {};
    const maxPerLayer = Math.ceil(limit * 1.5);

    for (const layer of layers) {
      let layerResults: StoredEntry[] = [];
      switch (layer) {
        case 'session':
          layerResults = await this.sessionMem!.query(text, maxPerLayer);
          layerStats.session = layerResults.length;
          break;
        case 'persistent':
          layerResults = await this.persistentMem!.query(text, maxPerLayer);
          layerStats.persistent = layerResults.length;
          break;
        case 'skill':
          layerResults = await this.skillMem!.query(text, maxPerLayer);
          layerStats.skill = layerResults.length;
          break;
      }
      results.push(...layerResults);
    }

    if (results.length === 0) {
      return { entries: [], strategy: 'cross_layer:no_results', totalScore: 0, layerStats };
    }

    const unique = this.deduplicate(results);
    const scored = this.scoreEntries(unique, text, preferRecent, preferImportant, timeDecayDays);
    scored.sort((a, b) => b.score - a.score);
    const filtered = minScore > 0 ? scored.filter(s => s.score >= minScore) : scored;

    const layerTag = layers.join('+');
    return {
      entries: filtered.slice(0, limit).map(s => s.entry),
      strategy: `cross_layer:${layerTag}`,
      totalScore: scored.reduce((sum, s) => sum + s.score, 0),
      layerStats,
    };
  }

  // ── 评分引擎 ──

  private scoreEntries(
    entries: StoredEntry[],
    text?: string,
    preferRecent?: boolean,
    preferImportant?: boolean,
    timeDecayDays?: number,
  ): Array<{ entry: StoredEntry; score: number }> {
    const now = Date.now();
    const decayMs = (timeDecayDays ?? 30) * 86400000;

    return entries.map(e => {
      let score = 0;

      // 文本匹配
      if (text) {
        const searchable = JSON.stringify({
          key: e.key,
          value: e.value,
        }).toLowerCase();
        if (searchable.includes(text.toLowerCase())) score += 10;
      }

      // 新近度
      if (preferRecent) {
        const age = now - e.timestamp;
        score += Math.max(0, 10 - (age / decayMs) * 10);
      }

      // 重要性
      if (preferImportant) {
        score += calculateImportance(e) * 10;
      }

      // 默认基础分（确保有文本时也有排序依据）
      if (!text && !preferRecent && !preferImportant) {
        score = e.timestamp / Date.now(); // 最新优先
      }

      return { entry: e, score };
    });
  }

  // ── 工具方法 ──

  private deduplicate(entries: StoredEntry[]): StoredEntry[] {
    const seen = new Set<string>();
    const unique: StoredEntry[] = [];
    for (const e of entries) {
      const key = `${e.key}::${e.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(e);
      }
    }
    return unique;
  }
}
