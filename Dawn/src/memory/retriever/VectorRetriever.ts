/**
 * VectorRetriever — 向量语义检索器
 *
 * 移植自 Dawn 本体 src/utils/vector/ 的向量检索能力：
 *   - embedding.ts（Ollama 嵌入）
 *   - vectorSearch.ts（余弦相似度搜索）
 *   - vectorIndexer.ts（智能分块）
 *
 * 适配 Dawn 的 StoredEntry 接口，作为 HybridRetriever 的可选扩展策略。
 *
 * 环境变量控制：
 *   VECTOR_SEARCH_ENABLED=true       — 开启向量检索
 *   OLLAMA_HOST=http://localhost:11434 — Ollama 服务地址
 *   OLLAMA_EMBED_MODEL=nomic-embed-text — 嵌入模型
 */

import type { StoredEntry } from '../store/MemoryStore.js';
import { logger } from '../../utils/index.js';

// ── 类型定义 ──

export interface VectorSearchOptions {
  /** 最大返回数 */
  limit?: number;
  /** 最低相似度分数 (0-1) */
  minScore?: number;
}

export interface VectorSearchResult {
  entry: StoredEntry;
  score: number;
}

// ── 全局开关 ──

export function isVectorSearchEnabled(): boolean {
  return process.env.VECTOR_SEARCH_ENABLED === 'true';
}

// ── Embedding 客户端 ──

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

/**
 * 将文本转换为向量（调用 Ollama embedding API）
 */
async function embed(text: string): Promise<number[]> {
  if (!isVectorSearchEnabled()) return [];

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: text.length > 1500 ? text.slice(0, 1500) : text,
      }),
    });

    if (!response.ok) {
      logger.warn(`[VectorRetriever] Ollama 请求失败 (${response.status})`);
      return [];
    }

    const data = await response.json() as { embedding?: number[] };
    if (data.embedding && Array.isArray(data.embedding)) {
      return data.embedding;
    }
    logger.warn('[VectorRetriever] Ollama 返回格式异常');
    return [];
  } catch (error) {
    logger.warn('[VectorRetriever] Ollama 连接失败，请确认服务是否运行:', error);
    return [];
  }
}

// ── 相似度计算 ──

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── 向量缓存 ──

/**
 * 内存中的向量缓存，避免对同一内容重复调用 Ollama。
 * 结构: Map<缓存键, 向量数组>
 */
const vectorCache = new Map<string, number[]>();
const VECTOR_CACHE_MAX = 500;

/** 对 StoredEntry 的 value 生成可嵌入文本 */
function entryToText(entry: StoredEntry): string {
  const valueStr = typeof entry.value === 'object'
    ? JSON.stringify(entry.value)
    : String(entry.value);
  return `${entry.key}: ${valueStr}`;
}

/** 生成缓存键 */
function cacheKey(entry: StoredEntry): string {
  return `${entry.id}::${entry.timestamp}`;
}

// ── VectorRetriever ──

export class VectorRetriever {
  /**
   * 向量语义检索入口。
   * 对查询文本进行 embedding，然后在候选条目中查找语义最相似的。
   */
  async search(
    query: string,
    candidates: StoredEntry[],
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const { limit = 10, minScore = 0.3 } = options;

    if (!isVectorSearchEnabled() || candidates.length === 0) {
      return [];
    }

    // 1. 查询转向量
    const queryVector = await embed(query);
    if (queryVector.length === 0) return [];

    // 2. 对每个候选条目，获取或缓存向量
    const scored: VectorSearchResult[] = [];

    for (const entry of candidates) {
      const ck = cacheKey(entry);
      let vec = vectorCache.get(ck);

      if (!vec) {
        vec = await embed(entryToText(entry));
        if (vec.length > 0) {
          // LRU 淘汰
          if (vectorCache.size >= VECTOR_CACHE_MAX) {
            const firstKey = vectorCache.keys().next().value;
            if (firstKey) vectorCache.delete(firstKey);
          }
          vectorCache.set(ck, vec);
        }
      }

      if (vec.length > 0) {
        const score = cosineSimilarity(queryVector, vec);
        if (score >= minScore) {
          scored.push({ entry, score });
        }
      }
    }

    // 3. 按分数排序返回
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** 检查向量搜索是否可用（Ollama 服务是否可达） */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** 清空向量缓存 */
  clearCache(): void {
    vectorCache.clear();
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; maxSize: number } {
    return { size: vectorCache.size, maxSize: VECTOR_CACHE_MAX };
  }
}
