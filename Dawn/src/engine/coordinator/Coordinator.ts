import { getLogger } from '@dawn/core';
const logger = getLogger('Coordinator');
import { Container } from '@dawn/core';
import { Agent } from '../core/Agent.js';
import { SelfEvolutionEngine } from '../../evolution/SelfEvolutionEngine.js';
import type { ImprovementSuggestion } from '../../evolution/SelfEvolutionEngine.js';
import type { AgentConfig, AgentResult } from '@dawn/core';

export interface ExecutionStats {
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
}

export class Coordinator {
  private agent: Agent;
  private stats: ExecutionStats = { total: 0, success: 0, failed: 0, avgDurationMs: 0 };

  constructor(config?: AgentConfig) {
    if (Container.has('agent')) {
      this.agent = Container.get<Agent>('agent');
    } else {
      this.agent = new Agent(config);
      Container.register('agent', () => this.agent);
    }
  }

  async execute(input: string, contextCode?: string): Promise<AgentResult> {
    logger.info(`[Coordinator] Executing: ${input.slice(0, 80)}...`);
    const start = Date.now();
    try {
      const result = await this.agent.execute(input, contextCode);
      logger.info(`[Coordinator] Done (${result.response.length} chars)`);
      this.recordSuccess(Date.now() - start);
      // 自进化：任务结束后自动触发进化分析（异步，不阻塞主流程）
      this.runEvolution().catch((err) => {
        logger.warn(`[Coordinator] Auto-evolution failed: ${err}`);
      });
      return result;
    } catch (err) {
      this.recordFailure(Date.now() - start);
      logger.error(`[Coordinator] Execute error: ${err}`);
      return {
        response: `执行出错: ${(err as Error).message}`,
        reviewResult: undefined,
        metadata: undefined,
        durationMs: Date.now() - start,
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
