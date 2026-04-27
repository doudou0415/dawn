import { describe, it, expect } from 'vitest';
import {
  SelfEvolutionEngine,
  EvolutionSandbox,
  PerformanceEvaluator,
  CodeMutator,
} from '../Dawn/src/evolution/index.js';

describe('SelfEvolutionEngine — 自进化引擎', () => {
  const mockTask = {
    id: 'test-001',
    description: '测试任务：优化代码质量',
    toolsUsed: ['code_review', 'code_generation', 'bash'],
    stepsTaken: ['分析代码', '生成测试', '运行测试', '审查结果'],
    success: true,
    duration: 5000,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    keywords: ['optimization', 'code_quality'],
  };

  it('应使用默认配置创建引擎', () => {
    const engine = new SelfEvolutionEngine();
    expect(engine).toBeInstanceOf(SelfEvolutionEngine);
    expect(engine.getConfig().autoEvolve).toBe(false);
  });

  it('analyzeTask 应返回改进建议', async () => {
    const engine = new SelfEvolutionEngine();
    const suggestions = await engine.analyzeTask(mockTask);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('应能获取所有建议', () => {
    const engine = new SelfEvolutionEngine();
    expect(engine.getAllSuggestions()).toEqual([]);
    expect(engine.getHighPrioritySuggestions()).toEqual([]);
  });

  it('应能管理进化计数', () => {
    const engine = new SelfEvolutionEngine();
    expect(engine.getEvolutionCount()).toBe(0);
  });

  it('应能获取各子组件', () => {
    const engine = new SelfEvolutionEngine();
    expect(engine.getEvaluator()).toBeInstanceOf(PerformanceEvaluator);
    expect(engine.getSandbox()).toBeInstanceOf(EvolutionSandbox);
  });

  it('应能更新配置', () => {
    const engine = new SelfEvolutionEngine();
    engine.updateConfig({ topK: 3, explorationRate: 0.5 });
    expect(engine.getConfig().topK).toBe(3);
    expect(engine.getConfig().explorationRate).toBe(0.5);
  });

  it('清除旧建议应正常工作', () => {
    const engine = new SelfEvolutionEngine();
    engine.clearOldSuggestions(0);
    expect(engine.getAllSuggestions()).toEqual([]);
  });
});

describe('EvolutionSandbox — 安全沙箱', () => {
  const sandbox = new EvolutionSandbox();

  it('应拒绝写入受保护路径', () => {
    const result = sandbox.validate('write', 'src/engine/Agent.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('受保护');
  });

  it('应允许写入安全路径', () => {
    const result = sandbox.validate('write', 'src/evolution/experiments/test.ts');
    expect(result.allowed).toBe(true);
  });

  it('读取操作应始终允许', () => {
    const result = sandbox.validateRead('src/engine/Agent.ts');
    expect(result.allowed).toBe(true);
  });

  it('isProtected 应正确判断', () => {
    expect(sandbox.isProtected('src/engine/core/Agent.ts')).toBe(true);
    expect(sandbox.isProtected('src/evolution/test.ts')).toBe(false);
  });

  it('isSafe 应正确判断', () => {
    expect(sandbox.isSafe('src/evolution')).toBe(true);
    expect(sandbox.isSafe('src/engine')).toBe(false);
  });

  it('应能获取配置副本', () => {
    const config = sandbox.getConfig();
    expect(config.protectedPaths).toContain('src/engine');
    expect(config.safePaths).toContain('src/evolution');
  });
});

describe('CodeMutator — 代码变异器', () => {
  it('应执行点变异（至少返回结果结构完整）', () => {
    const mutator = new CodeMutator();
    const result = mutator.pointMutation({
      sourceCode: 'function add(a: number, b: number): number { return a + b; }',
      filePath: 'test.ts',
      language: 'typescript',
    });
    expect(result.description).toBeDefined();
    expect(result.mutatedCode).toBeDefined();
    // 点变异可能改变也可能不改变代码，但结果必须有意义
    expect(typeof result.mutatedCode).toBe('string');
  });
});
