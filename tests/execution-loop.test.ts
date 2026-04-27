import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionLoop } from '../Dawn/src/engine/core/ExecutionLoop.js';
import { EmotionDetector } from '../Dawn/src/engine/core/EmotionDetector.js';
import { ResponseGenerator } from '../Dawn/src/engine/core/ResponseGenerator.js';
import { HistoryManager } from '../Dawn/src/engine/core/HistoryManager.js';
import { SelfEvolutionEngine } from '../Dawn/src/evolution/SelfEvolutionEngine.js';

function createMinimalLoop(evolutionEngine?: SelfEvolutionEngine): ExecutionLoop {
  const config = {
    enableMemory: false,
    enableConversationHistory: true,
    enableToolPerformanceTracking: true,
    enableSelfReview: true,
    enableAdvancedDialogue: false,
  };
  const emotionDetector = new EmotionDetector();
  const responseGen = new ResponseGenerator();
  const historyMgr = new HistoryManager(config);
  const context = {
    messages: [],
    entityMemory: new Map(),
    dialogueState: null,
  };
  return new ExecutionLoop(
    config,
    emotionDetector,
    responseGen,
    historyMgr,
    context,
    undefined,
    evolutionEngine,
  );
}

describe('ExecutionLoop — 执行循环核心', () => {
  let loop: ExecutionLoop;

  beforeEach(() => {
    loop = createMinimalLoop();
  });

  it('应使用默认配置创建实例', () => {
    expect(loop).toBeInstanceOf(ExecutionLoop);
  });

  it('execute 返回结果应包含 response 字段', async () => {
    const result = await loop.execute('hello');
    expect(result).toHaveProperty('response');
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(0);
  });

  it('空任务应返回问候语', async () => {
    const result = await loop.execute('');
    expect(result.response).toContain('帮助');
  });

  it('应记录工具调用历史', async () => {
    expect(loop.getToolCallHistory()).toEqual([]);
    loop.recordToolCall('test_tool', Date.now() - 100, Date.now(), true);
    expect(loop.getToolCallHistory().length).toBe(1);
    expect(loop.getToolCallHistory()[0]!.toolName).toBe('test_tool');
    expect(loop.getToolCallHistory()[0]!.success).toBe(true);
  });

  it('应更新工具性能统计', () => {
    loop.recordToolCall('code_gen', Date.now() - 200, Date.now(), true);
    loop.recordToolCall('code_gen', Date.now() - 100, Date.now(), true);
    loop.recordToolCall('code_gen', Date.now() - 50, Date.now(), false);
    const perf = loop.getToolPerformanceByName('code_gen');
    expect(perf).toBeDefined();
    expect(perf!.totalCalls).toBe(3);
    expect(perf!.successfulCalls).toBe(2);
    expect(perf!.successRate).toBeCloseTo(2 / 3);
  });

  it('应能清空工具调用历史', () => {
    loop.recordToolCall('t1', Date.now() - 100, Date.now(), true);
    loop.recordToolCall('t2', Date.now() - 100, Date.now(), false);
    expect(loop.getToolCallHistory().length).toBe(2);
    loop.clearToolCallHistory();
    expect(loop.getToolCallHistory()).toEqual([]);
  });

  it('应能重置工具性能统计', () => {
    loop.recordToolCall('t1', Date.now() - 100, Date.now(), true);
    loop.resetToolPerformance();
    expect(loop.getToolPerformance()).toEqual([]);
  });

  it('recommendTool 应返回推荐的工具名', () => {
    const genRecommend = loop.recommendTool('帮我生成一个函数');
    expect(genRecommend).toBe('code_generation');
    const optRecommend = loop.recommendTool('帮我优化这段代码');
    expect(optRecommend).toBe('code_optimization');
    const qaRecommend = loop.recommendTool('解释一下什么是闭包');
    expect(qaRecommend).toBe('question_answering');
  });

  it('无进化引擎时 getEvolutionEngine 应返回 null', () => {
    expect(loop.getEvolutionEngine()).toBeNull();
  });

  it('getToolsUsed 应返回已用工具列表', () => {
    expect(Array.isArray(loop.getToolsUsed())).toBe(true);
  });

  it('应能关联进化引擎', () => {
    const evoEngine = new SelfEvolutionEngine();
    const loopWithEvo = createMinimalLoop(evoEngine);
    expect(loopWithEvo.getEvolutionEngine()).toBeInstanceOf(SelfEvolutionEngine);
  });

  it('工具调用历史超过 1000 条时应自动裁剪', () => {
    for (let i = 0; i < 1010; i++) {
      loop.recordToolCall(`t${i}`, Date.now() - 100, Date.now(), true);
    }
    expect(loop.getToolCallHistory().length).toBeLessThanOrEqual(1000);
  });

  it('review 应检查代码质量问题', () => {
    const { SmartCodeReviewer } = (ExecutionLoop as any);
    const badCode = 'var x: any = 1;\nconsole.log(x);\n';
    const result = SmartCodeReviewer.review(badCode);
    expect(result.score).toBeLessThan(100);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('干净代码 review 得分应为 100', () => {
    const { SmartCodeReviewer } = (ExecutionLoop as any);
    const cleanCode = 'const x: number = 1;\nconsole.info(x);\n';
    const result = SmartCodeReviewer.review(cleanCode);
    expect(result.score).toBe(100);
  });
});
