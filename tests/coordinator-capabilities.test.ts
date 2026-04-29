import { describe, it, expect, beforeEach } from 'vitest';
import { Coordinator } from '../Dawn/src/engine/coordinator/Coordinator.js';

describe('Coordinator — 能力路由与边界', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    coordinator = new Coordinator();
  });

  it('长文本输入不应抛异常', async () => {
    const longText = 'A'.repeat(10000);
    const result = await coordinator.execute(longText);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('response');
  });

  it('特殊字符输入不应抛异常', async () => {
    const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~';
    const result = await coordinator.execute(specialChars);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('response');
  });

  it('空输入应返回有效响应', async () => {
    const result = await coordinator.execute('');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('response');
    expect(typeof result.response).toBe('string');
  });

  it('getStats 的 total 应与 success + failed 一致', async () => {
    await coordinator.execute('你好');
    await coordinator.execute('天气');
    await coordinator.execute('代码');
    const stats = coordinator.getStats();
    expect(stats.total).toBe(stats.success + stats.failed);
  });

  it('多次 execute 后 failed 应为 0（正常情况）', async () => {
    for (let i = 0; i < 5; i++) {
      await coordinator.execute(`任务${i}`);
    }
    const stats = coordinator.getStats();
    expect(stats.failed).toBe(0);
    expect(stats.total).toBe(5);
    expect(stats.success).toBe(5);
  });

  it('getCapabilityRegistry 应返回注册的所有能力统计', () => {
    const registry = coordinator.getCapabilityRegistry();
    expect(registry).toBeDefined();
    expect(registry.stats).toBeDefined();
    expect(registry.stats.atomicCount).toBeGreaterThanOrEqual(0);
    expect(typeof registry.stats.atomicCount).toBe('number');
  });
});
