import { describe, it, expect, beforeEach } from 'vitest';
import { AtomicCapabilityRegistry } from '../Dawn/src/capabilities/index.js';
import type { AtomicCapability, AtomicInput, CapabilityResult } from '../Dawn/src/capabilities/registry/types.js';

describe('Plugin 热插拔 — 基于 CapabilityRegistry', () => {
  let registry: AtomicCapabilityRegistry;

  const createPlugin = (name: string): AtomicCapability => ({
    name,
    description: `plugin: ${name}`,
    intentTypes: ['custom' as any],
    permissions: [],
    async execute(input: AtomicInput): Promise<CapabilityResult> {
      return { success: true, output: `plugin ${name} executed` };
    },
  });

  beforeEach(() => {
    registry = new AtomicCapabilityRegistry();
  });

  it('热插拔：注册新插件应立即可用', () => {
    registry.register(createPlugin('hot-plugin'));
    expect(registry.getAtomic('hot-plugin')).toBeDefined();
  });

  it('热插拔：卸载插件应立即移除', () => {
    registry.register(createPlugin('to-remove'));
    expect(registry.listAtomics().length).toBe(1);
    registry.unregister('to-remove');
    expect(registry.listAtomics().length).toBe(0);
  });

  it('热插拔：替换插件应覆盖旧版', async () => {
    registry.register(createPlugin('replaced'));
    registry.register({
      ...createPlugin('replaced'),
      async execute() {
        return { success: true, output: 'v2 output' };
      },
    });
    const result = await registry.executeAtomic('replaced', {
      intentType: 'custom' as any,
      params: {},
      context: { sessionId: 's1' },
    });
    expect(result.output).toBe('v2 output');
  });

  it('热插拔：注册多个插件应全部列出', () => {
    registry.registerAll([createPlugin('p1'), createPlugin('p2'), createPlugin('p3')]);
    expect(registry.listAtomics().length).toBe(3);
  });

  it('热插拔：卸载后注册新插件应恢复', () => {
    registry.register(createPlugin('cyclic'));
    registry.unregister('cyclic');
    expect(registry.getAtomic('cyclic')).toBeUndefined();
    registry.register(createPlugin('cyclic'));
    expect(registry.getAtomic('cyclic')).toBeDefined();
  });
});
