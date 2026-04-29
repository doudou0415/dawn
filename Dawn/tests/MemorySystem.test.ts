import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock JsonFileStore 为纯内存实现 ──
const mockStoreData: Array<{
  id: string; key: string; value: unknown;
  metadata?: Record<string, unknown>; timestamp: number;
}> = [];

vi.mock('../src/memory/store/MemoryStore.js', () => {
  const entries: Array<{
    id: string; key: string; value: unknown;
    metadata?: Record<string, unknown>; timestamp: number;
  }> = [];

  return {
    JsonFileStore: class MockJsonFileStore {
      private localEntries = entries;

      async save(entry: { key: string; value: unknown; metadata?: Record<string, unknown> }) {
        const newEntry = {
          ...entry,
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
        };
        (this.localEntries as any[]).push(newEntry);
        return newEntry;
      }

      async findByKeyPrefix(prefix: string) {
        return (this.localEntries as any[]).filter((e: any) => e.key.startsWith(prefix));
      }

      async search(text: string, limit = 20) {
        if (!text) return (this.localEntries as any[]).slice(-limit);
        const lower = text.toLowerCase();
        const keywords = lower.split(/[\s,，。；;：:、！!？?()（）\[\]【】{}"'"\/\\|_\-+=*&^%$#@~`]/).filter((w: string) => w.length > 1);
        const scored = (this.localEntries as any[]).map((e: any) => {
          const searchable = JSON.stringify({ key: e.key, value: e.value, metadata: e.metadata }).toLowerCase();
          let score = 0;
          for (const kw of keywords) if (searchable.includes(kw)) score += 1;
          return { entry: e, score };
        });
        return scored.filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, limit).map((s: any) => s.entry);
      }

      async getAll() { return [...this.localEntries as any[]]; }

      async delete(id: string) {
        const idx = (this.localEntries as any[]).findIndex((e: any) => e.id === id);
        if (idx >= 0) { (this.localEntries as any[]).splice(idx, 1); return true; }
        return false;
      }

      async clear() { (this.localEntries as any[]).length = 0; }
    },
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => '12345\t/path'),
}));

import { MemorySystem } from '../src/memory/MemorySystem.js';

describe('MemorySystem', () => {
  let mem: MemorySystem;

  beforeEach(() => {
    mockStoreData.length = 0;
    mem = new MemorySystem('/tmp/test-memory', {
      sessionMaxSize: 10,
      persistentMaxEntries: 10,
      skillMaxEntries: 10,
      autoForgetIntervalMs: 60000,
      enableVectorSearch: false,
    });
  });

  afterEach(() => {
    mem = null!;
  });

  describe('save() and recall', () => {
    it('应该保存并取回会话记忆', async () => {
      await mem.save({
        key: 'test-key',
        value: { message: 'hello' },
        type: 'session',
      });

      const result = await mem.getRelevantMemories({ text: 'test-key', limit: 10 });
      expect(result.session.length).toBeGreaterThanOrEqual(1);
      expect(result.session[0]?.key).toBe('test-key');
    });

    it('应该保存持久记忆', async () => {
      await mem.save({
        key: 'test-persist',
        value: 'hello persistent',
        type: 'persistent',
      });

      const result = await mem.getRelevantMemories({ text: 'test-persist', limit: 10 });
      expect(result.persistent.length).toBeGreaterThanOrEqual(1);
    });

    it('应该保存技能记忆', async () => {
      await mem.save({
        key: 'skill-review',
        value: { pattern: 'review' },
        type: 'skill',
      });

      const result = await mem.getRelevantMemories({ text: 'skill-review', limit: 10 });
      expect(result.skill.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getRelevantMemories()', () => {
    it('应该返回 summary 和 strategy 字段', async () => {
      const result = await mem.getRelevantMemories({ text: 'anything', limit: 5 });
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('persistent');
      expect(result).toHaveProperty('skill');
    });

    it('无匹配时应该返回"无相关记忆"', async () => {
      await mem.clearSession();
      const result = await mem.getRelevantMemories({ text: 'xyznonexistent', limit: 5 });
      expect(result.summary).toBe('无相关记忆');
    });
  });

  describe('autoCleanup()', () => {
    it('应该返回清理结果对象', async () => {
      const result = await mem.autoCleanup();
      expect(result).toHaveProperty('archived');
      expect(result).toHaveProperty('forgottenPersistent');
      expect(result).toHaveProperty('forgottenSkill');
      expect(result).toHaveProperty('spaceFreed');
      expect(typeof result.archived).toBe('number');
      expect(typeof result.forgottenPersistent).toBe('number');
      expect(typeof result.forgottenSkill).toBe('number');
      expect(typeof result.spaceFreed).toBe('number');
    });
  });

  describe('getStats()', () => {
    it('应该返回三层统计信息', async () => {
      const stats = await mem.getStats();
      expect(stats).toHaveProperty('session');
      expect(stats).toHaveProperty('persistent');
      expect(stats).toHaveProperty('skill');
      expect(stats).toHaveProperty('vectorSearch');
      expect(stats.session.totalEntries).toBe(0);
      expect(stats.session.maxSize).toBe(10);
    });
  });

  describe('recordExecution()', () => {
    it('应该记录执行上下文到 session', async () => {
      await mem.recordExecution({
        task: '写一个排序函数',
        category: 'code_generation',
        confidence: 0.9,
        success: true,
        duration: 1500,
        generatedCode: 'function sort(arr) { return arr.sort(); }',
      });

      const result = await mem.getRelevantMemories({ text: '排序', limit: 10 });
      expect(result.session.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('preference 管理', () => {
    it('应该保存和读取偏好', async () => {
      await mem.savePreference('language', 'zh-CN');
      const value = await mem.getPreference('language');
      expect(value).toBe('zh-CN');
    });

    it('getAllPreferences 应该返回所有偏好', async () => {
      await mem.savePreference('theme', 'dark');
      await mem.savePreference('fontSize', '14');

      const prefs = await mem.getAllPreferences();
      expect(prefs.theme).toBe('dark');
      expect(prefs.fontSize).toBe('14');
    });
  });

  describe('getHealthStatus()', () => {
    it('应该返回各层健康状态', async () => {
      const health = await mem.getHealthStatus();
      expect(health.session.available).toBe(true);
      expect(typeof health.session.count).toBe('number');
      expect(health.vectorSearch.enabled).toBe(false);
    });
  });

  describe('clearSession()', () => {
    it('应该清空会话记忆', async () => {
      await mem.save({ key: 'k1', value: 'v1', type: 'session' });
      await mem.save({ key: 'k2', value: 'v2', type: 'session' });

      await mem.clearSession();

      const result = await mem.getRelevantMemories({ text: 'k1', limit: 10 });
      expect(result.session).toEqual([]);
    });
  });

  describe('config', () => {
    it('组件应该被正确创建', () => {
      expect(mem.session).toBeDefined();
      expect(mem.persistent).toBeDefined();
      expect(mem.skill).toBeDefined();
      expect(mem.compressor).toBeDefined();
      expect(mem.retriever).toBeDefined();
    });
  });
});
