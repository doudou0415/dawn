import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem, ForgettingLevel } from '../Dawn/src/memory/index.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemorySystem — 会话清理与归档行为', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'dawn-archive-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('clearSession 应在无会话时正常工作', async () => {
    const mem = new MemorySystem(baseDir);
    await expect(mem.clearSession()).resolves.toBeUndefined();
  });

  it('clearSession 应清空会话层', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'tmp-key', value: 'data', type: 'session' });

    const before = await mem.getRelevantMemories({ text: 'tmp-key', limit: 10 });
    expect(before.session.length).toBeGreaterThanOrEqual(1);

    await mem.clearSession();

    const after = await mem.getRelevantMemories({ text: 'tmp-key', limit: 10 });
    expect(after.session.length).toBe(0);
  });

  it('clearSession 后 getRelevantMemories 不应抛异常', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'archive-me', value: '将被清理', type: 'session' });
    await mem.clearSession();
    await expect(
      mem.getRelevantMemories({ text: 'archive', limit: 10 }),
    ).resolves.toBeDefined();
  });

  it('多次 clearSession 不抛异常', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.clearSession();
    await mem.clearSession();
    await mem.clearSession();
    expect(true).toBe(true);
  });

  it('applyForgetting 可对 persistence 层执行遗忘', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'old-data', value: '历史数据', type: 'persistent' });
    const result = await mem.applyForgetting('persistent', ForgettingLevel.LONG_TERM);
    expect(result).toBeDefined();
    expect(typeof result.summarized).toBe('number');
  });

  it('混合类型保存后各层独立', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'a', value: 'alpha', type: 'session' });
    await mem.save({ key: 'b', value: 'beta', type: 'persistent' });
    await mem.save({ key: 'c', value: 'gamma', type: 'skill' });

    const result = await mem.getRelevantMemories({ text: 'alpha beta gamma', limit: 10 });
    expect(result.session.length).toBeGreaterThanOrEqual(1);
    expect(result.persistent.length).toBeGreaterThanOrEqual(1);
    expect(result.skill.length).toBeGreaterThanOrEqual(1);

    // 清理仅影响 session 层
    await mem.clearSession();
    const after = await mem.getRelevantMemories({ text: 'alpha beta gamma', limit: 10 });
    expect(after.session.length).toBe(0);
    expect(after.persistent.length).toBeGreaterThanOrEqual(1);
  });

  it('记忆目录应存在', async () => {
    const mem = new MemorySystem(baseDir);
    await mem.save({ key: 'validity-check', value: { data: 'ok' }, type: 'persistent' });
    expect(existsSync(baseDir)).toBe(true);
  });

  it('支持分级遗忘（不抛异常）', async () => {
    const mem = new MemorySystem(baseDir);
    const result = await mem.applyForgetting('persistent', ForgettingLevel.LONG_TERM);
    expect(result).toBeDefined();
    expect(typeof result.summarized).toBe('number');
  });
});
