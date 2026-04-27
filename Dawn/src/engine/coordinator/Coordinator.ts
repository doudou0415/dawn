import type { AgentConfig, AgentResult } from '../../../packages/core/src/types.js';
import { Container } from '../../../packages/core/src/Container.js';
import { Agent } from '../core/Agent.js';
import { SelfEvolutionEngine } from '../../evolution/SelfEvolutionEngine.js';
import type { ImprovementSuggestion } from '../../evolution/SelfEvolutionEngine.js';
import { logger } from '../../utils/index.js';

export interface ExecutionStats {
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
}

export class Coordinator {
  private agent: Agent;

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
    const result = await this.agent.execute(input, contextCode);
    logger.info(`[Coordinator] Done (${result.response.length} chars)`);

    // 自进化：任务结束后自动触发进化分析（异步，不阻塞主流程）
    this.runEvolution().catch((err) => {
      logger.warn(`[Coordinator] Auto-evolution failed: ${err}`);
    });

    return result;
  }

  /** 获取执行统计 */
  getStats(): ExecutionStats {
    return {
      total: 0,
      success: 0,
      failed: 0,
      avgDurationMs: 0,
    };
  }

  getAgent(): Agent {
    return this.agent;
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
