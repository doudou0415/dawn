import { describe, it, expect } from 'vitest';
import { MemoryCompressor, ForgettingLevel, calculateImportance, applyForgetting, DEFAULT_FORGETTING_CONFIGS } from '../Dawn/src/memory/index.js';

describe('MemoryCompressor — 记忆压缩', () => {
  const makeEntry = (overrides: Partial<{ key: string; accessCount: number; lastAccessed: number; timestamp: number; importance: number }> = {}) => ({
    key: overrides.key ?? 'test',
    value: { text: 'test data' },
    metadata: overrides.importance !== undefined ? { importance: overrides.importance } : {},
    timestamp: overrides.timestamp ?? Date.now(),
    lastAccessed: overrides.lastAccessed ?? Date.now(),
    accessCount: overrides.accessCount ?? 5,
    ...({} as any),
  });

  it('应使用默认配置创建', () => {
    const compressor = new MemoryCompressor();
    expect(compressor).toBeDefined();
  });

  it('DEFAULT_FORGETTING_CONFIGS 应包含三级配置', () => {
    expect(DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.SHORT_TERM]).toBeDefined();
    expect(DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.MEDIUM_TERM]).toBeDefined();
    expect(DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.LONG_TERM]).toBeDefined();
  });

  it('calculateImportance 应返回 0-1 之间的值', () => {
    const entry = makeEntry({ accessCount: 25, importance: 0.8 });
    const score = calculateImportance(entry as any);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('calculateImportance 应给高频条目更高分数', () => {
    const high = calculateImportance(makeEntry({ accessCount: 100, importance: 0 }) as any);
    const low = calculateImportance(makeEntry({ accessCount: 0, importance: 0 }) as any);
    expect(high).toBeGreaterThan(low);
  });

  it('calculateImportance 应利用显式重要性加成', () => {
    const withImportance = calculateImportance(makeEntry({ importance: 1.0, accessCount: 0 }) as any);
    const without = calculateImportance(makeEntry({ importance: 0, accessCount: 0 }) as any);
    expect(withImportance).toBeGreaterThan(without);
  });

  it('applyForgetting 应保留重要记忆', () => {
    const entries = [
      makeEntry({ key: 'imp', importance: 0.9, accessCount: 50 }),
      makeEntry({ key: 'triv', importance: 0, accessCount: 0 }),
    ];
    const config = DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.LONG_TERM];
    const result = applyForgetting(entries as any, config);
    const keptKeys = result.kept.map(e => (e as any).key);
    expect(keptKeys).toContain('imp');
  });

  it('空条目数组应返回空结果', () => {
    const config = DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.SHORT_TERM];
    const result = applyForgetting([], config);
    expect(result.kept).toEqual([]);
    expect(result.forgotten).toEqual([]);
  });
});
