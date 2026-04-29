/**
 * @dawn/core — LLM 调用缓存（LRU + TTL）
 *
 * 对消息序列做哈希 → 缓存 ChatResponse，带 TTL 自动过期。
 * 通过 TOOL_CALL_CACHE_ENABLED=true 启用。
 */

import type { LLMMessage } from '../LLMClient.js';
import type { ChatResponse } from './LLMProvider.js';

interface CacheEntry {
  response: ChatResponse;
  expiresAt: number;
}

export class LLMCache {
  private store: Map<string, CacheEntry>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.store = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * 根据消息列表生成缓存键
   */
  private makeKey(messages: LLMMessage[]): string {
    let hash = 5381;
    const str = JSON.stringify(messages);
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return `llm:${hash}`;
  }

  /**
   * 尝试获取缓存命中
   */
  get(messages: LLMMessage[]): ChatResponse | undefined {
    if (!this.isEnabled()) return undefined;

    const key = this.makeKey(messages);
    const entry = this.store.get(key);

    if (!entry) return undefined;

    // TTL 过期检查
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // LRU：删除再插入（移到末尾）
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.response;
  }

  /**
   * 写入缓存
   */
  set(messages: LLMMessage[], response: ChatResponse): void {
    if (!this.isEnabled()) return;

    const key = this.makeKey(messages);

    // 超出容量时，删除最旧的（Map 按插入序排列）
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next();
      if (!oldest.done) {
        this.store.delete(oldest.value);
      }
    }

    this.store.set(key, {
      response,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * 当前缓存条目数
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * 检查缓存是否启用（环境变量 TOOL_CALL_CACHE_ENABLED = true）
   */
  private isEnabled(): boolean {
    try {
      return process.env.TOOL_CALL_CACHE_ENABLED === 'true';
    } catch {
      return false;
    }
  }
}

/** 全局单例 */
let _defaultCache: LLMCache | null = null;

export function getDefaultCache(): LLMCache {
  if (!_defaultCache) {
    _defaultCache = new LLMCache();
  }
  return _defaultCache;
}

export function resetDefaultCache(): void {
  _defaultCache = null;
}
