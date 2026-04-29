/**
 * ContextService — 共享上下文服务
 *
 * 统一管理 HistoryManager + MemorySystem + IntentEngine，
 * 使 Coordinator 路径也能拥有完整的对话历史与三层记忆系统，
 * 与 Agent.execute() → ExecutionLoop 路径保持一致。
 *
 * 设计原则：最小侵入 + 最大复用
 * - HistoryManager 复用现有实现（需要 ConversationContext）
 * - MemorySystem 复用现有实现
 * - IntentEngine 复用现有实现
 */

import { HistoryManager } from './HistoryManager.js';
import { MemorySystem } from '../../memory/MemorySystem.js';
import { IntentEngine } from '../intent/IntentEngine.js';
import { PreferenceExtractor } from './PreferenceExtractor.js';
import type { ConversationContext } from '@dawn/core';
import crypto from 'node:crypto';
import { DialogueStateType } from '@dawn/core';

export interface LLMContext {
  history: { role: string; content: string }[];
  memoryContext: string;
}

export class ContextService {
  public historyManager: HistoryManager;
  public memorySystem: MemorySystem;
  public intentEngine: IntentEngine;
  public preferenceExtractor: PreferenceExtractor;

  private contextMap: Map<string, ConversationContext> = new Map();

  constructor(basePath?: string) {
    this.memorySystem = new MemorySystem(basePath);
    this.intentEngine = new IntentEngine();
    this.preferenceExtractor = new PreferenceExtractor();

    // 创建默认会话上下文
    const defaultCtx = this.createContext();
    this.contextMap.set('default', defaultCtx);
    this.historyManager = new HistoryManager(defaultCtx, this.memorySystem);
  }

  /**
   * 获取或创建指定 sessionId 的对话上下文
   */
  getOrCreateContext(sessionId: string = 'default'): ConversationContext {
    let ctx = this.contextMap.get(sessionId);
    if (!ctx) {
      ctx = this.createContext();
      this.contextMap.set(sessionId, ctx);
    }
    return ctx;
  }

  /**
   * 获取指定 session 的 HistoryManager
   */
  getHistoryManager(sessionId: string = 'default'): HistoryManager {
    const ctx = this.getOrCreateContext(sessionId);
    if (sessionId === 'default') return this.historyManager;
    return new HistoryManager(ctx, this.memorySystem);
  }

  /**
   * 获取 MemorySystem 实例
   */
  getMemorySystem(): MemorySystem {
    return this.memorySystem;
  }

  /**
   * 获取 IntentEngine 实例
   */
  getIntentEngine(): IntentEngine {
    return this.intentEngine;
  }

  /**
   * 构建 LLM 上下文（含历史消息 + 记忆检索）
   * 复用 ExecutionLoop 已修复的逻辑
   */
  async buildLLMContext(task: string, sessionId: string = 'default'): Promise<LLMContext> {
    const historyMgr = this.getHistoryManager(sessionId);
    const history = historyMgr.getConversationHistory().map(m => ({
      role: m.role,
      content: m.content,
    }));
    let memoryContext = '';
    try {
      const memCtx = await this.memorySystem.getRelevantMemories({ text: task, limit: 3 });
      if (memCtx.summary && memCtx.summary !== '无相关记忆') {
        memoryContext = memCtx.summary;
      }
    } catch {
      // 记忆检索失败不影响主流程
    }
    return { history, memoryContext };
  }

  /**
   * 提取并保存偏好
   */
  async extractAndSavePreferences(input: string): Promise<void> {
    const prefMatch = this.preferenceExtractor.extract(input);
    if (prefMatch) {
      await this.memorySystem.savePreference(prefMatch.key, prefMatch.value);
    }
  }

  /**
   * 创建新的 ConversationContext
   */
  private createContext(): ConversationContext {
    const initialState = {
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

  /**
   * 清除指定 session 的对话历史
   */
  clearHistory(sessionId: string = 'default'): void {
    const historyMgr = this.getHistoryManager(sessionId);
    historyMgr.clearConversationHistory();
  }
}
