import crypto from 'node:crypto';

import type {
  AgentConfig,
  AgentResult,
  ToolCall,
  ToolPerformance,
  ConversationContext,
  ConversationMessage,
  EmotionResult,
} from '../../../packages/core/src/types.js';
import { DialogueStateType } from '../../../packages/core/src/types.js';
import type { DialogueState } from '../../../packages/core/src/types.js';
import { SelfEvolutionEngine } from '../../evolution/SelfEvolutionEngine.js';
import { MemorySystem } from '../../memory/MemorySystem.js';
import { EmotionDetector } from './EmotionDetector.js';
import { ResponseGenerator } from './ResponseGenerator.js';
import { HistoryManager } from './HistoryManager.js';
import { ExecutionLoop } from './ExecutionLoop.js';
import type { ReviewResult } from '../../../packages/core/src/types.js';
import { SmartCodeReviewer } from './ExecutionLoop.js';
import { getLogger } from '../../../packages/core/src/Logger.js';

const log = getLogger('Agent');

// ================================================================
// Agent — 精简壳
// ================================================================

export class Agent {
  private config: AgentConfig;
  private emotionDetector: EmotionDetector;
  private responseGen: ResponseGenerator;
  private historyMgr: HistoryManager;
  private executionLoop: ExecutionLoop;
  private memorySystem: MemorySystem | null;
  private evolutionEngine: SelfEvolutionEngine;
  private conversationContext: ConversationContext;

  constructor(config: AgentConfig = {}) {
    this.config = {
      enableSelfReview: true,
      enableMemory: true,
      enableToolPerformanceTracking: true,
      enableConversationHistory: true,
      maxConversationHistory: 50,
      enableAdvancedDialogue: true,
      enableIntentRecognition: true,
      ...config,
    };

    this.evolutionEngine = new SelfEvolutionEngine();
    this.emotionDetector = new EmotionDetector();
    this.memorySystem = this.config.enableMemory
      ? new MemorySystem(config.memoryBasePath)
      : null;

    // 初始化对话上下文
    this.conversationContext = this.createInitialContext();

    // 初始化依赖
    this.responseGen = new ResponseGenerator();
    this.historyMgr = new HistoryManager(this.conversationContext, this.memorySystem ?? undefined);
    this.executionLoop = new ExecutionLoop(
      this.config,
      this.emotionDetector,
      this.responseGen,
      this.historyMgr,
      this.conversationContext,
      this.memorySystem ?? undefined,
      this.evolutionEngine,
    );
  }

  // ================================================================
  // 主入口
  // ================================================================

  async execute(
    task: string,
    code?: string,
    originalInput?: string,
  ): Promise<AgentResult> {
    return this.executionLoop.execute(task, code, originalInput);
  }

  // ================================================================
  // 工具历史 & 性能
  // ================================================================

  getToolCallHistory(): ToolCall[] {
    return this.executionLoop.getToolCallHistory();
  }

  getToolPerformance(): ToolPerformance[] {
    return this.executionLoop.getToolPerformance();
  }

  getToolPerformanceByName(toolName: string): ToolPerformance | undefined {
    return this.executionLoop.getToolPerformanceByName(toolName);
  }

  recommendTool(task: string): string | null {
    return this.executionLoop.recommendTool(task);
  }

  clearToolCallHistory(): void {
    this.executionLoop.clearToolCallHistory();
  }

  resetToolPerformance(): void {
    this.executionLoop.resetToolPerformance();
  }

  getToolsUsed(): string[] {
    return this.historyMgr.getToolsUsed();
  }

  /** 返回 ExecutionLoop 实例，外部可修改 systemPromptOverride 等 */
  getExecutionLoop(): ExecutionLoop {
    return this.executionLoop;
  }

  // ================================================================
  // SmartCodeReviewer 后向兼容
  // ================================================================

  getReviewer() {
    return SmartCodeReviewer;
  }

  getMemory() {
    return null;
  }

  // ================================================================
  // 对话上下文
  // ================================================================

  getConversationHistory(): ConversationMessage[] {
    return this.historyMgr.getConversationHistory();
  }

  getConversationContext(): ConversationContext {
    return {
      ...this.conversationContext,
      entityMemory: new Map(this.conversationContext.entityMemory),
    };
  }

  clearConversationHistory(): void {
    this.historyMgr.clearConversationHistory();
  }

  getLastNMessages(n: number): ConversationMessage[] {
    return this.historyMgr.getLastNMessages(n);
  }

  // ================================================================
  // 对话状态
  // ================================================================

  getCurrentDialogueState(): DialogueState {
    return this.historyMgr.getCurrentDialogueState();
  }

  getDialogueHistory(): DialogueState[] {
    return this.historyMgr.getDialogueHistory();
  }

  getCurrentIntent(): string | null {
    return this.historyMgr.getCurrentIntent();
  }

  getExpectedInput(): string | null {
    return this.historyMgr.getExpectedInput();
  }

  getFollowUpQuestions(): string[] {
    return this.historyMgr.getFollowUpQuestions();
  }

  resetDialogueState(): void {
    this.historyMgr.resetDialogueState();
  }

  // ================================================================
  // 情绪检测
  // ================================================================

  detectEmotion(text: string): EmotionResult {
    return this.emotionDetector.detect(text);
  }

  // ================================================================
  // 实体记忆 (后向兼容)
  // ================================================================

  getMemoryEntity(key: string): string | undefined {
    return this.conversationContext.entityMemory.get(key);
  }

  setMemoryEntity(key: string, value: string): void {
    this.conversationContext.entityMemory.set(key, value);
  }

  clearMemoryEntity(key: string): void {
    this.conversationContext.entityMemory.delete(key);
  }

  getAllMemoryEntities(): Map<string, string> {
    return new Map(this.conversationContext.entityMemory);
  }

  // ================================================================
  // 技能管理 (后向兼容 — 已弃用)
  // ================================================================

  async saveSkill(
    skillName: string,
    skillCode: string,
    skillLanguage: string,
    skillDescription?: string,
  ): Promise<string | null> {
    log.warn('saveSkill: MemoryManager has been removed, skill not saved');
    return null;
  }

  async loadSkill(
    skillName: string,
  ): Promise<{ skillCode: string; skillLanguage: string; skillDescription?: string } | null> {
    log.warn('loadSkill: MemoryManager has been removed');
    return null;
  }

  async findSimilarSkills(
    code: string,
    language?: string,
  ): Promise<
    Array<{
      skillName: string;
      skillCode: string;
      skillLanguage: string;
      skillDescription?: string;
    }>
  > {
    return [];
  }

  async getAllSkills(): Promise<
    Array<{ skillName: string; skillDescription?: string; usageCount: number; lastUsedAt?: number }>
  > {
    return [];
  }

  // ================================================================
  // 私有辅助
  // ================================================================

  private createInitialContext(): ConversationContext {
    const initialState: DialogueState = {
      id: crypto.randomUUID(),
      type: DialogueStateType.Greeting,
      timestamp: new Date().toISOString(),
      data: {
        intent: 'greeting',
        expectedInput: '用户问候或任务请求',
      },
    };

    return {
      sessionId: crypto.randomUUID(),
      messages: [],
      currentTopic: null,
      lastTask: null,
      entityMemory: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dialogueState: initialState,
      dialogueHistory: [initialState],
      currentIntent: null,
      expectedInput: null,
      followUpQuestions: [],
    };
  }
}

export type { ReviewResult };

export default Agent;
