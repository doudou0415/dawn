/**
 * EvolutionEngine — 自进化引擎
 * Dawn 核心竞争力：从执行历史中学习，优化自身行为。
 * 策略：频率分析、失败模式识别、能力调优建议。
 */

import type { ExecutionContext } from '../engine/Orchestrator';

export interface EvolutionInsight {
  type: 'pattern' | 'optimization' | 'warning' | 'suggestion';
  source: string;
  description: string;
  confidence: number;
  timestamp: number;
  actionable: boolean;
}

interface EvolutionConfig {
  minObservations: number;
  analysisIntervalMs: number;
}

export class EvolutionEngine {
  private observations: ExecutionContext[] = [];
  private insights: EvolutionInsight[] = [];
  private config: Required<EvolutionConfig>;
  private lastAnalysisTime = 0;

  constructor(config?: Partial<EvolutionConfig>) {
    this.config = {
      minObservations: config?.minObservations ?? 10,
      analysisIntervalMs: config?.analysisIntervalMs ?? 60000,
    };
  }

  /**
   * 观察一次执行结果
   */
  async observe(context: ExecutionContext): Promise<void> {
    this.observations.push(context);

    const now = Date.now();
    if (
      this.observations.length >= this.config.minObservations &&
      now - this.lastAnalysisTime >= this.config.analysisIntervalMs
    ) {
      await this.analyze();
      this.lastAnalysisTime = now;
    }
  }

  /**
   * 分析观察数据，生成洞察
   */
  private async analyze(): Promise<void> {
    const failed = this.observations.filter(o => {
      const result = o.result as Record<string, unknown>;
      return result?.success === false || result?.error;
    });

    const success = this.observations.filter(o => {
      const result = o.result as Record<string, unknown>;
      return result?.success === true;
    });

    const successRate = this.observations.length > 0
      ? (success.length / this.observations.length) * 100
      : 0;

    // 成功率分析
    this.insights.push({
      type: 'pattern',
      source: 'evolution_engine',
      description: `执行成功率: ${successRate.toFixed(1)}% (总 ${this.observations.length} 次, 失败 ${failed.length} 次)`,
      confidence: Math.min(this.observations.length / 50, 1),
      timestamp: Date.now(),
      actionable: successRate < 60,
    });

    // 失败模式识别
    const intentFailureCounts = new Map<string, number>();
    for (const f of failed) {
      const key = f.intent.type;
      intentFailureCounts.set(key, (intentFailureCounts.get(key) || 0) + 1);
    }

    for (const [intent, count] of intentFailureCounts) {
      if (count > 3) {
        this.insights.push({
          type: 'warning',
          source: 'evolution_engine',
          description: `意图 '${intent}' 连续失败 ${count} 次，可能需要检查对应能力实现`,
          confidence: 0.8,
          timestamp: Date.now(),
          actionable: true,
        });
      }
    }

    // 清理旧观察（保留最近 100 条）
    if (this.observations.length > 100) {
      this.observations = this.observations.slice(-100);
    }
  }

  /**
   * 获取洞察
   */
  async getInsights(): Promise<EvolutionInsight[]> {
    return [...this.insights];
  }

  /**
   * 获取统计摘要
   */
  async getStats(): Promise<Record<string, unknown>> {
    const intentCounts = new Map<string, number>();
    for (const o of this.observations) {
      intentCounts.set(o.intent.type, (intentCounts.get(o.intent.type) || 0) + 1);
    }

    return {
      totalObservations: this.observations.length,
      totalInsights: this.insights.length,
      intentDistribution: Object.fromEntries(intentCounts),
      lastAnalysis: this.lastAnalysisTime ? new Date(this.lastAnalysisTime).toISOString() : null,
    };
  }
}
