/**
 * MemoryStore — 统一存储抽象层
 *
 * 提供 JSON 文件存储的基础实现，后续可扩展 SQLite / Vector 实现。
 * 所有存储操作通过此接口，上层无需关心具体存储后端。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ── 存储条目类型 ──

export interface StoredEntry {
  id: string;
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  timestamp: number;
  ttl?: number;
  accessCount: number;
  lastAccessed: number;
}

// ── 存储接口 ──

export interface IMemoryStore {
  /** 保存一条记录 */
  save(entry: Omit<StoredEntry, 'id' | 'timestamp'>): Promise<StoredEntry>;
  /** 按 id 查询 */
  get(id: string): Promise<StoredEntry | null>;
  /** 按 key 前缀搜索 */
  findByKeyPrefix(prefix: string): Promise<StoredEntry[]>;
  /** 关键词搜索（基于文本匹配） */
  search(text: string, limit?: number): Promise<StoredEntry[]>;
  /** 获取所有条目 */
  getAll(): Promise<StoredEntry[]>;
  /** 删除 */
  delete(id: string): Promise<boolean>;
  /** 清空 */
  clear(): Promise<void>;
  /** 条目数 */
  count(): Promise<number>;
}

// ── JSON 文件存储实现 ──

export class JsonFileStore implements IMemoryStore {
  private filePath: string;
  private maxEntries: number;

  constructor(filePath: string, maxEntries = 1000) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
  }

  private async load(): Promise<StoredEntry[]> {
    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return [];
      const content = await file.text();
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async saveToFile(entries: StoredEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2));
  }

  async save(entry: Omit<StoredEntry, 'id' | 'timestamp'>): Promise<StoredEntry> {
    const entries = await this.load();
    const newEntry: StoredEntry = {
      ...entry,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    entries.push(newEntry);

    // 超限裁剪（保留最新的 maxEntries 条）
    if (entries.length > this.maxEntries) {
      entries.splice(0, entries.length - this.maxEntries);
    }

    await this.saveToFile(entries);
    return newEntry;
  }

  async get(id: string): Promise<StoredEntry | null> {
    const entries = await this.load();
    return entries.find(e => e.id === id) ?? null;
  }

  async findByKeyPrefix(prefix: string): Promise<StoredEntry[]> {
    const entries = await this.load();
    return entries.filter(e => e.key.startsWith(prefix));
  }

  async search(text: string, limit = 20): Promise<StoredEntry[]> {
    const entries = await this.load();
    if (!text) return entries.slice(-limit);

    const lower = text.toLowerCase();
    const keywords = lower.split(/[\s,，。；;：:、！!？?()（）\[\]【】{}"'"\/\\|_\-+=*&^%$#@~`]/)
      .filter(w => w.length > 1);

    const scored = entries.map(e => {
      const searchable = JSON.stringify({ key: e.key, value: e.value, metadata: e.metadata }).toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (searchable.includes(kw)) score += 1;
      }
      return { entry: e, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  async getAll(): Promise<StoredEntry[]> {
    return this.load();
  }

  async delete(id: string): Promise<boolean> {
    const entries = await this.load();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    await this.saveToFile(entries);
    return true;
  }

  async clear(): Promise<void> {
    await writeFile(this.filePath, '[]');
  }

  async count(): Promise<number> {
    const entries = await this.load();
    return entries.length;
  }
}
