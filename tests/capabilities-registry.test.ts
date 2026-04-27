import { describe, it, expect, beforeEach } from 'vitest';
import { AtomicCapabilityRegistry, CapabilityRegistry } from '../Dawn/src/capabilities/index.js';
import type { AtomicCapability, AtomicInput, CapabilityResult } from '../Dawn/src/capabilities/registry/types.js';

describe('AtomicCapabilityRegistry — 能力注册中心', () => {
  let registry: AtomicCapabilityRegistry;
  const mockCap: AtomicCapability = {
    name: 'test-cap',
    description: '测试能力',
    intentTypes: ['code' as any],
    permissions: ['read', 'write'],
    async execute(input: AtomicInput): Promise<CapabilityResult> {
      return { success: true, output: `executed with ${JSON.stringify(input.params)}` };
    },
    validate(input: AtomicInput): boolean {
      return typeof input.params === 'object';
    },
  };

  beforeEach(() => {
    registry = new AtomicCapabilityRegistry();
  });

  it('应注册并列出原子能力', () => {
    registry.register(mockCap);
    expect(registry.listAtomics().length).toBe(1);
    expect(registry.listAtomics()[0]!.name).toBe('test-cap');
  });

  it('应通过名称获取能力', () => {
    registry.register(mockCap);
    const cap = registry.getAtomic('test-cap');
    expect(cap).toBeDefined();
    expect(cap!.name).toBe('test-cap');
  });

  it('不存在的名称应返回 undefined', () => {
    expect(registry.getAtomic('nonexistent')).toBeUndefined();
  });

  it('应取消注册能力', () => {
    registry.register(mockCap);
    expect(registry.unregister('test-cap')).toBe(true);
    expect(registry.listAtomics().length).toBe(0);
  });

  it('应通过意图类型查找能力', () => {
    registry.register(mockCap);
    const found = registry.findAtomic('code' as any);
    expect(found.length).toBe(1);
    expect(found[0]!.name).toBe('test-cap');
  });

  it('应执行原子能力', async () => {
    registry.register(mockCap);
    const result = await registry.executeAtomic('test-cap', {
      intentType: 'code' as any,
      params: { msg: 'hello' },
      context: { sessionId: 's1' },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('执行不存在的能力应返回错误', async () => {
    const result = await registry.executeAtomic('missing', {
      intentType: 'code' as any,
      params: {},
      context: { sessionId: 's1' },
    });
    expect(result.success).toBe(false);
  });

  it('应列出所需权限', () => {
    registry.register(mockCap);
    const perms = registry.listRequiredPermissions();
    expect(perms.get('test-cap')).toEqual(['read', 'write']);
  });

  it('应支持批量注册', () => {
    const cap2: AtomicCapability = {
      ...mockCap,
      name: 'test-cap-2',
      intentTypes: ['chat' as any],
    };
    registry.registerAll([mockCap, cap2]);
    expect(registry.listAtomics().length).toBe(2);
    expect(registry.stats.atomicCount).toBe(2);
  });

  it('应提供向后兼容的 toLegacy 接口', () => {
    registry.register(mockCap);
    const legacy = registry.toLegacy();
    expect(legacy.getAll().length).toBe(1);
    const cap = legacy.get('test-cap');
    expect(cap).toBeDefined();
  });
});
