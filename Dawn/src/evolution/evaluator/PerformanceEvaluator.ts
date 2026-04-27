/**
 * PerformanceEvaluator — 多维度表现评估
 *
 * 评估维度：
 * - 成功率 (successRate)
 * - 用户满意度 (userSatisfaction)
 * - 执行耗时 (executionTime)
 * - 代码质量 (codeQuality)
 * - 记忆使用效率 (memoryEfficiency)
 * - 工具使用效率 (toolEfficiency)
 */

export interface EvaluationWeights {
  successRate: number;        // 0-1
  userSatisfaction: number;   // 0-1
  executionTime: number;      // 0-1 (耗时越低分越高)
  codeQuality: number;        // 0-1
  memoryEfficiency: number;   // 0-1
  toolEfficiency: number;     // 0-1
}

export interface EvaluationInput {
  taskId: string;
  taskDescription: string;
  success: boolean;
  userRating?: number;        // 0-5
  executionDurationMs: number;
  expectedDurationMs?: number;
  toolsUsed: string[];
  stepsTaken: string[];
  codeChanges?: {
    linesAdded: number;
    linesRemoved: number;
    hasTests: boolean;
    hasErrors: boolean;
  };
  memoryAccessCount?: number;
  memoryHitRate?: number;     // 0-1
  createdAt: string;
}

export interface EvaluationResult {
  taskId: string;
  overallScore: number;        // 0-100
  dimensions: {
    successRate: number;
    userSatisfaction: number;
    executionTime: number;
    codeQuality: number;
    memoryEfficiency: number;
    toolEfficiency: number;
  };
  weights: EvaluationWeights;
  timestamp: string;
  suggestions: string[];
  details: Record<string, number>;
}

const DEFAULT_WEIGHTS: EvaluationWeights = {
  successRate: 0.30,
  userSatisfaction: 0.20,
  executionTime: 0.15,
  codeQuality: 0.15,
  memoryEfficiency: 0.10,
  toolEfficiency: 0.10,
};

export class PerformanceEvaluator {
  private weights: EvaluationWeights;
  private history: EvaluationResult[] = [];

  constructor(weights: Partial<EvaluationWeights> = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * 评估单次任务表现
   */
  evaluate(input: EvaluationInput): EvaluationResult {
    const successRate = this.scoreSuccessRate(input);
    const userSatisfaction = this.scoreUserSatisfaction(input);
    const executionTime = this.scoreExecutionTime(input);
    const codeQuality = this.scoreCodeQuality(input);
    const memoryEfficiency = this.scoreMemoryEfficiency(input);
    const toolEfficiency = this.scoreToolEfficiency(input);

    const overallScore = Math.round(
      successRate * this.weights.successRate +
      userSatisfaction * this.weights.userSatisfaction +
      executionTime * this.weights.executionTime +
      codeQuality * this.weights.codeQuality +
      memoryEfficiency * this.weights.memoryEfficiency +
      toolEfficiency * this.weights.toolEfficiency
    );

    const suggestions = this.generateSuggestions({
      successRate, userSatisfaction, executionTime,
      codeQuality, memoryEfficiency, toolEfficiency,
    });

    const result: EvaluationResult = {
      taskId: input.taskId,
      overallScore,
      dimensions: { successRate, userSatisfaction, executionTime, codeQuality, memoryEfficiency, toolEfficiency },
      weights: this.weights,
      timestamp: new Date().toISOString(),
      suggestions,
      details: { successRate, userSatisfaction, executionTime, codeQuality, memoryEfficiency, toolEfficiency },
    };

    this.history.push(result);
    return result;
  }

  /**
   * 批量评估
   */
  evaluateBatch(inputs: EvaluationInput[]): EvaluationResult[] {
    return inputs.map(i => this.evaluate(i));
  }

  /**
   * 获取历史评估结果
   */
  getHistory(): EvaluationResult[] {
    return [...this.history];
  }

  /**
   * 获取平均分（最新 N 条）
   */
  getAverageScore(latest: number = 10): number {
    const slice = this.history.slice(-latest);
    if (slice.length === 0) return 0;
    return Math.round(slice.reduce((sum, r) => sum + r.overallScore, 0) / slice.length);
  }

  /**
   * 更新权重
   */
  updateWeights(weights: Partial<EvaluationWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  private scoreSuccessRate(input: EvaluationInput): number {
    return input.success ? 100 : 0;
  }

  private scoreUserSatisfaction(input: EvaluationInput): number {
    if (input.userRating !== undefined) {
      return (input.userRating / 5) * 100;
    }
    // 无显式评分时，用成功率作为近似
    return input.success ? 70 : 20;
  }

  private scoreExecutionTime(input: EvaluationInput): number {
    if (!input.expectedDurationMs) {
      // 没有预期值时，2000ms = 50分，4000ms = 25分，依此类推
      return Math.max(0, 100 - (input.executionDurationMs / 2000) * 50);
    }
    const ratio = input.executionDurationMs / input.expectedDurationMs;
    if (ratio <= 0.5) return 100;
    if (ratio <= 1.0) return 100 - (ratio - 0.5) * 100; // 0.5→100, 1.0→50
    return Math.max(0, 50 - (ratio - 1.0) * 50); // 1.0→50, 2.0→0
  }

  private scoreCodeQuality(input: EvaluationInput): number {
    if (!input.codeChanges) return 50; // 中性

    const changes = input.codeChanges;
    let score = 60; // 基础分

    // 有测试加 20 分
    if (changes.hasTests) score += 20;
    // 有错误扣 30 分
    if (changes.hasErrors) score -= 30;
    // 删除多于新增（重构信号）加 10 分
    if (changes.linesRemoved > changes.linesAdded) score += 10;
    // 超大 diff 扣分（可能不聚焦）
    if (changes.linesAdded > 500) score -= 15;

    return Math.max(0, Math.min(100, score));
  }

  private scoreMemoryEfficiency(input: EvaluationInput): number {
    if (input.memoryHitRate !== undefined) {
      return input.memoryHitRate * 100;
    }
    // 没有精确命中率时，用访问次数估计
    if (input.memoryAccessCount === undefined) return 50;
    if (input.memoryAccessCount === 0) return 30; // 没使用记忆
    if (input.memoryAccessCount <= 3) return 70;  // 适度使用
    if (input.memoryAccessCount <= 10) return 85; // 充分使用
    return 60; // 访问过多可能有冗余
  }

  private scoreToolEfficiency(input: EvaluationInput): number {
    const toolCount = input.toolsUsed.length;
    const uniqueTools = new Set(input.toolsUsed).size;

    if (toolCount === 0) return 0;
    if (toolCount === 1) return 50;

    // 多样性比率越高越好
    const diversityRatio = uniqueTools / toolCount;
    let score = diversityRatio * 100;

    // 步骤 vs 工具比率
    const stepsPerTool = input.stepsTaken.length / toolCount;
    if (stepsPerTool < 1.5) score -= 20; // 工具切换太频繁
    if (stepsPerTool > 8) score -= 10;   // 单个工具用太多步

    return Math.max(0, Math.min(100, score));
  }

  private generateSuggestions(dims: Record<string, number>): string[] {
    const suggestions: string[] = [];
    const threshold = 50;

    const successRate = dims.successRate ?? 0;
    const executionTime = dims.executionTime ?? 0;
    const codeQuality = dims.codeQuality ?? 0;
    const memoryEfficiency = dims.memoryEfficiency ?? 0;
    const toolEfficiency = dims.toolEfficiency ?? 0;

    if (successRate < threshold) {
      suggestions.push('成功率低 — 检查任务理解与执行流程是否存在偏差');
    }
    if (executionTime < threshold) {
      suggestions.push('执行耗时长 — 考虑减少工具调用次数或合并步骤');
    }
    if (codeQuality < threshold) {
      suggestions.push('代码质量偏低 — 建议增加测试覆盖并检查代码规范');
    }
    if (memoryEfficiency < threshold) {
      suggestions.push('记忆利用率低 — 建议优化记忆检索策略');
    }
    if (toolEfficiency < threshold) {
      suggestions.push('工具使用效率低 — 建议减少冗余工具调用');
    }

    return suggestions;
  }
}
