import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HybridRetriever, JsonFileStore, SessionMemory, PersistentMemory, SkillMemory } from '../Dawn/src/memory/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('HybridRetriever — 混合检索', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'dawn-retriever-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('应使用 store 创建', () => {
    const pStore = new JsonFileStore(join(baseDir, 'p.json'), 100);
    const sStore = new JsonFileStore(join(baseDir, 's.json'), 100);
    const retriever = new HybridRetriever(pStore, sStore);
    expect(retriever).toBeDefined();
  });

  it('检索空数据应返回 entries 空数组', async () => {
    const pStore = new JsonFileStore(join(baseDir, 'p.json'), 100);
    const sStore = new JsonFileStore(join(baseDir, 's.json'), 100);
    const retriever = new HybridRetriever(pStore, sStore);
    const result = await retriever.retrieve({ query: 'anything', maxResults: 5 });
    expect(result).toBeDefined();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.strategy).toBeDefined();
    expect(typeof result.totalScore).toBe('number');
  });

  it('bindLayers 后检索不应抛异常', async () => {
    const pStore = new JsonFileStore(join(baseDir, 'p.json'), 100);
    const sStore = new JsonFileStore(join(baseDir, 's.json'), 100);
    const retriever = new HybridRetriever(pStore, sStore);
    const session = new SessionMemory(100);
    const persistent = new PersistentMemory(baseDir, 100);
    const skill = new SkillMemory(baseDir, 100);
    retriever.bindLayers(session, persistent, skill);
    await expect(
      retriever.retrieve({ query: 'data', maxResults: 10 }),
    ).resolves.toBeDefined();
  });
});
