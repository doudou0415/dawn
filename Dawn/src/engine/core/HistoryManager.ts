import crypto from 'node:crypto';

import type {
  ConversationContext,
  ConversationMessage,
  DialogueState,
} from '../../../packages/core/src/types.js';
import { DialogueStateType } from '../../../packages/core/src/types.js';
import type { MemorySystem } from '../../memory/MemorySystem.js';

// ====================================================================
// HistoryManager — 对话历史与状态管理
// ====================================================================
//
// 职责：
//   - 对话消息的增删查（addToConversationHistory / getLastNMessages 等）
//   - 对话状态机转移（transitionDialogueState）
//   - 对话状态辅助方法（isConfirmation / isNegation 等）
//   - 继续上次任务（continueLastTask）
//   - 集成 MemorySystem 自动记录重要上下文（v2）
//
// 设计约定：
//   - 所有状态存放在外部传入的 ConversationContext 对象中
//   - 不持有 AgentCore 的引用，不依赖 emotionDetector / IntentEngine
//   - handleComplexDialogue 等涉及多引擎协作的逻辑留在 AgentCore 中
// ====================================================================

export class HistoryManager {
  private ctx: ConversationContext;
  /** 可选的 MemorySystem 引用（通过 Container 注入） */
  private memorySystem?: MemorySystem;

  constructor(context: ConversationContext, memorySystem?: MemorySystem) {
    this.ctx = context;
    this.ctx.messages ??= [];
    this.memorySystem = memorySystem;
  }

  /**
   * 设置/更新 MemorySystem 引用（支持后期注入）
   */
  setMemorySystem(memorySystem: MemorySystem): void {
    this.memorySystem = memorySystem;
  }

  // ── 消息管理 ────────────────────────────────────────────────

  /**
   * 往 conversationContext.messages 推一条消息。
   * 超过 maxHistory 时自动截断；用户消息会同时触发 topic 提取和实体记忆更新。
   * 集成 MemorySystem：重要消息自动写入 session 记忆。
   */
  addToConversationHistory(
    role: 'user' | 'assistant' | 'system',
    content: string,
    context?: ConversationMessage['context'],
    maxHistory: number = 100,
  ): void {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      context,
    };

    this.ctx.messages.push(message);
    this.ctx.updatedAt = new Date().toISOString();

    // 限制历史长度
    if (this.ctx.messages.length > maxHistory) {
      this.ctx.messages = this.ctx.messages.slice(-maxHistory);
    }

    // 更新当前主题
    if (role === 'user' && context?.task) {
      this.ctx.currentTopic = this.extractTopic(context.task);
      this.ctx.lastTask = context.task;
    }

    // 集成 MemorySystem：用户消息写入 session 记忆（异步非阻塞）
    if (role === 'user' && this.memorySystem && content.length > 10) {
      const taskKey = context?.task
        ? `task_${this.extractTopic(context.task)}`
        : `msg_${Date.now()}`;
      this.memorySystem
        .save({
          key: taskKey,
          value: { content: content.slice(0, 500), role },
          metadata: { source: 'conversation', timestamp: message.timestamp },
          type: 'session',
        })
        .catch(() => {
          // 记忆写入失败不阻塞主流程
        });
    }
  }

  /**
   * 取最近 n 条对话消息。
   */
  getLastNMessages(n: number): ConversationMessage[] {
    return this.ctx.messages.slice(-n);
  }

  /**
   * 返回当前 toolsUsed 快照（从最后一条 assistant 消息的上下文中提取）。
   * 若没有工具使用记录则返回空数组。
   */
  getToolsUsed(): string[] {
    const reversed = [...this.ctx.messages].reverse();
    for (const msg of reversed) {
      if (msg.role === 'assistant' && msg.context?.toolsUsed?.length) {
        return [...msg.context.toolsUsed];
      }
    }
    return [];
  }

  /**
   * 返回完整对话历史副本。
   */
  getConversationHistory(): ConversationMessage[] {
    return [...this.ctx.messages];
  }

  /**
   * 清空全部对话历史。
   */
  clearConversationHistory(): void {
    this.ctx.messages = [];
    this.ctx.currentTopic = null;
    this.ctx.lastTask = null;
    this.ctx.updatedAt = new Date().toISOString();
  }

  // ── 对话状态机 ─────────────────────────────────────────────

  /**
   * 对话状态机转移：创建新状态、更新上下文、截断历史、更新期望输入和后续问题。
   */
  transitionDialogueState(
    newStateType: DialogueStateType,
    data?: DialogueState['data'],
  ): void {
    const newState: DialogueState = {
      id: crypto.randomUUID(),
      type: newStateType,
      timestamp: new Date().toISOString(),
      data: data || {},
      previousStateId: this.ctx.dialogueState.id,
    };

    this.ctx.dialogueState = newState;
    this.ctx.dialogueHistory.push(newState);

    // 限制历史长度
    if (this.ctx.dialogueHistory.length > 20) {
      this.ctx.dialogueHistory = this.ctx.dialogueHistory.slice(-20);
    }

    // 更新期望输入
    if (data?.expectedInput) {
      this.ctx.expectedInput = data.expectedInput;
    }

    // 更新后续问题
    if (data?.followUpQuestions) {
      this.ctx.followUpQuestions = data.followUpQuestions;
    }
  }

  /** 获取当前对话状态。 */
  getCurrentDialogueState(): DialogueState {
    return this.ctx.dialogueState;
  }

  /** 获取对话历史状态列表副本。 */
  getDialogueHistory(): DialogueState[] {
    return [...this.ctx.dialogueHistory];
  }

  /** 获取当前意图。 */
  getCurrentIntent(): string | null {
    return this.ctx.currentIntent;
  }

  /** 获取当前期望输入。 */
  getExpectedInput(): string | null {
    return this.ctx.expectedInput;
  }

  /** 获取后续问题列表副本。 */
  getFollowUpQuestions(): string[] {
    return [...this.ctx.followUpQuestions];
  }

  /** 重置对话状态为初始 greeting。 */
  resetDialogueState(): void {
    const initialState: DialogueState = {
      id: crypto.randomUUID(),
      type: DialogueStateType.Greeting,
      timestamp: new Date().toISOString(),
      data: {
        intent: 'greeting',
        expectedInput: '用户问候或任务请求',
      },
    };

    this.ctx.dialogueState = initialState;
    this.ctx.dialogueHistory = [initialState];
    this.ctx.currentIntent = null;
    this.ctx.expectedInput = null;
    this.ctx.followUpQuestions = [];
  }

  // ── 对话辅助方法 ───────────────────────────────────────────

  /** 判断文本是否为确认/肯定。 */
  isConfirmation(text: string): boolean {
    const confirmations = ['好的', '嗯', 'ok', 'okay', '对对', '没错', '是的'];
    return confirmations.some(
      (c) => text === c || text.endsWith(c) || text.startsWith(c),
    );
  }

  /** 判断文本是否为否定。 */
  isNegation(text: string): boolean {
    const negations = ['不', '没', '否', '不要', '不用', '算了'];
    return negations.some((n) => text.includes(n));
  }

  /** 判断文本是否包含问候语。 */
  containsGreeting(text: string): boolean {
    const greetings = [
      '你好', 'hi', 'hello', '嗨', 'hey',
      '早上好', '下午好', '晚上好', '在吗', '在嘛',
    ];
    return greetings.some((g) => text.includes(g));
  }

  // ── 继续上次任务 ───────────────────────────────────────────

  /**
   * 生成"继续上次任务"的提示文本。
   * 如果没有上次任务记录则返回提示消息。
   */
  continueLastTask(): string {
    if (!this.ctx.lastTask) {
      return '我没有找到上一次的任务记录。能否重新描述一下你想要完成的任务？';
    }

    const lastMessages = this.getLastNMessages(4);
    const contextSummary = lastMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    return [
      '好的，让我们继续上次的任务。',
      '',
      `上一次任务：${this.ctx.lastTask}`,
      '',
      '相关上下文：',
      contextSummary,
      '',
      '请告诉我你想要继续做什么，或者需要什么帮助？',
    ].join('\n');
  }

  // ── 私有辅助 ───────────────────────────────────────────────

  /**
   * 简单的 topic 提取：取前 5 个词。
   */
  private extractTopic(text: string): string {
    const words = text.split(/\s+/).slice(0, 5);
    return words.join(' ');
  }
}
