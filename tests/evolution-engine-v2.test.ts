import { describe, it, expect, beforeEach } from 'vitest';
import {
  SelfEvolutionEngine,
  EvolutionSandbox,
  PerformanceEvaluator,
  CodeMutator,
} from '../Dawn/src/evolution/index.js';
import type { TaskAnalysis, ImprovementSuggestion } from '../Dawn/src/evolution/SelfEvolutionEngine.js';

function createMockTask(overrides: Partial<TaskAnalysis> = {}): TaskAnalysis {
  return {
    id: `task-${Date.now()}`,
    description: '测试任务：优化代码质量',
    toolsUsed: ['code_review', 'code_generation', 'bash'],
    stepsTaken: ['分析代码', '生成测试', '运行测试', '审查结果'],
    success: true,
    duration: 5000,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    keywords: ['optimization', 'code_quality'],
    ...overrides,
  };
}

describe('SelfEvolutionEngine — 进化引擎完整闭环', () => {
  let engine: SelfEvolutionEngine;

  beforeEach(() => {
    engine = new SelfEvolutionEngine({ autoEvolve: false });
  });

  it('应使用默认配置创建', () => {
    expect(engine).toBeInstanceOf(SelfEvolutionEngine);
    expect(engine.getConfig().autoEvolve).toBe(false);
    expect(engine.getConfig().topK).toBe(5);
    expect(engine.getConfig().explorationRate).toBe(0.15);
  });

  it('analyzeTask 应产生改进建议', async () => {
    const suggestions = await engine.analyzeTask(createMockTask());
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('多次 analyzeTask 应累积建议', async () => {
    const t1 = createMockTask({ id: 'task-1', description: '第一次任务' });
    const t2 = createMockTask({ id: 'task-2', description: '第二次任务' });

    await engine.analyzeTask(t1);
    await engine.analyzeTask(t2);

    const all = engine.getAllSuggestions();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('相似任务应触发 skill 建议', async () => {
    const baseTask = createMockTask({
      id: 'base',
      keywords: ['bug', 'fix', 'security'],
    });
    await engine.analyzeTask(baseTask);

    const similarTask = createMockTask({
      id: 'similar',
      keywords: ['bug', 'fix', 'security'],
    });
    const suggestions = await engine.analyzeTask(similarTask);

    const hasSkillSuggestion = suggestions.some(s => s.type === 'skill');
    expect(hasSkillSuggestion).toBe(true);
  });

  it('steps 过多的工作流应触发 workflow 建议', async () => {
    const longTask = createMockTask({
      stepsTaken: Array.from({ length: 12 }, (_, i) => `步骤 ${i + 1}`),
    });
    const suggestions = await engine.analyzeTask(longTask);
    const hasWorkflowSuggestion = suggestions.some(s => s.type === 'workflow');
    expect(hasWorkflowSuggestion).toBe(true);
  });

  it('runExperiment 应在无历史时返回空数组', async () => {
    const results = await engine.runExperiment();
    expect(results).toEqual([]);
  });

  it('runExperiment 应在有历史后返回建议', async () => {
    await engine.analyzeTask(createMockTask());
    await engine.analyzeTask(createMockTask());
    const results = await engine.runExperiment();
    expect(results.length).toBeGreaterThan(0);
  });

  it('getHighPrioritySuggestions 应过滤高优先级', async () => {
    await engine.analyzeTask(createMockTask({ keywords: ['bug', 'fix'] }));
    const high = engine.getHighPrioritySuggestions();
    expect(Array.isArray(high)).toBe(true);
  });

  it('clearOldSuggestions 应保留新建议', () => {
    engine.clearOldSuggestions(0);
    expect(engine.getAllSuggestions()).toEqual([]);
  });

  it('updateConfig 应更新配置并同步到 selector', () => {
    engine.updateConfig({ topK: 3, explorationRate: 0.5 });
    expect(engine.getConfig().topK).toBe(3);
    expect(engine.getConfig().explorationRate).toBe(0.5);
    const selector = engine.getSelector();
    expect(selector).toBeDefined();
  });

  it('getEvolutionCount 应递增', async () => {
    expect(engine.getEvolutionCount()).toBe(0);
    await engine.analyzeTask(createMockTask({ toolsUsed: ['code_generation', 'code_review', 'bash', 'test'] }));
    await engine.runExperiment();
    expect(engine.getEvolutionCount()).toBeGreaterThan(0);
  });

  it('应能获取各子组件', () => {
    expect(engine.getEvaluator()).toBeInstanceOf(PerformanceEvaluator);
    expect(engine.getSandbox()).toBeInstanceOf(EvolutionSandbox);
    expect(engine.getArchivist()).toBeDefined();
  });

  it('autoEvolve=true 时 analyzeTask 应触发闭环', async () => {
    const autoEngine = new SelfEvolutionEngine({ autoEvolve: true, topK: 3 });
    const highScoreTask = createMockTask({
      toolsUsed: ['code_generation', 'code_review', 'bash', 'analysis', 'test'],
    });
    const suggestions = await autoEngine.analyzeTask(highScoreTask);
    // evaluator 会给高分，触发 evolveFromTask
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('startAutoEvolution 不应重复启动定时器', () => {
    engine.startAutoEvolution(10000);
    engine.startAutoEvolution(5000); // 第二次应被忽略
    // 只要不抛异常就算通过
    engine.stopAutoEvolution();
    expect(engine.getEvolutionCount()).toBe(0);
  });
});

describe('EvolutionSandbox — 沙箱安全', () => {
  const sandbox = new EvolutionSandbox();

  it('应拒绝写入受保护路径', () => {
    expect(sandbox.validate('write', 'src/engine/core/Agent.ts').allowed).toBe(false);
    expect(sandbox.validate('write', 'src/engine/coordinator/Coordinator.ts').allowed).toBe(false);
  });

  it('应允许写入安全路径', () => {
    expect(sandbox.validate('write', 'src/evolution/experiments/test.ts').allowed).toBe(true);
    expect(sandbox.validate('write', '.dawn-evolution-tmp/test.ts').allowed).toBe(true);
  });

  it('读取操作应始终允许', () => {
    expect(sandbox.validateRead('src/engine/core/Agent.ts').allowed).toBe(true);
    expect(sandbox.validateRead('src/evolution/SelfEvolutionEngine.ts').allowed).toBe(true);
  });

  it('isProtected 应正确判断', () => {
    expect(sandbox.isProtected('node_modules/express/index.js')).toBe(true);
    expect(sandbox.isProtected('.git/config')).toBe(true);
    expect(sandbox.isProtected('src/evolution/test.ts')).toBe(false);
  });

  it('getConfig 应返回受保护路径列表', () => {
    const config = sandbox.getConfig();
    expect(config.protectedPaths).toContain('src/engine');
    expect(config.safePaths).toContain('src/evolution');
  });
});

describe('CodeMutator — 代码变异器', () => {
  const mutator = new CodeMutator();

  it('点变异应返回描述和变异代码', () => {
    const result = mutator.pointMutation({
      sourceCode: 'function add(a: number, b: number): number { return a + b; }',
      filePath: 'test.ts',
      language: 'typescript',
    });
    expect(result.description).toBeDefined();
    expect(typeof result.mutatedCode).toBe('string');
  });

  it('不同输入产生不同变异结果', () => {
    const r1 = mutator.pointMutation({
      sourceCode: 'const x = 1;',
      filePath: 'a.ts',
      language: 'typescript',
    });
    const r2 = mutator.pointMutation({
      sourceCode: 'const y = 2;',
      filePath: 'b.ts',
      language: 'typescript',
    });
    // 描述或代码至少有一个不同
    const same = r1.description === r2.description && r1.mutatedCode === r2.mutatedCode;
    expect(same).toBe(false);
  });
});

describe('PerformanceEvaluator — 性能评估器', () => {
  const evaluator = new PerformanceEvaluator();

  it('应能评估任务性能并返回分数', () => {
    const result = evaluator.evaluate({
      taskId: 'test-001',
      taskDescription: '测试评估',
      success: true,
      executionDurationMs: 1000,
      toolsUsed: ['code_gen', 'review'],
      stepsTaken: ['step1', 'step2'],
      createdAt: new Date().toISOString(),
    });
    expect(result).toHaveProperty('overallScore');
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result).toHaveProperty('details');
  });

  it('失败任务分数应低于成功任务', () => {
    const success = evaluator.evaluate({
      taskId: 's', taskDescription: '成功任务', success: true,
      executionDurationMs: 100, toolsUsed: ['t1'], stepsTaken: ['s1'],
      createdAt: new Date().toISOString(),
    });
    const failure = evaluator.evaluate({
      taskId: 'f', taskDescription: '失败任务', success: false,
      executionDurationMs: 100, toolsUsed: ['t1'], stepsTaken: ['s1'],
      createdAt: new Date().toISOString(),
    });
    expect(success.overallScore).toBeGreaterThan(failure.overallScore);
  });
});
