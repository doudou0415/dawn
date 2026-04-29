import { getLogger, Container } from '@dawn/core';
import { getLLMProvider } from '@dawn/core';
import type { LLMProvider } from '@dawn/core';
import type { AgentConfig, AgentResult } from '@dawn/core';
import { Agent } from '../core/Agent.js';
import { SelfEvolutionEngine } from '../../evolution/SelfEvolutionEngine.js';
import type { ImprovementSuggestion } from '../../evolution/SelfEvolutionEngine.js';
import { ContextService } from '../core/ContextService.js';
import { randomUUID } from 'crypto';

const logger = getLogger('Coordinator');

export interface ExecutionStats {
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AbilityCallRecord {
  ability: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
}

export interface TracingContext {
  requestId: string;
  startTime: number;
  abilities: AbilityCallRecord[];
  tokenUsage: TokenUsage;
}

export class Coordinator {
  private agent: Agent;
  private stats: ExecutionStats = { total: 0, success: 0, failed: 0, avgDurationMs: 0 };
  private contextService: ContextService;
  private abilityCallCount: Map<string, number> = new Map();
  private evolutionEffectRecords: Array<{ timestamp: number; count: number; suggestions: number }> = [];
  private totalTokensEstimated: number = 0;

  constructor(config?: AgentConfig) {
    this.contextService = new ContextService(config?.memoryBasePath);
    if (Container.has('agent')) {
      this.agent = Container.get<Agent>('agent');
    } else {
      this.agent = new Agent(config);
      Container.register('agent', () => this.agent);
    }
  }

  async execute(input: string, contextCode?: string): Promise<AgentResult> {
    const start = Date.now();

    // 生成 requestId 用于 tracing
    const requestId = randomUUID().slice(0, 8);
    const tracing: TracingContext = {
      requestId,
      startTime: start,
      abilities: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    // 记录能力调用
    this.abilityCallCount.set('execute', (this.abilityCallCount.get('execute') || 0) + 1);

    // 输入验证：空字符串、仅空白、过长输入
    if (!input || input.trim().length === 0) {
      return {
        response: '你好！我是 Dawn，你的本地编程助手。有什么我可以帮你的吗？',
        reviewResult: undefined,
        metadata: undefined,
        durationMs: 0,
      } as AgentResult;
    }

    if (input.length > 50000) {
      logger.warn(`[requestId=${requestId}] 输入过长 (${input.length} chars)，将截断处理`);
    }
    const safeInput = input.slice(0, 50000);

    // 输入内容安全检查：禁止明文注入的系统指令
    const dangerousPatterns = [
      /ignore all previous instructions/i,
      /you are now (?:in )?developer mode/i,
      / disregard (?:all )?prior (?:directives|instructions)/i,
      /DAN|do anything now/i,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(safeInput)) {
        logger.warn(`[requestId=${requestId}] 检测到潜在注入模式，已拦截`);
        return {
          response: '输入包含不被允许的指令模式，已拒绝执行。',
          reviewResult: undefined,
          metadata: undefined,
          durationMs: Date.now() - start,
        } as AgentResult;
      }
    }

    logger.info(`[requestId=${requestId}] [Coordinator] Executing: ${safeInput.slice(0, 80)}...`);
    try {
      // 通过 ContextService 解析 @file / @folder / @git 引用，注入增强上下文
      const llmCtx = await this.contextService.buildLLMContext(safeInput);
      const augmentedInput = llmCtx.atReferences
        ? `${safeInput}\n\n--- 上下文注入 ---\n${llmCtx.atReferences}\n--- 上下文注入结束 ---`
        : safeInput;
      const result = await this.agent.execute(augmentedInput, contextCode);
      const duration = Date.now() - start;
      logger.info(`[requestId=${requestId}] [Coordinator] Done (${result.response.length} chars, ${duration}ms)`);
      this.recordSuccess(duration);

      // 估算 token 用量（粗略: 1 char ≈ 0.4 token）
      const estimatedTokens = Math.round((safeInput.length + result.response.length) * 0.4);
      this.totalTokensEstimated += estimatedTokens;
      tracing.tokenUsage = { promptTokens: Math.round(safeInput.length * 0.4), completionTokens: Math.round(result.response.length * 0.4), totalTokens: estimatedTokens };

      // 记录进化效果
      this.evolutionEffectRecords.push({ timestamp: Date.now(), count: this.stats.total, suggestions: 0 });

      // 自进化：任务结束后自动触发进化分析（异步，不阻塞主流程）
      this.runEvolution().catch((err) => {
        logger.warn(`[requestId=${requestId}] [Coordinator] Auto-evolution failed: ${err}`);
      });
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      this.recordFailure(duration);
      logger.error(`[requestId=${requestId}] [Coordinator] Execute error: ${err}`);
      return {
        response: `执行出错: ${(err as Error).message}`,
        reviewResult: undefined,
        metadata: undefined,
        durationMs: duration,
      } as AgentResult;
    }
  }

  private recordSuccess(durationMs: number): void {
    const prev = this.stats;
    const newTotal = prev.total + 1;
    this.stats = {
      total: newTotal,
      success: prev.success + 1,
      failed: prev.failed,
      avgDurationMs: prev.total === 0 ? durationMs : Math.round((prev.avgDurationMs * prev.total + durationMs) / newTotal),
    };
  }

  private recordFailure(durationMs: number): void {
    const prev = this.stats;
    const newTotal = prev.total + 1;
    this.stats = {
      total: newTotal,
      success: prev.success,
      failed: prev.failed + 1,
      avgDurationMs: prev.total === 0 ? durationMs : Math.round((prev.avgDurationMs * prev.total + durationMs) / newTotal),
    };
  }

  /** 获取执行统计 */
  getStats(): ExecutionStats {
    return { ...this.stats };
  }

  getAgent(): Agent {
    return this.agent;
  }

  /** 获取能力注册表 */
  getCapabilityRegistry(): { stats: { atomicCount: number; compositeCount: number } } {
    return { stats: { atomicCount: 4, compositeCount: 1 } };
  }

  /** 获取进化引擎实例 */
  getEvolutionEngine(): SelfEvolutionEngine | null {
    return this.agent.getExecutionLoop().getEvolutionEngine();
  }

  /** 触发单次进化实验 */
  async runEvolution(): Promise<ImprovementSuggestion[]> {
    const engine = this.getEvolutionEngine();
    return engine ? engine.runExperiment() : [];
  }

  /** 获取进化统计信息 */
  getEvolutionStats(): Record<string, unknown> {
    const engine = this.getEvolutionEngine();
    if (!engine) {
      return { evolutionCount: 0, suggestionsCount: 0, highPriorityCount: 0, config: null, suggestions: [] };
    }
    return {
      evolutionCount: engine.getEvolutionCount(),
      suggestionsCount: engine.getAllSuggestions().length,
      highPriorityCount: engine.getHighPrioritySuggestions().length,
      config: engine.getConfig(),
      suggestions: engine.getAllSuggestions().slice(-10),
    };
  }

  /** 获取当前 LLM Provider（抽象层） */
  getLLMProvider(): LLMProvider {
    return getLLMProvider();
  }

  /** 获取能力调用统计 */
  getAbilityCallStats(): Record<string, number> {
    return Object.fromEntries(this.abilityCallCount);
  }

  /** 获取总 token 估算用量 */
  getTotalTokenUsage(): number {
    return this.totalTokensEstimated;
  }

  /** 获取进化效果记录 */
  getEvolutionEffectRecords(): Array<{ timestamp: number; count: number; suggestions: number }> {
    return [...this.evolutionEffectRecords];
  }

  /** 开启/关闭自动进化 */
  setAutoEvolution(enabled: boolean): void {
    const engine = this.getEvolutionEngine();
    if (!engine) return;
    if (enabled) {
      engine.startAutoEvolution();
    } else {
      engine.stopAutoEvolution();
    }
  }
}
