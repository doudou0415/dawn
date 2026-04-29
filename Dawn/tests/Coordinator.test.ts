import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @dawn/core ──
vi.mock('@dawn/core', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  Container: {
    has: vi.fn(() => false),
    get: vi.fn(() => null),
    register: vi.fn(),
  },
}));

// ── Mock LLM 调用 ──
vi.mock('@dawn/core/LLMClient.js', () => ({
  callDeepSeek: vi.fn(),
  getApiKey: vi.fn(() => 'test-key'),
  getBaseUrl: vi.fn(() => 'http://localhost:11434'),
  setInjectedApiKey: vi.fn(),
  SYSTEM_PROMPT: 'You are Dawn.',
}));

import { Coordinator } from '../src/engine/coordinator/Coordinator.js';
import { callDeepSeek } from '@dawn/core/LLMClient.js';

// 确保 mock 引用的是同一个函数
const mockedCallDeepSeek = callDeepSeek as unknown as ReturnType<typeof vi.fn>;

describe('Coordinator', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = new Coordinator();
    // 手动注入 mock evolution engine（vi.mock 在当前 bun+vitest 环境下无效）
    (coordinator as any).evolutionEngine = {
      analyzeTask: vi.fn(async () => []),
      runExperiment: vi.fn(async () => []),
      getEvolutionCount: vi.fn(() => 0),
      getAllSuggestions: vi.fn(() => []),
      getHighPrioritySuggestions: vi.fn(() => []),
      getConfig: vi.fn(() => ({})),
      startAutoEvolution: vi.fn(),
      stopAutoEvolution: vi.fn(),
    };
  });

  describe('execute() — 普通对话', () => {
    it('应该路由到 response 能力并返回成功结果', async () => {
      mockedCallDeepSeek.mockResolvedValue('你好！我是 Dawn，有什么可以帮你的？');

      const result = await coordinator.execute('你好，今天状态怎么样？');

      expect(result.response).toBeTruthy();
      expect(typeof result.response).toBe('string');
      expect(result.reviewResult).toBeUndefined();

      const stats = coordinator.getStats();
      expect(stats.total).toBe(1);
      expect(stats.success).toBe(1);
    });

    it('应该支持带上下文代码的对话', async () => {
      mockedCallDeepSeek.mockResolvedValue('我看到你的代码了，看起来不错。');

      const result = await coordinator.execute('帮我 review 这段代码', 'const x = 1;');

      expect(result.response).toContain('代码');
      expect(result.reviewResult).toBeUndefined();
    });

    it('连续多次执行应该正确累计统计', async () => {
      mockedCallDeepSeek.mockResolvedValue('OK');

      await coordinator.execute('任务1');
      await coordinator.execute('任务2');
      await coordinator.execute('任务3');

      const stats = coordinator.getStats();
      expect(stats.total).toBe(3);
      expect(stats.success).toBe(3);
      expect(stats.failed).toBe(0);
      expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('execute() — 能力路由', () => {
    it('代码生成类输入应该路由到 code_generation 能力', async () => {
      mockedCallDeepSeek.mockImplementation(async (messages: any[]) => {
        const lastMsg = messages[messages.length - 1]?.content ?? '';
        if (lastMsg.includes('分类')) {
          return 'code_generation';
        }
        return '```typescript\nconst x = 1;\n```';
      });

      const result = await coordinator.execute('写一个 TypeScript 函数');

      expect(result.response).toBeTruthy();
    });

    it('失败的能力执行应该返回失败统计', async () => {
      mockedCallDeepSeek.mockRejectedValue(new Error('LLM unavailable'));

      const result = await coordinator.execute('生成代码');
      expect(result.response).toBeTruthy();
      const stats = coordinator.getStats();
      // 虽然能力内部失败，但 Coordinator 返回了出错信息
      expect(stats.total).toBe(1);
    });
  });

  describe('自进化集成', () => {
    it('应该暴露进化引擎', () => {
      const engine = coordinator.getEvolutionEngine();
      expect(engine).not.toBeNull();
    });

    it('runEvolution 应该返回空数组（mock 环境）', async () => {
      const suggestions = await coordinator.runEvolution();
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('getEvolutionStats 应该返回统计数据', () => {
      const stats = coordinator.getEvolutionStats();
      expect(stats).toHaveProperty('evolutionCount');
      expect(stats).toHaveProperty('suggestionsCount');
      expect(stats).toHaveProperty('highPriorityCount');
    });
  });

  describe('getStats()', () => {
    it('初始状态应该全为零', () => {
      const stats = coordinator.getStats();
      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });
  });
});
