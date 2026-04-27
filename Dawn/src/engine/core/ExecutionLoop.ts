import crypto from 'node:crypto';

import type {
  AgentConfig,
  AgentResult,
  ConversationContext,
  EvolutionTask,
  ReviewResult,
  ToolCall,
  ToolPerformance,
} from '../../../packages/core/src/types.js';
import { DialogueStateType, TaskCategory } from '../../../packages/core/src/types.js';
import { callDeepSeek, SYSTEM_PROMPT } from './LLMProvider.js';
import { EmotionDetector } from './EmotionDetector.js';
import { ResponseGenerator } from './ResponseGenerator.js';
import { HistoryManager } from './HistoryManager.js';
import { SelfEvolutionEngine } from '../../evolution/SelfEvolutionEngine.js';
import { MemorySystem } from '../../memory/MemorySystem.js';
import { looksLikeToolTask } from '../intent/IntentEngine.js';
import { getLogger } from '../../../packages/core/src/Logger.js';

const log = getLogger('ExecutionLoop');

// ================================================================
// ReviewResult (module-level) — 内联 actualReview
// ================================================================

function actualReview(code: string): ReviewResult {
  const issues: Array<{ severity: string; message: string }> = [];
  const lines = code.split('\n');
  let score = 100;
  for (let i = 0; i < lines.length; i++) {
    const line: string = lines[i] ?? '';
    const lineNum = i + 1;
    if (line.includes('as any') || line.match(/: any\b/)) {
      issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 使用了 any 类型` });
      score -= 5;
    }
    if (line.includes('console.log')) {
      issues.push({ severity: 'info', message: `第 ${lineNum} 行: console.log 残留` });
      score -= 2;
    }
    if (line.match(/catch\s*\(/i) && line.includes('{}')) {
      issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 空的 catch 块` });
      score -= 5;
    }
    if (line.length > 120) {
      issues.push({ severity: 'info', message: `第 ${lineNum} 行: 行过长 (${line.length} 字符)` });
      score -= 1;
    }
    if (line.match(/\bvar\s+/)) {
      issues.push({ severity: 'warning', message: `第 ${lineNum} 行: 使用了 var` });
      score -= 5;
    }
    if (line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) {
      issues.push({ severity: 'info', message: `第 ${lineNum} 行: 未完成的标记` });
      score -= 3;
    }
  }
  return { score: Math.max(0, score), issues };
}

export const SmartCodeReviewer = { review: actualReview };

// ================================================================
// ExecutionLoop — Agent 执行主循环
// ================================================================

export class ExecutionLoop {
  private config: AgentConfig;
  private responseGen: ResponseGenerator;
  private historyMgr: HistoryManager;
  private emotionDetector: EmotionDetector;
  private evolutionEngine: SelfEvolutionEngine | null;
  private memorySystem: MemorySystem | null;
  private ctx: ConversationContext;
  private toolsUsed: string[] = [];
  private toolCallHistory: ToolCall[] = [];
  private toolPerformance: Map<string, ToolPerformance> = new Map();
  /** 外部可覆盖 system prompt（如注入权限信息） */
  public systemPromptOverride: string | null = null;
  /** 代码审查器（静态引用，便于测试/外部使用） */
  static SmartCodeReviewer = SmartCodeReviewer;

  constructor(
    config: AgentConfig,
    emotionDetector: EmotionDetector,
    responseGen: ResponseGenerator,
    historyMgr: HistoryManager,
    context: ConversationContext,
    memorySystem?: MemorySystem,
    evolutionEngine?: SelfEvolutionEngine,
  ) {
    this.config = config;
    this.emotionDetector = emotionDetector;
    this.responseGen = responseGen;
    this.historyMgr = historyMgr;
    this.ctx = context;
    this.memorySystem = memorySystem ?? null;
    this.evolutionEngine = evolutionEngine ?? null;
  }

  // ================================================================
  // 主执行循环
  // ================================================================

  async execute(
    task: string,
    code?: string,
    originalInput?: string,
  ): Promise<AgentResult> {
    const trimmedTask = task.trim();
    const dialogueInput = (originalInput || task).trim();

    // 尝试加载相关记忆
    let memorySummary: string | undefined;
    if (this.memorySystem) {
      try {
        const memCtx = await this.memorySystem.getRelevantMemories({
          text: trimmedTask,
          limit: 3,
        });
        memorySummary = memCtx.summary;
        for (const entry of memCtx.persistent) {
          this.ctx.entityMemory.set(`mem_${entry.key}`, JSON.stringify(entry.value));
        }
        for (const entry of memCtx.skill) {
          this.ctx.entityMemory.set(`skill_${entry.key}`, JSON.stringify(entry.value));
        }
      } catch {
        // 记忆加载失败不影响主流程
      }
    }

    // 记录用户消息到对话历史
    if (this.config.enableConversationHistory) {
      this.historyMgr.addToConversationHistory('user', trimmedTask, {
        task: trimmedTask,
        code,
      });
    }

    if (!trimmedTask) {
      const response = '你好！有什么可以帮助你的吗？';
      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }
      return { response, reviewResult: undefined };
    }

    // ===== 优先尝试 DeepSeek V4 LLM 调用 =====
    const effectiveSystemPrompt = this.systemPromptOverride ?? SYSTEM_PROMPT;
    const isToolTask = looksLikeToolTask(trimmedTask);
    const llmResponse = await callDeepSeek([
      { role: 'system', content: effectiveSystemPrompt },
      ...this.ctx.messages
        .slice(-6)
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
      { role: 'user', content: trimmedTask },
    ]);

    if (llmResponse) {
      this.toolsUsed.push('deepseek_v4');

      // ===== 对话函数：任务类请求走 预检→执行→验证→结论 =====
      if (isToolTask) {
        const result = await this.executeWithVerification(trimmedTask, llmResponse);
        if (this.config.enableConversationHistory) {
          this.historyMgr.addToConversationHistory('assistant', result.response, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed,
          });
        }
        // 保存执行记录到记忆系统
        if (this.memorySystem) {
          const { TaskCategory } = await import('../../../packages/core/src/types.js');
          this.memorySystem
            .recordExecution({
              task: trimmedTask,
              category: TaskCategory.General,
              confidence: result.verified ? 0.95 : 0.6,
              success: result.verified,
              duration: 0,
              generatedCode: '',
            })
            .catch(() => {});
        }
        return { response: result.response, reviewResult: undefined };
      }

      // 普通对话 —— 直接返回 LLM 回复
      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', llmResponse, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }
      // 保存执行记录到记忆系统
      if (this.memorySystem) {
        const { TaskCategory } = await import('../../../packages/core/src/types.js');
        this.memorySystem
          .recordExecution({
            task: trimmedTask,
            category: TaskCategory.General,
            confidence: 0.95,
            success: true,
            duration: 0,
            generatedCode: '',
          })
          .catch(() => {});
      }
      return { response: llmResponse, reviewResult: undefined };
    }

    log.warn('LLM 不可用，回退本地规则');

    // —— 本地规则降级：问候/问题/代码生成/对话 ——
    // 1. 问候 -> 简短回应
    if (this.historyMgr.containsGreeting(dialogueInput) && dialogueInput.length < 20) {
      const response = '嗨，我是 Dawn。写代码、改代码、查问题都行，直接说。';
      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }
      return { response, reviewResult: undefined };
    }

    // 2. 代码生成/工具任务 / 问题 / 对话
    if (looksLikeToolTask(trimmedTask) || this.responseGen.isCodeGenerationRequest(trimmedTask)) {
      // 继续向下执行代码生成流程
    } else if (
      this.responseGen.isQuestion(trimmedTask) ||
      this.responseGen.isQuestionRequest(trimmedTask)
    ) {
      // 3. 技术问题 -> 直接回答
      const response = this.responseGen.answerQuestion(trimmedTask);
      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }
      return { response, reviewResult: undefined };
    } else {
      // 4. 其他对话 -> 简短自然回应
      const response = this.responseGen.generateConversationalResponse(
        trimmedTask,
        this.historyMgr,
      );
      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }
      return { response, reviewResult: undefined };
    }

    // 重置工具使用记录
    this.toolsUsed = [];

    let generatedCode = code || '';
    const userIntentLower = dialogueInput.toLowerCase();

    // 更新对话状态为任务执行
    if (this.config.enableAdvancedDialogue) {
      this.historyMgr.transitionDialogueState(DialogueStateType.TaskExecution, {
        intent: 'tool_task',
        task: trimmedTask,
        expectedInput: '工具执行结果反馈',
      });
    }

    // 使用原始用户输入判断意图
    if (this.responseGen.isQuestionRequest(userIntentLower)) {
      const startTime = Date.now();
      const response = this.responseGen.answerQuestion(trimmedTask);
      const endTime = Date.now();
      this.recordToolCall('question_answering', startTime, endTime, true);

      if (this.config.enableConversationHistory) {
        this.historyMgr.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed,
        });
      }

      if (this.config.enableAdvancedDialogue) {
        this.historyMgr.transitionDialogueState(DialogueStateType.FollowUp, {
          intent: 'question_answered',
          followUpQuestions: [
            '你还有其他问题吗？',
            '需要我进一步解释吗？',
            '还有其他功能需要了解吗？',
          ],
        });
      }

      return { response, reviewResult: undefined };
    }

    if (this.responseGen.isCodeGenerationRequest(userIntentLower)) {
      const startTime = Date.now();
      let codeGenSuccess = true;
      try {
        generatedCode = await this.responseGen.generateCodeFromTask(trimmedTask);
        const endTime = Date.now();
        this.recordToolCall('code_generation', startTime, endTime, true);
        this.toolsUsed.push('code_generation');

        if (this.memorySystem) {
          const { TaskCategory } = await import('../../../packages/core/src/types.js');
          this.memorySystem
            .recordExecution({
              task: trimmedTask,
              category: TaskCategory.CodeGeneration,
              confidence: 0.85,
              success: true,
              duration: endTime - startTime,
              generatedCode,
            })
            .catch(() => {});
        }
      } catch (error) {
        codeGenSuccess = false;
        const endTime = Date.now();
        this.recordToolCall(
          'code_generation',
          startTime,
          endTime,
          false,
          error instanceof Error ? error.message : String(error),
        );
        const errorResponse = `生成代码时出错: ${error instanceof Error ? error.message : String(error)}`;

        if (this.config.enableConversationHistory) {
          this.historyMgr.addToConversationHistory('assistant', errorResponse, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed,
          });
        }

        if (this.config.enableAdvancedDialogue) {
          this.historyMgr.transitionDialogueState(DialogueStateType.Error, {
            intent: 'code_generation_error',
            error: errorResponse,
          });
        }

        return { response: errorResponse };
      }
    } else if (this.responseGen.isCodeModificationRequest(userIntentLower)) {
      if (code) {
        const startTime = Date.now();
        try {
          generatedCode = await this.optimizeCode(code, trimmedTask);
          const endTime = Date.now();
          this.recordToolCall('code_optimization', startTime, endTime, true);
          this.toolsUsed.push('code_optimization');
        } catch (error) {
          const endTime = Date.now();
          this.recordToolCall(
            'code_optimization',
            startTime,
            endTime,
            false,
            error instanceof Error ? error.message : String(error),
          );
          const errorResponse = `优化代码时出错: ${error instanceof Error ? error.message : String(error)}`;

          if (this.config.enableConversationHistory) {
            this.historyMgr.addToConversationHistory('assistant', errorResponse, {
              task: trimmedTask,
              toolsUsed: this.toolsUsed,
            });
          }

          if (this.config.enableAdvancedDialogue) {
            this.historyMgr.transitionDialogueState(DialogueStateType.Error, {
              intent: 'code_optimization_error',
              error: errorResponse,
            });
          }

          return { response: errorResponse };
        }
      } else {
        const response = '请提供要修改的代码，或者明确说明你想要创建什么功能。';

        if (this.config.enableConversationHistory) {
          this.historyMgr.addToConversationHistory('assistant', response, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed,
          });
        }

        if (this.config.enableAdvancedDialogue) {
          this.historyMgr.transitionDialogueState(DialogueStateType.Clarification, {
            intent: 'missing_code',
            expectedInput: '用户提供代码',
          });
        }

        return { response };
      }
    } else {
      const startTime = Date.now();
      try {
        const response = this.responseGen.handleGeneralRequest(trimmedTask, code);
        const endTime = Date.now();
        this.recordToolCall('general_request', startTime, endTime, true);
        this.toolsUsed.push('general_request');

        if (this.config.enableConversationHistory) {
          this.historyMgr.addToConversationHistory('assistant', response, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed,
          });
        }

        if (this.config.enableAdvancedDialogue) {
          this.historyMgr.transitionDialogueState(DialogueStateType.FollowUp, {
            intent: 'general_request_completed',
            followUpQuestions: [
              '你还需要其他帮助吗？',
              '还有其他功能需要实现吗？',
              '需要我解释结果吗？',
            ],
          });
        }

        return { response };
      } catch (error) {
        const endTime = Date.now();
        this.recordToolCall(
          'general_request',
          startTime,
          endTime,
          false,
          error instanceof Error ? error.message : String(error),
        );
        const errorResponse = `处理请求时出错: ${error instanceof Error ? error.message : String(error)}`;

        if (this.config.enableConversationHistory) {
          this.historyMgr.addToConversationHistory('assistant', errorResponse, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed,
          });
        }

        if (this.config.enableAdvancedDialogue) {
          this.historyMgr.transitionDialogueState(DialogueStateType.Error, {
            intent: 'general_request_error',
            error: errorResponse,
          });
        }

        return { response: errorResponse };
      }
    }

    const response = generatedCode
      ? this.responseGen.formatCodeResponse(trimmedTask, generatedCode)
      : `收到：${trimmedTask}。我先检查现有代码和环境，验证后再回复。`;

    let reviewResult: ReviewResult | undefined;
    if (generatedCode && this.config.enableSelfReview) {
      const startTime = Date.now();
      try {
        reviewResult = SmartCodeReviewer.review(generatedCode);
        const endTime = Date.now();
        this.recordToolCall('code_review', startTime, endTime, true);
        this.toolsUsed.push('code_review');
      } catch (error) {
        const endTime = Date.now();
        this.recordToolCall(
          'code_review',
          startTime,
          endTime,
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (reviewResult && this.evolutionEngine) {
      const analysis = {
        id: crypto.randomUUID(),
        description: trimmedTask,
        toolsUsed: this.toolsUsed,
        stepsTaken: [
          '分析任务',
          ...(generatedCode ? ['生成/优化代码'] : []),
          ...(reviewResult ? ['代码审查'] : []),
          '返回结果',
        ],
        success: (reviewResult.score || 0) >= 90,
        duration: 0,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        keywords: trimmedTask.split(/\s+/).slice(0, 10),
      };
      void this.evolutionEngine.analyzeTask(analysis).catch(() => {});
    }

    if (this.config.enableConversationHistory) {
      this.historyMgr.addToConversationHistory('assistant', response, {
        task: trimmedTask,
        toolsUsed: this.toolsUsed,
      });
    }

    if (this.config.enableAdvancedDialogue) {
      this.historyMgr.transitionDialogueState(DialogueStateType.FollowUp, {
        intent: 'tool_completion',
        followUpQuestions: [
          '你还需要对这段代码进行优化吗？',
          '需要我解释代码的工作原理吗？',
          '还有其他功能需要实现吗？',
        ],
      });
    }

    return { response, reviewResult, learnedKnowledge: null, memorySummary };
  }

  // ================================================================
  // 工具调用记录
  // ================================================================

  recordToolCall(
    toolName: string,
    startTime: number,
    endTime: number,
    success: boolean,
    error?: string,
  ): void {
    const duration = endTime - startTime;
    const toolCall: ToolCall = {
      id: crypto.randomUUID(),
      toolName,
      startTime,
      endTime,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    };

    this.toolCallHistory.push(toolCall);
    if (this.toolCallHistory.length > 1000) {
      this.toolCallHistory = this.toolCallHistory.slice(-1000);
    }

    if (this.config.enableToolPerformanceTracking) {
      this.updateToolPerformance(toolCall);
    }
  }

  updateToolPerformance(toolCall: ToolCall): void {
    const existing = this.toolPerformance.get(toolCall.toolName);

    if (existing) {
      const newTotalCalls = existing.totalCalls + 1;
      const newSuccessfulCalls = existing.successfulCalls + (toolCall.success ? 1 : 0);
      const newTotalDuration = existing.totalDuration + toolCall.duration;

      this.toolPerformance.set(toolCall.toolName, {
        ...existing,
        totalCalls: newTotalCalls,
        successfulCalls: newSuccessfulCalls,
        totalDuration: newTotalDuration,
        averageDuration: newTotalDuration / newTotalCalls,
        successRate: newSuccessfulCalls / newTotalCalls,
        lastUsed: toolCall.timestamp,
      });
    } else {
      this.toolPerformance.set(toolCall.toolName, {
        toolName: toolCall.toolName,
        totalCalls: 1,
        successfulCalls: toolCall.success ? 1 : 0,
        totalDuration: toolCall.duration,
        averageDuration: toolCall.duration,
        successRate: toolCall.success ? 1 : 0,
        lastUsed: toolCall.timestamp,
      });
    }
  }

  // ================================================================
  // 代码优化 (从 AgentCore 提取)
  // ================================================================

  private async optimizeCode(code: string, task: string): Promise<string> {
    const lines = code.split('\n');
    const optimized: string[] = [];
    const changes: string[] = [];
    let hasChange = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine: string = lines[i] ?? '';
      let line = rawLine;

      // 1. var -> const/let
      const varMatch = line.match(/^(\s*)var\s+/);
      if (varMatch) {
        const varName = line.replace(/var\s+/, '').match(/^(\w+)/);
        const isReassigned = code.includes(`${varName?.[1]} =`);
        optimized.push(
          line.replace(/^(\s*)var\s+/, `$1${isReassigned ? 'let' : 'const'} `),
        );
        if (!hasChange) {
          hasChange = true;
          changes.push('var -> const/let');
        }
        continue;
      }

      // 2. 双等号 -> 三等号
      line = line.replace(/==(?!=)/g, '===');
      if (line !== rawLine && line.includes('===')) {
        if (!changes.includes('== -> ===')) changes.push('== -> ===');
        hasChange = true;
      }

      // 3. 移除空的 catch(e) {}
      if (/catch\s*\(.*?\)\s*\{/.test(line) && lines[i + 1]?.trim() === '}') {
        const indent = line.match(/^\s*/)?.[0] || '';
        optimized.push(`${indent}// 已移除空的 catch`);
        i++;
        if (!hasChange) {
          hasChange = true;
          changes.push('移除空 catch');
        }
        continue;
      }

      optimized.push(line);
    }

    if (hasChange) {
      const result = optimized.join('\n');
      return (
        result +
        '\n\n// 已应用的优化：\n' +
        changes.map((c) => `// - ${c}`).join('\n')
      );
    }

    const review = SmartCodeReviewer.review(code);
    if (review.issues && review.issues.length > 0) {
      return `${code}\n\n// 代码审查结果：得分 ${review.score}\n${review.issues.map((i) => `// [${i.severity}] ${i.message}`).join('\n')}`;
    }

    return `${code}\n\n// 代码审查通过，无自动优化项`;
  }

  // ================================================================
  // 公共查询方法
  // ================================================================

  getToolsUsed(): string[] {
    return [...this.toolsUsed];
  }

  getToolCallHistory(): ToolCall[] {
    return [...this.toolCallHistory];
  }

  getToolPerformance(): ToolPerformance[] {
    return Array.from(this.toolPerformance.values());
  }

  getToolPerformanceByName(toolName: string): ToolPerformance | undefined {
    return this.toolPerformance.get(toolName);
  }

  recommendTool(task: string): string | null {
    const taskLower = task.toLowerCase();

    if (
      taskLower.includes('生成') ||
      taskLower.includes('创建') ||
      taskLower.includes('编写')
    ) {
      return 'code_generation';
    }
    if (
      taskLower.includes('优化') ||
      taskLower.includes('修复') ||
      taskLower.includes('改进')
    ) {
      return 'code_optimization';
    }
    if (
      taskLower.includes('解释') ||
      taskLower.includes('如何') ||
      taskLower.includes('什么')
    ) {
      return 'question_answering';
    }

    const performanceData = Array.from(this.toolPerformance.entries())
      .map(([toolName, perf]) => ({
        toolName,
        score: perf.successRate * 0.7 + (1 - perf.averageDuration / 1000) * 0.3,
      }))
      .sort((a, b) => b.score - a.score);

    if (performanceData.length > 0) {
      return performanceData[0]!.toolName;
    }

    return null;
  }

  clearToolCallHistory(): void {
    this.toolCallHistory = [];
  }

  resetToolPerformance(): void {
    this.toolPerformance.clear();
  }

  getEvolutionEngine(): SelfEvolutionEngine | null {
    return this.evolutionEngine;
  }

  // ================================================================
  // 对话函数：任务执行链路（预检 → 验证 → 结论）
  // 普通对话不走此函数，仅任务类请求进入
  // ================================================================

  private async executeWithVerification(
    task: string,
    llmResponse: string,
  ): Promise<{ response: string; verified: boolean }> {
    // ——— 第 1 步：预检（回复前检查核实） ———
    const checkPrompt = `你是一个严格的执行前检查员。用户提出了一个任务请求，下面是助手准备回复的内容。

## 用户请求
${task}

## 助手准备回复
${llmResponse}

请执行预检：
1. **完整性** — 回复是否包含了完成任务所需的全部关键信息？
2. **可行性** — 回复中的方案/代码是否可以在不补充信息的前提下直接执行？
3. **风险** — 是否存在破坏性操作风险（如删除文件、修改关键配置）？

请只输出以下格式之一（不要加额外内容）：
- ✅ 预检通过
- ⚠️ 预检预警: <具体问题>
- ❌ 预检不通过: <具体原因>`;

    const checkResult = await callDeepSeek([
      { role: 'system', content: '你是一个严格但简洁的执行前检查员。只输出结论，不输出其他内容。' },
      { role: 'user', content: checkPrompt },
    ]);

    // ⚠️ 预检预警 只做提示不阻断，仅 ❌ 预检不通过 才拦截
    let preCheckWarning: string | null = null
    if (checkResult) {
      const trimmed = checkResult.trim()
      if (trimmed.startsWith('✅')) {
        // 完全通过
      } else if (trimmed.startsWith('⚠️')) {
        preCheckWarning = trimmed.replace(/^⚠️\s*预检预警:\s*/, '')
      } else {
        // ❌ 预检不通过 — 拦截
        const response = `${llmResponse}\n\n---\n**⚠️ 预检未通过**: ${trimmed}\n\n建议调整方案后重试。`
        return { response, verified: false }
      }
    }

    // ——— 第 2 步：验证（任务执行后验真） ———
    const verifyPrompt = `你是一个严格的质量验证员。请验证以下助手的回复是否准确、完整、可执行。

## 用户请求
${task}

## 助手回复
${llmResponse}

请逐项验证：
1. **准确性** — 回复中的技术描述、代码逻辑是否准确？
2. **完整性** — 是否涵盖了用户请求的所有要点？
3. **可执行性** — 如果涉及代码/操作步骤，是否完整可用、无遗漏？

请只输出以下格式之一（不要加额外内容）：
- ✅ 验证通过
- ⚠️ 验证发现小问题: <简要说明>
- ❌ 验证发现严重问题: <简要说明>`;

    const verifyResponse = await callDeepSeek([
      { role: 'system', content: '你是一个严格但简洁的质量验证员。只输出结论，不输出其他内容。' },
      { role: 'user', content: verifyPrompt },
    ]);

    // ——— 第 3 步：基于验证给出结论 ———
    let finalResponse: string;
    let verified: boolean;

    if (!verifyResponse) {
      // 验证不可用，基于预检结果给出保守结论
      finalResponse = llmResponse + '\n\n---\n**结论**: 回复已生成（验证服务暂不可用，建议人工复核）';
      verified = false;
    } else {
      const verifyText = verifyResponse.trim();
      if (verifyText.startsWith('✅')) {
        finalResponse = llmResponse + '\n\n---\n**结论**: ✅ 验证通过，回复完整可执行';
        verified = true;
      } else if (verifyText.startsWith('⚠️')) {
        finalResponse = llmResponse + `\n\n---\n**结论**: ⚠️ 存在小问题 — ${verifyText.replace(/^⚠️\s*验证发现小问题:\s*/, '')}\n\n建议根据上述问题调整后重新执行`;
        verified = false;
      } else {
        finalResponse = llmResponse + `\n\n---\n**结论**: ❌ 存在严重问题 — ${verifyText.replace(/^❌\s*验证发现严重问题:\s*/, '')}\n\n请修正后重试`;
        verified = false;
      }
    }

    // 如果有预检预警，追加到结论前面（不阻断回复）
    if (preCheckWarning) {
      finalResponse = finalResponse + `\n\n> ℹ️ **预检提醒**: ${preCheckWarning}`
    }

    return { response: finalResponse, verified };
  }
}
