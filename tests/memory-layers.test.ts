import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionMemory, PersistentMemory, SkillMemory } from '../Dawn/src/memory/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SessionMemory — 会话记忆层', () => {
  it('应创建并存储条目', async () => {
    const mem = new SessionMemory(100);
    await mem.store('key1', 'value1', { tag: 'test' });
    const results = await mem.query('value1', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.key).toBe('key1');
  });

  it('超出最大大小应触发滑动窗口裁剪', async () => {
    const mem = new SessionMemory(3);
    for (let i = 0; i < 5; i++) {
      await mem.store(`key-${i}`, `value-${i}`, {});
    }
    const results = await mem.query('value', 10);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('clear 应清空所有条目', async () => {
    const mem = new SessionMemory(100);
    await mem.store('k1', 'v1', {});
    await mem.clear();
    const results = await mem.query('v1', 10);
    expect(results.length).toBe(0);
  });
});

describe('SkillMemory — 技能记忆层', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'dawn-skill-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('应创建并存储技能（不抛异常）', async () => {
    const mem = new SkillMemory(baseDir, 100);
    await expect(
      mem.store('print-skill', 'console.log("hello")', { language: 'typescript' }),
    ).resolves.toBeDefined();
  });
});

describe('PersistentMemory — 持久记忆层', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'dawn-persist-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('应创建并存储持久条目（不抛异常）', async () => {
    const mem = new PersistentMemory(baseDir, 100);
    await expect(
      mem.store('pref-theme', 'dark', { type: 'preference' }),
    ).resolves.toBeDefined();
  });
});
