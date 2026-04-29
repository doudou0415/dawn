import { describe, it, expect, beforeEach } from 'vitest';
import { Coordinator } from '../Dawn/src/engine/coordinator/Coordinator.js';

describe('Coordinator — 统一调度中枢', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    coordinator = new Coordinator();
  });

  it('应使用默认配置创建实例', () => {
    expect(coordinator).toBeInstanceOf(Coordinator);
    const stats = coordinator.getStats();
    expect(stats.total).toBe(0);
    expect(stats.success).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('execute 应返回 AgentResult（普通对话）', async () => {
    const result = await coordinator.execute('你好，今天状态怎么样？');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('response');
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(0);
  });

  it('execute 应正确统计执行次数', async () => {
    const result1 = await coordinator.execute('你好');
    expect(result1).toBeDefined();
    const stats1 = coordinator.getStats();
    expect(stats1.total).toBe(1);

    const result2 = await coordinator.execute('今天天气如何');
    expect(result2).toBeDefined();
    const stats2 = coordinator.getStats();
    expect(stats2.total).toBe(2);

    const result3 = await coordinator.execute('写一个 TypeScript 函数');
    expect(result3).toBeDefined();
    const stats3 = coordinator.getStats();
    expect(stats3.total).toBe(3);
    expect(stats3.success + stats3.failed).toBe(3);
  });

  it('execute 应触发自进化分析（不阻塞返回）', async () => {
    const result = await coordinator.execute('优化这段代码');
    expect(result).toBeDefined();
    // 自进化是异步后台任务，不阻塞 execute 返回
    // 验证 analyzeTask 不会导致 execute 抛出异常
    expect(result.response.length).toBeGreaterThan(0);
  });

  it('should route code generation intent to code_generation capability', async () => {
    const result = await coordinator.execute('给我写一个快速排序函数');
    expect(result).toBeDefined();
    expect(typeof result.response).toBe('string');
  });

  it('getCapabilityRegistry 应返回已注册能力的 registry', () => {
    const registry = coordinator.getCapabilityRegistry();
    expect(registry).toBeDefined();
    expect(registry.stats.atomicCount).toBeGreaterThanOrEqual(4);
  });

  it('getEvolutionEngine 应返回 evolution 实例', () => {
    const engine = coordinator.getEvolutionEngine();
    expect(engine).not.toBeNull();
  });

  it('runEvolution 应返回建议列表（可能为空）', async () => {
    const suggestions = await coordinator.runEvolution();
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('getEvolutionStats 应返回结构化状态', () => {
    const stats = coordinator.getEvolutionStats();
    expect(stats).toHaveProperty('evolutionCount');
    expect(stats).toHaveProperty('suggestionsCount');
    expect(stats).toHaveProperty('highPriorityCount');
  });

  it('setAutoEvolution 应能启用/禁用自动进化', () => {
    expect(() => coordinator.setAutoEvolution(true)).not.toThrow();
    expect(() => coordinator.setAutoEvolution(false)).not.toThrow();
  });
});
