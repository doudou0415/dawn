/**
 * VectorStore — 向量数据库抽象接口
 *
 * 为后续接入真正的向量数据库（如 Chroma、LanceDB、Pinecone）预留接口。
 * 当前实现为内存模拟版本，便于开发和测试。
 *
 * 核心概念：
 * - Collection: 向量集合，类似于表
 * - Embedding: 向量嵌入
 * - Index: 索引，加速相似度搜索
 *
 * 支持的操作：
 * - 创建/删除集合
 * - 添加/更新/删除向量
 * - 相似度搜索
 * - 元数据过滤
 */

import type { StoredEntry } from './MemoryStore.js';

// ── 类型定义 ──

export interface VectorEntry {
  id: string;
  vector: number[];
  content: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

export interface SearchOptions {
  /** 最大返回数 */
  limit?: number;
  /** 最低相似度分数 (0-1) */
  minScore?: number;
  /** 元数据过滤条件 */
  where?: Record<string, unknown>;
  /** 是否包含向量 */
  includeVectors?: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
  vector?: number[];
}

export interface CollectionInfo {
  name: string;
  count: number;
  dimension: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStoreConfig {
  /** 向量维度 */
  dimension: number;
  /** 默认相似度阈值 */
  defaultMinScore: number;
  /** 是否启用持久化 */
  persist: boolean;
  /** 持久化路径（仅文件型存储） */
  persistPath?: string;
}

// ── 抽象接口 ──

export abstract class VectorStore {
  protected config: VectorStoreConfig;

  constructor(config: VectorStoreConfig) {
    this.config = config;
  }

  /**
   * 创建集合
   */
  abstract createCollection(name: string, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * 删除集合
   */
  abstract deleteCollection(name: string): Promise<void>;

  /**
   * 获取集合信息
   */
  abstract getCollection(name: string): Promise<CollectionInfo | null>;

  /**
   * 列出所有集合
   */
  abstract listCollections(): Promise<CollectionInfo[]>;

  /**
   * 添加向量
   */
  abstract add(
    collection: string,
    entries: VectorEntry[],
  ): Promise<void>;

  /**
   * 更新向量
   */
  abstract update(
    collection: string,
    entries: VectorEntry[],
  ): Promise<void>;

  /**
   * 删除向量
   */
  abstract delete(collection: string, ids: string[]): Promise<void>;

  /**
   * 相似度搜索
   */
  abstract search(
    collection: string,
    query: number[],
    options?: SearchOptions,
  ): Promise<SearchResult[]>;

  /**
   * 按ID获取向量
   */
  abstract get(collection: string, ids: string[]): Promise<VectorEntry[]>;

  /**
   * 获取集合中所有向量
   */
  abstract getAll(collection: string): Promise<VectorEntry[]>;

  /**
   * 统计集合大小
   */
  abstract count(collection: string): Promise<number>;

  /**
   * 持久化（如果支持）
   */
  abstract persist(): Promise<void>;

  /**
   * 关闭连接
   */
  abstract close(): Promise<void>;

  /**
   * 健康检查
   */
  abstract healthCheck(): Promise<{ available: boolean; error?: string }>;
}

// ── 内存实现（开发/测试用） ──

export class MemoryVectorStore extends VectorStore {
  private collections = new Map<string, {
    entries: Map<string, VectorEntry>;
    metadata?: Record<string, unknown>;
  }>();

  constructor(config: VectorStoreConfig) {
    super(config);
  }

  async createCollection(name: string, metadata?: Record<string, unknown>): Promise<void> {
    if (this.collections.has(name)) {
      throw new Error(`Collection "${name}" already exists`);
    }
    this.collections.set(name, {
      entries: new Map(),
      metadata,
    });
  }

  async deleteCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) {
      throw new Error(`Collection "${name}" not found`);
    }
    this.collections.delete(name);
  }

  async getCollection(name: string): Promise<CollectionInfo | null> {
    const coll = this.collections.get(name);
    if (!coll) return null;

    return {
      name,
      count: coll.entries.size,
      dimension: this.config.dimension,
      metadata: coll.metadata,
    };
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const infos: CollectionInfo[] = [];
    for (const [name, coll] of this.collections) {
      infos.push({
        name,
        count: coll.entries.size,
        dimension: this.config.dimension,
        metadata: coll.metadata,
      });
    }
    return infos;
  }

  async add(collection: string, entries: VectorEntry[]): Promise<void> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    for (const entry of entries) {
      coll.entries.set(entry.id, entry);
    }
  }

  async update(collection: string, entries: VectorEntry[]): Promise<void> {
    await this.add(collection, entries); // 覆盖即更新
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    for (const id of ids) {
      coll.entries.delete(id);
    }
  }

  async search(
    collection: string,
    query: number[],
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    const { limit = 10, minScore = this.config.defaultMinScore, where, includeVectors = false } = options;

    const results: SearchResult[] = [];

    for (const [id, entry] of coll.entries) {
      // 元数据过滤
      if (where) {
        let matches = true;
        for (const [key, value] of Object.entries(where)) {
          if (entry.metadata?.[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      // 计算相似度
      const score = this.cosineSimilarity(query, entry.vector);
      if (score >= minScore) {
        results.push({
          id,
          score,
          content: entry.content,
          metadata: entry.metadata,
          vector: includeVectors ? entry.vector : undefined,
        });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  async get(collection: string, ids: string[]): Promise<VectorEntry[]> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    const entries: VectorEntry[] = [];
    for (const id of ids) {
      const entry = coll.entries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  async getAll(collection: string): Promise<VectorEntry[]> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    return Array.from(coll.entries.values());
  }

  async count(collection: string): Promise<number> {
    const coll = this.collections.get(collection);
    if (!coll) {
      throw new Error(`Collection "${collection}" not found`);
    }

    return coll.entries.size;
  }

  async persist(): Promise<void> {
    // 内存实现不支持持久化
  }

  async close(): Promise<void> {
    this.collections.clear();
  }

  async healthCheck(): Promise<{ available: boolean; error?: string }> {
    return { available: true };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    
    const minLength = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    
    for (let i = 0; i < minLength; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

// ── 工厂函数 ──

export interface VectorStoreFactoryOptions {
  type: 'memory' | 'chroma' | 'lancedb' | 'pinecone';
  config: VectorStoreConfig;
  /** Chroma/LanceDB/Pinecone 连接配置 */
  connectionConfig?: Record<string, unknown>;
}

export async function createVectorStore(
  options: VectorStoreFactoryOptions,
): Promise<VectorStore> {
  switch (options.type) {
    case 'memory':
      return new MemoryVectorStore(options.config);
    
    case 'chroma':
      // 延迟加载 Chroma 实现
      try {
        // @ts-ignore — 可选后端，运行时通过 try/catch 兜底
        const { ChromaVectorStore } = await import('./ChromaVectorStore.js');
        return new ChromaVectorStore(options.config, options.connectionConfig);
      } catch {
        throw new Error('Chroma Vector Store not available');
      }
    
    case 'lancedb':
      // 延迟加载 LanceDB 实现
      try {
        // @ts-ignore — 可选后端，运行时通过 try/catch 兜底
        const { LanceDBVectorStore } = await import('./LanceDBVectorStore.js');
        return new LanceDBVectorStore(options.config, options.connectionConfig);
      } catch {
        throw new Error('LanceDB Vector Store not available');
      }
    
    case 'pinecone':
      // 延迟加载 Pinecone 实现
      try {
        // @ts-ignore — 可选后端，运行时通过 try/catch 兜底
        const { PineconeVectorStore } = await import('./PineconeVectorStore.js');
        return new PineconeVectorStore(options.config, options.connectionConfig);
      } catch {
        throw new Error('Pinecone Vector Store not available');
      }
    
    default:
      throw new Error(`Unknown vector store type: ${options.type}`);
  }
}

// ── StoredEntry 转换器 ──

export function storedEntryToVectorEntry(entry: StoredEntry): VectorEntry {
  const content = typeof entry.value === 'object'
    ? JSON.stringify(entry.value)
    : String(entry.value);
  
  return {
    id: entry.id,
    vector: [], // 向量需要单独生成
    content: `${entry.key}: ${content}`,
    metadata: {
      ...entry.metadata,
      originalKey: entry.key,
      timestamp: entry.timestamp,
      accessCount: entry.accessCount,
      lastAccessed: entry.lastAccessed,
    },
    timestamp: entry.timestamp,
  };
}