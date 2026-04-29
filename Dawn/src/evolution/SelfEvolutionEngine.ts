/**
 * SelfEvolutionEngine — 自进化引擎总控
 *
 * 统一 Orchestrator，协调 evaluator → mutator → selector → archivist 完整闭环。
 * 保持与旧版 SelfEvolutionEngine 接口向后兼容。
 */

import { EvolutionSandbox } from './sandbox/EvolutionSandbox';
import { PerformanceEvaluator, type EvaluationInput, type EvaluationResult } from './evaluator/PerformanceEvaluator';
import { CodeMutator, PromptMutator, WorkflowMutator } from './mutator';
import { getLogger } from '@dawn/core';
const logger = getLogger('SelfEvolutionEngine');
import { EvolutionSelector, type SelectableCandidate } from './selector/EvolutionSelector';
import { VersionArchivist, type VersionEntry, type DiffRecord } from './archivist/VersionArchivist';
import { SkillGenerator, getSkillGenerator } from './skillGenerator';

export interface TaskAnalysis {
  id: string;
  description: string;
  toolsUsed: string[];
  stepsTaken: string[];
  success: boolean;
  duration: number;
  createdAt: string;
  completedAt: string;
  keywords: string[];
}

export interface ImprovementSuggestion {
  id: string;
  taskId: string;
  type: 'skill' | 'workflow' | 'tool' | 'memory' | 'code' | 'prompt';
  description: string;
  priority: 'low' | 'medium' | 'high';
  implementation: string;
  createdAt: string;
}

export interface EvolutionConfig {
  /** 是否启用自动进化 */
  autoEvolve: boolean;
  /** 进化间隔（毫秒） */
  evolutionIntervalMs: number;
  /** 每次进化保留的候选数 */
  topK: number;
  /** 探索率 0-1 */
  explorationRate: number;
  /** 是否启用沙箱保护 */
  sandboxEnabled: boolean;
}

const DEFAULT_CONFIG: EvolutionConfig = {
  autoEvolve: false,
  evolutionIntervalMs: 3600000, // 1 小时
  topK: 5,
  explorationRate: 0.15,
  sandboxEnabled: true,
};

export class SelfEvolutionEngine {
  private taskHistory: TaskAnalysis[] = [];
  private suggestions: ImprovementSuggestion[] = [];
  private skillGenerator: SkillGenerator;
  private evaluator: PerformanceEvaluator;
  private codeMutator: CodeMutator;
  private promptMutator: PromptMutator;
  private workflowMutator: WorkflowMutator;
  private selector: EvolutionSelector;
  private archivist: VersionArchivist;
  private sandbox: EvolutionSandbox;
  private config: EvolutionConfig;
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;
  private evolutionCount = 0;

  constructor(config: Partial<EvolutionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.skillGenerator = getSkillGenerator();
    this.evaluator = new PerformanceEvaluator();
    this.codeMutator = new CodeMutator();
    this.promptMutator = new PromptMutator();
    this.workflowMutator = new WorkflowMutator();
    this.selector = new EvolutionSelector({
      topK: this.config.topK,
      explorationRate: this.config.explorationRate,
    });
    this.archivist = new VersionArchivist();
    this.sandbox = new EvolutionSandbox();
  }

  // ============ 旧版兼容接口 ============

  async analyzeTask(task: TaskAnalysis): Promise<ImprovementSuggestion[]> {
    this.taskHistory.push(task);
    const suggestions: ImprovementSuggestion[] = [];

    if (task.toolsUsed.length >= 3 && task.success) {
      const skillSuggestion = await this.generateSkillSuggestion(task);
      if (skillSuggestion) suggestions.push(skillSuggestion);
      const skill = await this.skillGenerator.generateSkillFromTask(task);
      if (skill) logger.info(`生成新技能: ${skill.name}`);
    }

    const workflowSuggestion = await this.analyzeWorkflow(task);
    if (workflowSuggestion) suggestions.push(workflowSuggestion);

    const toolSuggestion = await this.analyzeToolUsage(task);
    if (toolSuggestion) suggestions.push(toolSuggestion);

    const memorySuggestion = await this.analyzeMemoryStorage(task);
    if (memorySuggestion) suggestions.push(memorySuggestion);

    // 新版：使用 evaluator 进行量化评估
    const evalInput: EvaluationInput = {
      taskId: task.id,
      taskDescription: task.description,
      success: task.success,
      executionDurationMs: task.duration,
      toolsUsed: task.toolsUsed,
      stepsTaken: task.stepsTaken,
      createdAt: task.createdAt,
    };
    const evalResult = this.evaluator.evaluate(evalInput);

    // 高分任务自动触发一次完整进化闭环
    if (evalResult.overallScore >= 70 && this.config.autoEvolve) {
      const evolved = await this.evolveFromTask(task, evalResult);
      suggestions.push(...evolved);
    }

    this.suggestions.push(...suggestions);
    await this.saveToMemory(task, suggestions);

    return suggestions;
  }

  // ============ 新版核心进化闭环 ============

  /**
   * 完整进化闭环：analyzeTask → evaluate → mutate → select → archive
   */
  async evolveFromTask(task: TaskAnalysis, evaluation?: EvaluationResult): Promise<ImprovementSuggestion[]> {
    const evalResult = evaluation ?? this.evaluator.evaluate({
      taskId: task.id,
      taskDescription: task.description,
      success: task.success,
      executionDurationMs: task.duration,
      toolsUsed: task.toolsUsed,
      stepsTaken: task.stepsTaken,
      createdAt: task.createdAt,
    });

    const suggestions: ImprovementSuggestion[] = [];

    // 1. 变异阶段
    const mutationResults = await this.mutate(task, evalResult);

    // 2. 评估变异候选
    for (const mut of mutationResults) {
      const candidate: SelectableCandidate = {
        id: `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        score: evalResult.overallScore,
        description: mut.description,
        type: mut.type === 'code' ? 'code' : mut.type === 'prompt' ? 'prompt' : 'workflow',
        tags: [...task.keywords, mut.type],
        createdAt: new Date().toISOString(),
      };

      const selected = this.selector.select([candidate]);
      if (selected.length > 0) {
        // 3. 存档阶段
        const versionEntry: VersionEntry = {
          versionId: candidate.id,
          parentVersionId: null,
          timestamp: candidate.createdAt,
          description: candidate.description,
          candidateType: candidate.type,
          sourcePath: task.description,
          content: JSON.stringify(candidate),
          score: candidate.score,
          tags: candidate.tags,
          metadata: { taskId: task.id },
        };
        await this.archivist.archive(versionEntry);

        suggestions.push({
          id: candidate.id,
          taskId: task.id,
          type: mut.type as any,
          description: mut.description,
          priority: candidate.score >= 80 ? 'high' : 'medium',
          implementation: `已存档为版本 ${candidate.id}`,
          createdAt: candidate.createdAt,
        });
      }
    }

    this.evolutionCount++;
    return suggestions;
  }

  /**
   * 执行定时进化
   */
  startAutoEvolution(intervalMs?: number): void {
    if (this.evolutionTimer) return;
    const interval = intervalMs ?? this.config.evolutionIntervalMs;

    this.evolutionTimer = setInterval(async () => {
      if (this.taskHistory.length === 0) return;

      // 对最近的任务执行进化
      const latestTask = this.taskHistory[this.taskHistory.length - 1]!;
      await this.evolveFromTask(latestTask);
    }, interval);
  }

  /**
   * 停止定时进化
   */
  stopAutoEvolution(): void {
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
      this.evolutionTimer = null;
    }
  }

  /**
   * 按需执行一次进化实验（使用当前任务历史）
   */
  async runExperiment(taskFilter?: (t: TaskAnalysis) => boolean): Promise<ImprovementSuggestion[]> {
    const tasks = taskFilter ? this.taskHistory.filter(taskFilter) : this.taskHistory;
    if (tasks.length === 0) return [];

    const allSuggestions: ImprovementSuggestion[] = [];
    for (const task of tasks) {
      const suggestions = await this.evolveFromTask(task);
      allSuggestions.push(...suggestions);
    }
    return allSuggestions;
  }

  // ============ 访问器 ============

  getAllSuggestions(): ImprovementSuggestion[] {
    return [...this.suggestions];
  }

  getHighPrioritySuggestions(): ImprovementSuggestion[] {
    return this.suggestions.filter(s => s.priority === 'high');
  }

  clearOldSuggestions(days: number = 30): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    this.suggestions = this.suggestions.filter(s => new Date(s.createdAt) > cutoff);
  }

  getConfig(): Readonly<EvolutionConfig> {
    return { ...this.config };
  }

  getEvolutionCount(): number {
    return this.evolutionCount;
  }

  getEvaluator(): PerformanceEvaluator {
    return this.evaluator;
  }

  getArchivist(): VersionArchivist {
    return this.archivist;
  }

  getSandbox(): EvolutionSandbox {
    return this.sandbox;
  }

  getSelector(): EvolutionSelector {
    return this.selector;
  }

  updateConfig(config: Partial<EvolutionConfig>): void {
    this.config = { ...this.config, ...config };
    this.selector.updateConfig({
      topK: this.config.topK,
      explorationRate: this.config.explorationRate,
    });
  }

  // ============ 内部方法 ============

  private async mutate(task: TaskAnalysis, evalResult: EvaluationResult): Promise<
    Array<{ type: string; description: string; content: string }>
  > {
    const results: Array<{ type: string; description: string; content: string }> = [];

    // 沙箱验证
    if (this.config.sandboxEnabled) {
      const check = this.sandbox.validate('write', 'src/evolution/experiments');
      if (!check.allowed) return results;
    }

    // 代码变异
    if (task.toolsUsed.includes('code_generation') || task.toolsUsed.includes('code_review')) {
      const codeMutant = this.codeMutator.pointMutation({
        sourceCode: JSON.stringify(task, null, 2),
        filePath: `experiments/task-${task.id}.ts`,
        language: 'typescript',
      });
      results.push({
        type: 'code',
        description: codeMutant.description,
        content: codeMutant.mutatedCode,
      });
    }

    // 提示词变异
    const promptMutant = this.promptMutator.wordingMutation({
      prompt: task.description,
      category: 'user',
    });
    if (promptMutant.changedTokens > 0) {
      results.push({
        type: 'prompt',
        description: promptMutant.description,
        content: promptMutant.mutatedPrompt,
      });
    }

    // 工作流变异（步骤较多时）
    if (task.stepsTaken.length >= 3) {
      const workflowSteps = task.stepsTaken.map((step, i) => ({
        id: `step-${i}`,
        name: step.substring(0, 30),
        tool: task.toolsUsed[i % task.toolsUsed.length] || 'unknown',
        description: step,
        dependsOn: i > 0 ? [`step-${i - 1}`] : [],
      }));

      const reorderResult = this.workflowMutator.reorderMutation({
        workflowId: `wf-${task.id}`,
        steps: workflowSteps,
        workflowPrompt: task.description,
      });
      results.push({
        type: 'workflow',
        description: reorderResult.description,
        content: JSON.stringify(reorderResult.mutatedSteps),
      });
    }

    return results;
  }

  private async generateSkillSuggestion(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    const similarTasks = this.findSimilarTasks(task);
    if (similarTasks.length >= 1) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'skill',
        description: `检测到重复任务模式: "${task.description.substring(0, 50)}..."，建议生成可复用技能`,
        priority: 'high',
        implementation: '调用 SkillGenerator 从任务历史生成新技能',
        createdAt: new Date().toISOString(),
      };
    }
    return null;
  }

  private async analyzeWorkflow(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    if (task.stepsTaken.length > 10) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'workflow',
        description: `任务步骤过多 (${task.stepsTaken.length}步)，建议优化工作流`,
        priority: 'medium',
        implementation: '合并相关步骤，减少工具调用次数',
        createdAt: new Date().toISOString(),
      };
    }
    return null;
  }

  private async analyzeToolUsage(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    const toolCount = task.toolsUsed.length;
    const uniqueTools = new Set(task.toolsUsed).size;
    if (toolCount > 5 && uniqueTools < toolCount * 0.5) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'tool',
        description: '工具使用重复率高，建议优化工具调用模式',
        priority: 'low',
        implementation: '分析工具调用序列，寻找优化机会',
        createdAt: new Date().toISOString(),
      };
    }
    return null;
  }

  private async analyzeMemoryStorage(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    const hasImportantKeywords = task.keywords.some(kw =>
      ['fix', 'bug', 'error', 'security', 'performance', 'refactor', 'optimization', 'code_quality'].includes(kw.toLowerCase())
    );
    if (hasImportantKeywords && task.success) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'memory',
        description: '任务包含重要关键词，建议存入长期记忆',
        priority: 'medium',
        implementation: '将任务结果保存到 .dawn-memory/reference/',
        createdAt: new Date().toISOString(),
      };
    }
    return null;
  }

  private findSimilarTasks(task: TaskAnalysis): TaskAnalysis[] {
    return this.taskHistory.filter(t =>
      t.id !== task.id && this.calculateTaskSimilarity(t, task) > 0.6
    );
  }

  private calculateTaskSimilarity(task1: TaskAnalysis, task2: TaskAnalysis): number {
    const keywords1 = new Set(task1.keywords);
    const keywords2 = new Set(task2.keywords);
    const intersection = [...keywords1].filter(k => keywords2.has(k)).length;
    const union = new Set([...keywords1, ...keywords2]).size;
    return union > 0 ? intersection / union : 0;
  }

  private async saveToMemory(task: TaskAnalysis, suggestions: ImprovementSuggestion[]): Promise<void> {
    const { writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const memoryContent = `# 任务分析报告
## 任务信息
- ID: ${task.id}
- 描述: ${task.description}
- 完成时间: ${task.completedAt}
- 成功率: ${task.success ? '成功' : '失败'}
- 耗时: ${task.duration}ms

## 工具使用
${task.toolsUsed.map(tool => `- ${tool}`).join('\n')}

## 改进建议
${suggestions.map(s => `- [${s.priority.toUpperCase()}] ${s.description}`).join('\n')}

## 学习要点
${task.keywords.map(kw => `- ${kw}`).join('\n')}
`;
    const memoryDir = join(process.cwd(), '.dawn-memory', 'self-evolution');
    await mkdir(memoryDir, { recursive: true });
    const filename = `task-${task.id}-${new Date().toISOString().split('T')[0]}.md`;
    await writeFile(join(memoryDir, filename), memoryContent, 'utf-8');
  }
}
