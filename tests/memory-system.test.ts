import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem, ForgettingLevel } from '../Dawn/src/memory/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemorySystem — 三层记忆系统', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'dawn-memory-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('应使用默认配置创建实例', () => {
    const mem = new MemorySystem(baseDir);
    expect(mem.session).toBeDefined();
    expect(mem.persistent).toBeDefined();
    expect(mem.skill).toBeDefined();
    expect(mem.compressor).toBeDefined();
    expect(mem.retriever).toBeDefined();
  });

  it('应保存并检索会话记忆', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'test-key', value: { msg: 'hello' }, type: 'session' });
    const result = await mem.getRelevantMemories({ text: 'hello', limit: 10 });
    expect(result.session.length).toBeGreaterThanOrEqual(1);
    expect(result.session[0]!.key).toBe('test-key');
  });

  it('应能通过 save 存储持久记忆（不抛异常）', async () => {
    const mem = new MemorySystem(baseDir);
    await expect(
      mem.save({ key: 'persist-key', value: { data: 'important' }, type: 'persistent' }),
    ).resolves.toBeUndefined();
  });

  it('应能通过 save 存储技能记忆（不抛异常）', async () => {
    const mem = new MemorySystem(baseDir);
    await expect(
      mem.save({ key: 'skill-key', value: { code: 'console.log(1)' }, type: 'skill' }),
    ).resolves.toBeUndefined();
  });

  it('getRelevantMemories 应返回三层结构', async () => {
    const mem = new MemorySystem(baseDir);
    const result = await mem.getRelevantMemories({ text: 'data', limit: 10 });
    expect(Array.isArray(result.session)).toBe(true);
    expect(Array.isArray(result.persistent)).toBe(true);
    expect(Array.isArray(result.skill)).toBe(true);
    expect(typeof result.summary).toBe('string');
  });

  it('recordExecution 应记录到会话层', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.recordExecution({
      task: 'test task',
      category: 'testing',
      confidence: 0.9,
      success: true,
      duration: 100,
    });
    const result = await mem.getRelevantMemories({ text: 'test task', limit: 10 });
    expect(result.session.length).toBeGreaterThanOrEqual(1);
  });

  it('能清空会话记忆', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'tmp', value: 'temp', type: 'session' });
    await mem.clearSession();
    const result = await mem.getRelevantMemories({ text: 'temp', limit: 10 });
    expect(result.session.length).toBe(0);
  });

  it('支持分级遗忘（不抛异常）', async () => {
    const mem = new MemorySystem(baseDir);
    const result = await mem.applyForgetting('persistent', ForgettingLevel.LONG_TERM);
    expect(result).toBeDefined();
    expect(typeof result.summarized).toBe('number');
  });

  it('retrieve 不抛异常', async () => {
    const mem = new MemorySystem(baseDir);
    await expect(mem.retrieve({ query: 'hello', maxResults: 5 })).resolves.toBeDefined();
  });
});
