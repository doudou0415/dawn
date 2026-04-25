import type { ReviewResult } from '../utils/code-review/types';
import { SmartCodeReviewer } from '../utils/code-review/SmartCodeReviewer';
import { SelfEvolutionEngine } from './selfEvolution.js';
import { looksLikeToolTask } from './intentEngine.js';
import { ContextManager } from './contextManager.js';

export interface ToolCall {
  id: string;
  toolName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface ToolPerformance {
  toolName: string;
  totalCalls: number;
  successfulCalls: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  lastUsed: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  context?: {
    task?: string;
    code?: string;
    toolsUsed?: string[];
  };
}

export interface ConversationContext {
  sessionId: string;
  messages: ConversationMessage[];
  currentTopic: string | null;
  lastTask: string | null;
  entityMemory: Map<string, string>;
  createdAt: string;
  updatedAt: string;
  dialogueState: DialogueState;
  dialogueHistory: DialogueState[];
  currentIntent: string | null;
  expectedInput: string | null;
  followUpQuestions: string[];
}

export type DialogueStateType = 'greeting' | 'task_request' | 'task_execution' | 'follow_up' | 'clarification' | 'conclusion' | 'error';

export interface DialogueState {
  id: string;
  type: DialogueStateType;
  timestamp: string;
  data: {
    intent?: string;
    task?: string;
    expectedInput?: string;
    followUpQuestions?: string[];
    error?: string;
  };
  previousStateId?: string;
  nextStateId?: string;
}

export interface Intent {
  name: string;
  confidence: number;
  parameters: Record<string, any>;
}

export interface EmotionResult {
  emotion: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited';
  intensity: number;
  confidence: number;
}

export interface AgentConfig {
  enableSelfReview?: boolean;
  enableMemory?: boolean;
  contextManager?: ContextManager;
  enableToolPerformanceTracking?: boolean;
  enableConversationHistory?: boolean;
  maxConversationHistory?: number;
  enableAdvancedDialogue?: boolean;
  enableIntentRecognition?: boolean;
}

class EmotionDetector {
  private positiveKeywords = ['好', '棒', '赞', '谢谢', '厉害', '完美', '喜欢', '棒棒哒', '优秀', '出色'];
  private negativeKeywords = ['差', '烂', '糟糕', '失望', '生气', '愤怒', '烦躁', '讨厌', '无用', '垃圾'];
  private frustratedKeywords = ['不会', '不懂', '不行', '无法', '解决', '总是', '到底', '为什么', '怎么'];
  private excitedKeywords = ['太好了', '完美', '太棒了', '哇', '哇哦', '厉害', '牛', '强', '帅', '酷'];

  detect(text: string): EmotionResult {
    const lower = text.toLowerCase();
    let score = 0;
    let maxEmotion: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited' = 'neutral';
    
    // 检查各类型关键词
    const positiveCount = this.positiveKeywords.filter(k => lower.includes(k)).length;
    const negativeCount = this.negativeKeywords.filter(k => lower.includes(k)).length;
    const frustratedCount = this.frustratedKeywords.filter(k => lower.includes(k)).length;
    const excitedCount = this.excitedKeywords.filter(k => lower.includes(k)).length;
    
    score = positiveCount - negativeCount - frustratedCount * 0.5;
    
    if (excitedCount > 0 && score > 0) {
      maxEmotion = 'excited';
    } else if (frustratedCount > positiveCount) {
      maxEmotion = 'frustrated';
    } else if (negativeCount > positiveCount) {
      maxEmotion = 'negative';
    } else if (positiveCount > 0) {
      maxEmotion = 'positive';
    }
    
    return {
      emotion: maxEmotion,
      intensity: Math.min(Math.abs(score) / 5, 1),
      confidence: positiveCount + negativeCount + frustratedCount + excitedCount > 0 ? 0.8 : 0.3
    };
  }
}

export class Agent {
  private reviewer: SmartCodeReviewer;
  private contextManager: ContextManager | null;
  private config: AgentConfig;
  private evolutionEngine: SelfEvolutionEngine;
  private toolsUsed: string[] = [];
  private toolCallHistory: ToolCall[] = [];
  private toolPerformance: Map<string, ToolPerformance> = new Map();
  private conversationContext: ConversationContext;
  private emotionDetector: EmotionDetector;

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

    this.reviewer = new SmartCodeReviewer();
    this.contextManager = config.contextManager || (this.config.enableMemory ? new ContextManager() : null);
    this.evolutionEngine = new SelfEvolutionEngine();
    this.emotionDetector = new EmotionDetector();

    const initialState: DialogueState = {
      id: crypto.randomUUID(),
      type: 'greeting',
      timestamp: new Date().toISOString(),
      data: {
        intent: 'greeting',
        expectedInput: '用户问候或任务请求'
      }
    };

    this.conversationContext = {
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
      followUpQuestions: []
    };
  }

  async execute(task: string, code?: string): Promise<{
    response: string;
    reviewResult?: ReviewResult;
    learnedKnowledge?: any;
  }> {
    const trimmedTask = task.trim();

    // 记录用户消息到对话历史
    if (this.config.enableConversationHistory) {
      this.addToConversationHistory('user', trimmedTask, {
        task: trimmedTask,
        code: code
      });
    }

    if (!trimmedTask) {
      const response = '你好！有什么可以帮助你的吗？';
      // 记录助手消息到对话历史
      if (this.config.enableConversationHistory) {
        this.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed
        });
      }
      return { response, reviewResult: undefined };
    }

    // 尝试使用复杂对话处理（无论是否是工具任务）
    if (this.config.enableAdvancedDialogue) {
      const complexResponse = this.handleComplexDialogue(trimmedTask);
      if (complexResponse) {
        // 记录助手消息到对话历史
        if (this.config.enableConversationHistory) {
          this.addToConversationHistory('assistant', complexResponse, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed
          });
        }
        return { response: complexResponse, reviewResult: undefined };
      }
    }

    if (!looksLikeToolTask(trimmedTask)) {
      const response = await this.generateConversationalResponse(trimmedTask);
      // 记录助手消息到对话历史
      if (this.config.enableConversationHistory) {
        this.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed
        });
      }
      return { response, reviewResult: undefined };
    }

    // 重置工具使用记录
    this.toolsUsed = [];

    let generatedCode = code || '';
    const taskLower = trimmedTask.toLowerCase();

    // 更新对话状态为任务执行
    if (this.config.enableAdvancedDialogue) {
      this.transitionDialogueState('task_execution', {
        intent: 'tool_task',
        task: trimmedTask,
        expectedInput: '工具执行结果反馈'
      });
    }

    if (this.isQuestionRequest(taskLower)) {
      const startTime = Date.now();
      const response = await this.answerQuestion(trimmedTask);
      const endTime = Date.now();
      this.recordToolCall('question_answering', startTime, endTime, true);
      
      // 记录助手消息到对话历史
      if (this.config.enableConversationHistory) {
        this.addToConversationHistory('assistant', response, {
          task: trimmedTask,
          toolsUsed: this.toolsUsed
        });
      }
      
      // 更新对话状态为后续问题
      if (this.config.enableAdvancedDialogue) {
        this.transitionDialogueState('follow_up', {
          intent: 'question_answered',
          followUpQuestions: [
            '你还有其他问题吗？',
            '需要我进一步解释吗？',
            '还有其他功能需要了解吗？'
          ]
        });
      }
      
      return { response, reviewResult: undefined };
    }

    if (this.isCodeGenerationRequest(taskLower)) {
      const startTime = Date.now();
      try {
        generatedCode = await this.generateCodeFromTask(trimmedTask);
        const endTime = Date.now();
        this.recordToolCall('code_generation', startTime, endTime, true);
        this.toolsUsed.push('code_generation');
      } catch (error) {
        const endTime = Date.now();
        this.recordToolCall('code_generation', startTime, endTime, false, error instanceof Error ? error.message : String(error));
        const errorResponse = `生成代码时出错: ${error instanceof Error ? error.message : String(error)}`;
        
        // 记录助手消息到对话历史
        if (this.config.enableConversationHistory) {
          this.addToConversationHistory('assistant', errorResponse, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed
          });
        }
        
        // 更新对话状态为错误
        if (this.config.enableAdvancedDialogue) {
          this.transitionDialogueState('error', {
            intent: 'code_generation_error',
            error: errorResponse
          });
        }
        
        return { response: errorResponse };
      }
    } else if (this.isCodeModificationRequest(taskLower)) {
      if (code) {
        const startTime = Date.now();
        try {
          generatedCode = await this.optimizeCode(code, trimmedTask);
          const endTime = Date.now();
          this.recordToolCall('code_optimization', startTime, endTime, true);
          this.toolsUsed.push('code_optimization');
        } catch (error) {
          const endTime = Date.now();
          this.recordToolCall('code_optimization', startTime, endTime, false, error instanceof Error ? error.message : String(error));
          const errorResponse = `优化代码时出错: ${error instanceof Error ? error.message : String(error)}`;
          
          // 记录助手消息到对话历史
          if (this.config.enableConversationHistory) {
            this.addToConversationHistory('assistant', errorResponse, {
              task: trimmedTask,
              toolsUsed: this.toolsUsed
            });
          }
          
          // 更新对话状态为错误
          if (this.config.enableAdvancedDialogue) {
            this.transitionDialogueState('error', {
              intent: 'code_optimization_error',
              error: errorResponse
            });
          }
          
          return { response: errorResponse };
        }
      } else {
        const response = '请提供要修改的代码，或者明确说明你想要创建什么功能。';
        
        // 记录助手消息到对话历史
        if (this.config.enableConversationHistory) {
          this.addToConversationHistory('assistant', response, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed
          });
        }
        
        // 更新对话状态为澄清
        if (this.config.enableAdvancedDialogue) {
          this.transitionDialogueState('clarification', {
            intent: 'missing_code',
            expectedInput: '用户提供代码'
          });
        }
        
        return { response };
      }
    } else {
      const startTime = Date.now();
      try {
        const response = await this.handleGeneralRequest(trimmedTask, code);
        const endTime = Date.now();
        this.recordToolCall('general_request', startTime, endTime, true);
        this.toolsUsed.push('general_request');
        
        // 记录助手消息到对话历史
        if (this.config.enableConversationHistory) {
          this.addToConversationHistory('assistant', response, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed
          });
        }
        
        // 更新对话状态为后续问题
        if (this.config.enableAdvancedDialogue) {
          this.transitionDialogueState('follow_up', {
            intent: 'general_request_completed',
            followUpQuestions: [
              '你还需要其他帮助吗？',
              '还有其他功能需要实现吗？',
              '需要我解释结果吗？'
            ]
          });
        }
        
        return { response };
      } catch (error) {
        const endTime = Date.now();
        this.recordToolCall('general_request', startTime, endTime, false, error instanceof Error ? error.message : String(error));
        const errorResponse = `处理请求时出错: ${error instanceof Error ? error.message : String(error)}`;
        
        // 记录助手消息到对话历史
        if (this.config.enableConversationHistory) {
          this.addToConversationHistory('assistant', errorResponse, {
            task: trimmedTask,
            toolsUsed: this.toolsUsed
          });
        }
        
        // 更新对话状态为错误
        if (this.config.enableAdvancedDialogue) {
          this.transitionDialogueState('error', {
            intent: 'general_request_error',
            error: errorResponse
          });
        }
        
        return { response: errorResponse };
      }
    }

    const response = generatedCode
      ? this.formatCodeResponse(trimmedTask, generatedCode)
      : `好的，我来帮你处理：${trimmedTask}`;

    let reviewResult: ReviewResult | undefined;
    if (generatedCode && this.config.enableSelfReview) {
      const startTime = Date.now();
      try {
        reviewResult = await this.reviewer.review(generatedCode);
        const endTime = Date.now();
        this.recordToolCall('code_review', startTime, endTime, true);
        this.toolsUsed.push('code_review');
      } catch (error) {
        const endTime = Date.now();
        this.recordToolCall('code_review', startTime, endTime, false, error instanceof Error ? error.message : String(error));
      }
    }

    if (reviewResult) {
      const analysis = {
        id: crypto.randomUUID(),
        description: trimmedTask,
        toolsUsed: this.toolsUsed,
        stepsTaken: [
          '分析任务',
          ...(generatedCode ? ['生成/优化代码'] : []),
          ...(reviewResult ? ['代码审查'] : []),
          '返回结果'
        ],
        success: (reviewResult.score || 0) >= 90,
        duration: 0,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        keywords: trimmedTask.split(/\s+/).slice(0, 10)
      };
      this.evolutionEngine.analyzeTask(analysis).catch(console.error);
    }

    // 记录助手消息到对话历史
    if (this.config.enableConversationHistory) {
      this.addToConversationHistory('assistant', response, {
        task: trimmedTask,
        toolsUsed: this.toolsUsed
      });
    }

    // 更新对话状态为后续问题
    if (this.config.enableAdvancedDialogue) {
      this.transitionDialogueState('follow_up', {
        intent: 'tool_completion',
        followUpQuestions: [
          '你还需要对这段代码进行优化吗？',
          '需要我解释代码的工作原理吗？',
          '还有其他功能需要实现吗？'
        ]
      });
    }

    return { response, reviewResult, learnedKnowledge: null };
  }

  private recordToolCall(toolName: string, startTime: number, endTime: number, success: boolean, error?: string): void {
    const duration = endTime - startTime;
    const toolCall: ToolCall = {
      id: crypto.randomUUID(),
      toolName,
      startTime,
      endTime,
      duration,
      success,
      error,
      timestamp: new Date().toISOString()
    };

    // 添加到历史记录
    this.toolCallHistory.push(toolCall);
    
    // 限制历史记录长度
    if (this.toolCallHistory.length > 1000) {
      this.toolCallHistory = this.toolCallHistory.slice(-1000);
    }

    // 更新性能统计
    if (this.config.enableToolPerformanceTracking) {
      this.updateToolPerformance(toolCall);
    }
  }

  private updateToolPerformance(toolCall: ToolCall): void {
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
        lastUsed: toolCall.timestamp
      });
    } else {
      this.toolPerformance.set(toolCall.toolName, {
        toolName: toolCall.toolName,
        totalCalls: 1,
        successfulCalls: toolCall.success ? 1 : 0,
        totalDuration: toolCall.duration,
        averageDuration: toolCall.duration,
        successRate: toolCall.success ? 1 : 0,
        lastUsed: toolCall.timestamp
      });
    }
  }

  private async generateConversationalResponse(input: string): Promise<string> {
    const lower = input.toLowerCase();
    
    // 检测情感
    const emotion = this.emotionDetector.detect(input);
    
    // 处理技能相关请求
    const skillResponse = await this.handleSkillRequest(input);
    if (skillResponse) {
      return skillResponse;
    }
    
    // 尝试使用复杂对话处理
    if (this.config.enableAdvancedDialogue) {
      const complexResponse = this.handleComplexDialogue(input);
      if (complexResponse) {
        return complexResponse;
      }
    }
    
    // 基于上下文的响应
    if (this.conversationContext.lastTask && 
        (lower.includes('继续') || lower.includes('还有') || lower.includes('还要') || lower.includes('接着'))) {
      return this.continueLastTask();
    }
    
    // 基于情感的响应调整
    if (emotion.emotion === 'frustrated') {
      return '我注意到你可能有些困惑或沮丧。让我重新解释一下，或者我们可以换个方式来处理这个问题。';
    }
    
    if (emotion.emotion === 'excited') {
      return '听起来你对这个很感兴趣！让我们继续深入探讨。';
    }
    
    if (emotion.emotion === 'positive') {
      return '很高兴你对这个感兴趣！我很乐意继续帮助你。';
    }

    if (this.containsGreeting(lower)) {
      return '你好！有什么编程问题我可以帮你解答，或者需要我帮你生成什么代码吗？';
    }

    if (this.isQuestion(input)) {
      return this.handleQuestion(input);
    }

    if (this.isConfirmation(lower) || this.isNegation(lower)) {
      return '好的，我明白了。如果有其他需要，随时告诉我。';
    }

    return '我不太确定你的意思。你是想让我帮你完成什么任务吗？比如：\n• 生成某个功能的代码\n• 解释某段代码的工作原理\n• 回答某个编程问题\n\n请明确告诉我你需要什么帮助。';
  }

  private handleQuestion(question: string): string {
    const lower = question.toLowerCase();

    if (question.includes('什么是') || question.includes('什么叫') || question.includes('是何')) {
      return this.explainConcept(question);
    }

    if (lower.includes('如何') || lower.includes('怎么')) {
      return this.explainHowTo(question);
    }

    if (lower.includes('为什么')) {
      return this.explainWhy(question);
    }

    return `关于你的问题"${question}"，让我来解答：\n\n这是一个很好的编程问题。如果你有具体的代码或场景，我可以给出更详细的解答。`;
  }

  private isQuestion(text: string): boolean {
    return text.includes('？') || text.includes('?') ||
           text.includes('怎么') || text.includes('如何') ||
           text.includes('什么') || text.includes('为什么') ||
           text.includes('是不是') || text.includes('能不能');
  }

  private containsGreeting(text: string): boolean {
    const greetings = ['你好', 'hi', 'hello', '嗨', 'hey', '早上好', '下午好', '晚上好', '在吗', '在嘛'];
    return greetings.some(g => text.includes(g));
  }

  private isConfirmation(text: string): boolean {
    const confirmations = ['好的', '嗯', 'ok', 'okay', '对对', '没错', '是的'];
    return confirmations.some(c => text === c || text.endsWith(c) || text.startsWith(c));
  }

  private isNegation(text: string): boolean {
    const negations = ['不', '没', '否', '不要', '不用', '算了', '算了'];
    return negations.some(n => text.includes(n));
  }

  private isCodeGenerationRequest(task: string): boolean {
    const keywords = [
      '写', '生成', '创建', '编写', '实现', '开发',
      'function', '函数', 'class', '组件', '代码',
      '生成一个', '写一个', '创建一个', '帮我写'
    ];
    return keywords.some(k => task.includes(k)) &&
      !task.includes('解释') && !task.includes('什么') && !task.includes('怎么');
  }

  private isCodeModificationRequest(task: string): boolean {
    const keywords = ['修改', '优化', '修复', '改进', '重构', '调整', '改变'];
    return keywords.some(k => task.includes(k));
  }

  private isQuestionRequest(task: string): boolean {
    const keywords = ['如何', '怎么', '什么是', '为什么', '何时', '哪里', '谁', '解释', '说明', '告诉我', '？', '?'];
    const questionPatterns = [
      /\?$/,
      /吗$/,
      /呀$/,
      /^为什么/,
      /^如何/,
      /^怎么/,
      /^什么是/
    ];
    return keywords.some(k => task.includes(k)) || questionPatterns.some(p => p.test(task));
  }

  private async handleGeneralRequest(task: string, code?: string): Promise<string> {
    if (code) {
      return `好的，我来帮你处理这段代码。\n\n关于你的需求"${task}"，请提供更具体的说明：\n1. 你想对这段代码做什么修改？\n2. 有什么具体的功能需求吗？`;
    }

    return `你的意思是"${task}"吗？为了更好地帮助你，请明确一下：\n• 你想让我生成什么代码？\n• 有什么具体的功能需求吗？\n• 或者你有其他编程问题想要咨询？`;
  }

  private formatCodeResponse(task: string, code: string): string {
    return `好的，我来帮你生成代码。\n\n需求：${task}\n\n\`\`\`typescript\n${code}\n\`\`\``;
  }

  private async generateCodeFromTask(task: string): Promise<string> {
    if (task.includes('json') || task.includes('解析') || task.includes('parse')) {
      return this.generateJSONParser();
    }
    if (task.includes('防抖') || task.includes('debounce')) {
      return this.generateDebounce();
    }
    if (task.includes('深拷贝') || task.includes('深度克隆') || task.includes('deepclone') || task.includes('deep clone')) {
      return this.generateDeepClone();
    }
    if (task.includes('节流') || task.includes('throttle')) {
      return this.generateThrottle();
    }
    if (task.includes('promise') || task.includes('异步') || task.includes('async')) {
      return this.generateAsyncHelper();
    }
    if (task.includes('校验') || task.includes('验证') || task.includes('validate')) {
      return this.generateValidator();
    }
    if (task.includes('格式化') || task.includes('format')) {
      return this.generateFormatter();
    }
    if (task.includes('排序') || task.includes('sort')) {
      return this.generateSorter();
    }
    if (task.includes('缓存') || task.includes('cache')) {
      return this.generateCache();
    }
    if (task.includes('事件') || task.includes('event')) {
      return this.generateEventEmitter();
    }
    if (task.includes('链表') || task.includes('list')) {
      return this.generateLinkedList();
    }
    if (task.includes('树') || task.includes('tree')) {
      return this.generateTree();
    }
    if (task.includes('栈') || task.includes('stack')) {
      return this.generateStack();
    }
    if (task.includes('队列') || task.includes('queue')) {
      return this.generateQueue();
    }
    if (task.includes('hello') || task.includes('world') || task.includes('你好') || task.includes('世界')) {
      return `function sayHello(name: string = "World"): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(sayHello());`;
    }

    return this.generateGenericCode(task);
  }

  private generateJSONParser(): string {
    return `function safeParseJSON<T = unknown>(jsonString: unknown): T | null {
  if (typeof jsonString !== 'string') {
    throw new TypeError('参数必须是字符串');
  }
  try {
    return JSON.parse(jsonString.trim()) as T;
  } catch (error) {
    console.error('JSON解析失败:', error);
    return null;
  }
}`;
  }

  private generateDebounce(): string {
    return `function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}`;
  }

  private generateDeepClone(): string {
    return `function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as T;
  }
  if (obj instanceof Object) {
    const cloned: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
      }
    }
    return cloned as T;
  }
  return obj;
}`;
  }

  private generateThrottle(): string {
    return `function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}`;
  }

  private generateAsyncHelper(): string {
    return `async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
}`;
  }

  private generateValidator(): string {
    return `interface ValidationRule<T> {
  validate: (value: T) => boolean;
  message: string;
}

class Validator<T> {
  private rules: ValidationRule<T>[] = [];

  addRule(rule: ValidationRule<T>): this {
    this.rules.push(rule);
    return this;
  }

  validate(value: T): { valid: boolean; errors: string[] } {
    const errors = this.rules
      .filter(rule => !rule.validate(value))
      .map(rule => rule.message);
    return { valid: errors.length === 0, errors };
  }
}`;
  }

  private generateFormatter(): string {
    return `function formatDate(date: Date, format: string = 'YYYY-MM-DD'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day);
}

function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}`;
  }

  private generateSorter(): string {
    return `function bubbleSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  const result = [...arr];
  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < result.length - i - 1; j++) {
      if (compare(result[j], result[j + 1]) > 0) {
        [result[j], result[j + 1]] = [result[j + 1], result[j]];
      }
    }
  }
  return result;
}

function quickSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => compare(x, pivot) < 0);
  const middle = arr.filter(x => compare(x, pivot) === 0);
  const right = arr.filter(x => compare(x, pivot) > 0);
  return [...quickSort(left, compare), ...middle, ...quickSort(right, compare)];
}`;
  }

  private generateCache(): string {
    return `function memoize<T extends (...args: any[]) => any>(fn: T): T {
  const cache = new Map<string, ReturnType<T>>();
  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}`;
  }

  private generateEventEmitter(): string {
    return `class EventEmitter {
  private events: Map<string, Set<Function>> = new Map();

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
  }

  off(event: string, listener: Function): void {
    this.events.get(event)?.delete(listener);
  }

  emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach(listener => listener(...args));
  }

  once(event: string, listener: Function): void {
    const wrapper = (...args: any[]) => {
      listener(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }
}`;
  }

  private generateLinkedList(): string {
    return `class ListNode<T> {
  value: T;
  next: ListNode<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

class LinkedList<T> {
  head: ListNode<T> | null = null;
  tail: ListNode<T> | null = null;
  size: number = 0;

  append(value: T): void {
    const node = new ListNode(value);
    if (!this.tail) {
      this.head = this.tail = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }
    this.size++;
  }

  prepend(value: T): void {
    const node = new ListNode(value);
    node.next = this.head;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.size++;
  }
}`;
  }

  private generateTree(): string {
    return `class TreeNode<T> {
  value: T;
  children: TreeNode<T>[] = [];
  constructor(value: T) {
    this.value = value;
  }
}

class Tree<T> {
  root: TreeNode<T> | null = null;

  constructor(value?: T) {
    if (value !== undefined) {
      this.root = new TreeNode(value);
    }
  }

  traverseDFS(node: TreeNode<T> | null, visit: (n: TreeNode<T>) => void): void {
    if (!node) return;
    visit(node);
    node.children.forEach(child => this.traverseDFS(child, visit));
  }
}`;
  }

  private generateStack(): string {
    return `class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}`;
  }

  private generateQueue(): string {
    return `class Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  front(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}`;
  }

  private generateGenericCode(task: string): string {
    return `// 根据需求生成: ${task}\n// 请提供更具体的代码要求`;
  }

  private async optimizeCode(code: string, task: string): Promise<string> {
    const optimizations: string[] = [];

    if (task.includes('性能') || task.includes('优化')) {
      optimizations.push('// 已进行性能优化');
    }
    if (task.includes('可读性') || task.includes('清晰')) {
      optimizations.push('// 已提高代码可读性');
    }
    if (task.includes('安全') || task.includes('防护')) {
      optimizations.push('// 已添加安全检查');
    }

    return `${code}\n\n// 优化说明：\n${optimizations.join('\n')}`;
  }

  private async answerQuestion(question: string): Promise<string> {
    const lower = question.toLowerCase();

    if (question.includes('什么是') || question.includes('什么叫') || question.includes('是何')) {
      return this.explainConcept(question);
    }

    if (lower.includes('如何') || lower.includes('怎么')) {
      return this.explainHowTo(question);
    }

    if (lower.includes('为什么')) {
      return this.explainWhy(question);
    }

    return `关于你的问题"${question}"，让我来解答：\n\n这是一个很好的编程问题。如果你有具体的代码或场景，我可以给出更详细的解答。`;
  }

  private explainConcept(question: string): string {
    const concepts: Record<string, string> = {
      '闭包': '闭包是指一个函数能够访问其词法作用域之外的变量。简单来说，就是内部函数可以访问外部函数的变量。\n\n示例：\n```typescript\nfunction outer() {\n  const x = 10;\n  return function inner() {\n    console.log(x); // 可以访问 x\n  };\n}\n```',
      'promise': 'Promise 是 JavaScript 中处理异步操作的对象。它代表一个尚未完成但最终会完成的操作。\n\n三种状态：\n• Pending（进行中）\n• Fulfilled（已成功）\n• Rejected（已失败）',
      'async': 'async/await 是 ES2017 引入的异步编程语法糖。async 函数会返回一个 Promise，await 用于等待 Promise 完成。',
      'typescript': 'TypeScript 是 JavaScript 的超集，添加了类型系统。它可以在编译时发现类型错误，提高代码质量和可维护性。',
      'react': 'React 是一个用于构建用户界面的 JavaScript 库。它使用组件化的方式组织 UI，通过虚拟 DOM 提高渲染性能。',
      'hook': 'Hook 是 React 16.8 引入的新特性，让函数组件可以使用 state 和其他 React 特性。常用的 Hook 包括 useState、useEffect、useContext 等。',
      '组件': '组件是 React 应用的基本构建块，可以是类组件或函数组件。组件封装了 UI 逻辑和视图，具有可复用性和独立性。',
      '状态': '状态是 React 组件中用于存储和管理数据的内置变量。当状态改变时，组件会自动重新渲染。',
      '属性': '属性（Props）是 React 中父组件向子组件传递数据的方式。Props 是只读的，不能在子组件中修改。',
      '虚拟dom': '虚拟 DOM 是 React 的核心概念，它是真实 DOM 的 JavaScript 对象表示。通过对比虚拟 DOM 的差异，React 可以最小化真实 DOM 操作，提高性能。',
    };

    const cleanQuestion = question.replace(/^[\?\s，。、孬嘝]+/g, '').replace(/[\？\?]+$/g, '');

    for (const [key, value] of Object.entries(concepts)) {
      if (cleanQuestion.includes(key)) {
        return value;
      }
    }

    const withoutQuestionWords = cleanQuestion
      .replace(/什么是/g, '')
      .replace(/什么叫/g, '')
      .replace(/是何/g, '')
      .replace(/的意思/g, '')
      .trim();

    if (withoutQuestionWords.length > 0) {
      return `关于"${withoutQuestionWords}"，这是一个技术概念。`;
    }

    return `这是一个技术概念问题。请问你能提供更多上下文吗？比如你想了解哪个方面的内容？`;
  }

  private explainHowTo(question: string): string {
    return `关于"${question}"，这是一个实践性问题。\n\n如果你想了解具体的实现方法，请告诉我：\n1. 你使用的编程语言是什么？\n2. 有什么具体的场景或代码片段吗？\n\n这样我可以给出更准确的解答。`;
  }

  private explainWhy(question: string): string {
    return `关于"${question}"，这涉及到编程原理或语言设计的原因。\n\n如果你遇到了具体的技术问题，可以提供代码或错误信息，我可以帮你分析和解答。`;
  }

  // 工具调用历史和性能分析方法
  getToolCallHistory(): ToolCall[] {
    return [...this.toolCallHistory];
  }

  getToolPerformance(): ToolPerformance[] {
    return Array.from(this.toolPerformance.values());
  }

  getToolPerformanceByName(toolName: string): ToolPerformance | undefined {
    return this.toolPerformance.get(toolName);
  }

  // 工具选择优化：基于历史数据推荐工具
  recommendTool(task: string): string | null {
    const taskLower = task.toLowerCase();
    
    // 基于任务类型的规则匹配
    if (taskLower.includes('生成') || taskLower.includes('创建') || taskLower.includes('编写')) {
      return 'code_generation';
    }
    if (taskLower.includes('优化') || taskLower.includes('修复') || taskLower.includes('改进')) {
      return 'code_optimization';
    }
    if (taskLower.includes('解释') || taskLower.includes('如何') || taskLower.includes('什么')) {
      return 'question_answering';
    }
    
    // 基于历史性能数据的推荐
    const performanceData = Array.from(this.toolPerformance.entries())
      .map(([toolName, performance]) => ({
        toolName,
        score: performance.successRate * 0.7 + (1 - performance.averageDuration / 1000) * 0.3
      }))
      .sort((a, b) => b.score - a.score);
    
    if (performanceData.length > 0) {
      return performanceData[0].toolName;
    }
    
    return null;
  }

  // 清理工具调用历史
  clearToolCallHistory(): void {
    this.toolCallHistory = [];
  }

  // 重置工具性能统计
  resetToolPerformance(): void {
    this.toolPerformance.clear();
  }

  getReviewer() { return this.reviewer; }
  getMemory() { return null; }
  getToolsUsed() { return [...this.toolsUsed]; }

  // 对话历史管理方法
  private addToConversationHistory(role: 'user' | 'assistant' | 'system', content: string, context?: ConversationMessage['context']): void {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      context
    };
    
    this.conversationContext.messages.push(message);
    this.conversationContext.updatedAt = new Date().toISOString();
    
    // 限制历史长度
    if (this.conversationContext.messages.length > (this.config.maxConversationHistory || 10)) {
      this.conversationContext.messages = this.conversationContext.messages.slice(-(this.config.maxConversationHistory || 10));
    }
    
    // 更新当前主题
    if (role === 'user' && context?.task) {
      this.conversationContext.currentTopic = this.extractTopic(context.task);
      this.conversationContext.lastTask = context.task;
      
      // 提取并存储实体记忆
      this.extractAndStoreEntities(context.task);
    }
  }

  private extractTopic(text: string): string {
    // 简单的topic提取逻辑
    const words = text.split(/\s+/).slice(0, 5);
    return words.join(' ');
  }

  // 提取并存储实体记忆
  private extractAndStoreEntities(text: string): void {
    // 提取技术相关实体
    const techEntities = this.extractTechEntities(text);
    techEntities.forEach((value, key) => {
      this.conversationContext.entityMemory.set(key, value);
    });
    
    // 提取任务相关实体
    const taskEntities = this.extractTaskEntities(text);
    taskEntities.forEach((value, key) => {
      this.conversationContext.entityMemory.set(key, value);
    });
    
    // 识别意图
    if (this.config.enableIntentRecognition) {
      const intent = this.recognizeIntent(text);
      if (intent && intent.confidence > 0.7) {
        this.conversationContext.currentIntent = intent.name;
        // 存储意图参数
        Object.entries(intent.parameters).forEach(([key, value]) => {
          this.conversationContext.entityMemory.set(`intent_${key}`, String(value));
        });
      }
    }
  }

  // 意图识别
  private recognizeIntent(text: string): Intent | null {
    const lower = text.toLowerCase();
    const intents: Array<{name: string; pattern: RegExp; parameters?: (text: string) => Record<string, any>}> = [
      {
        name: 'greeting',
        pattern: /你好|hi|hello|嗨|hey|早上好|下午好|晚上好/i
      },
      {
        name: 'remember',
        pattern: /(记住|保存|记录|记住我|请记住).*/i
      },
      {
        name: 'code_generation',
        pattern: /生成|创建|编写|开发.*代码|函数|组件|模块/i
      },
      {
        name: 'code_optimization',
        pattern: /优化|改进|重构|提升.*代码|性能/i
      },
      {
        name: 'code_explanation',
        pattern: /解释|说明|介绍|讲解.*代码|原理|工作原理/i
      },
      {
        name: 'bug_fixing',
        pattern: /修复|解决|处理|排除.*错误|bug|问题/i
      },
      {
        name: 'continue_task',
        pattern: /继续|还有|还要|接着.*任务|之前|上次/i
      },
      {
        name: 'ask_question',
        pattern: /什么是|如何|怎么|为什么|是不是|能不能/i
      },
      {
        name: 'feedback',
        pattern: /好|棒|赞|谢谢|厉害|完美|喜欢|差|烂|糟糕|失望|生气/i
      }
    ];
    
    for (const intent of intents) {
      if (intent.pattern.test(lower)) {
        return {
          name: intent.name,
          confidence: 0.8,
          parameters: intent.parameters ? intent.parameters(text) : {}
        };
      }
    }
    
    return null;
  }

  // 对话状态转换
  private transitionDialogueState(newStateType: DialogueStateType, data?: DialogueState['data']): void {
    const newState: DialogueState = {
      id: crypto.randomUUID(),
      type: newStateType,
      timestamp: new Date().toISOString(),
      data: data || {},
      previousStateId: this.conversationContext.dialogueState.id
    };
    
    // 更新当前状态
    this.conversationContext.dialogueState = newState;
    this.conversationContext.dialogueHistory.push(newState);
    
    // 限制历史长度
    if (this.conversationContext.dialogueHistory.length > 20) {
      this.conversationContext.dialogueHistory = this.conversationContext.dialogueHistory.slice(-20);
    }
    
    // 更新期望输入
    if (data?.expectedInput) {
      this.conversationContext.expectedInput = data.expectedInput;
    }
    
    // 更新后续问题
    if (data?.followUpQuestions) {
      this.conversationContext.followUpQuestions = data.followUpQuestions;
    }
  }

  // 处理复杂对话逻辑
  private handleComplexDialogue(text: string): string {
    const intent = this.recognizeIntent(text);
    const emotion = this.emotionDetector.detect(text);
    
    // 根据当前对话状态和意图进行处理
    switch (this.conversationContext.dialogueState.type) {
      case 'greeting':
        if (intent?.name === 'greeting') {
          this.transitionDialogueState('task_request', {
            intent: 'greeting',
            expectedInput: '用户任务请求'
          });
          return '你好！有什么编程问题我可以帮你解答，或者需要我帮你生成什么代码吗？';
        } else if (intent?.name === 'remember') {
          // 提取记忆内容
          const memoryContent = text.replace(/记住|保存|记录|记住我|请记住/g, '').trim();
          if (memoryContent) {
            // 存储到实体记忆
            this.conversationContext.entityMemory.set('user_memory', memoryContent);
            this.transitionDialogueState('follow_up', {
              intent: 'remember',
              followUpQuestions: [
                '我已经记住了，还有其他需要我记住的吗？',
                '还有什么其他信息需要我保存吗？',
                '需要我帮你做什么其他事情吗？'
              ]
            });
            return '好的，我已经记住了！';
          }
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好')) {
          // 检索记忆
          const memory = this.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            this.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            this.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
        
      case 'task_request':
        if (intent?.name === 'code_generation') {
          this.transitionDialogueState('task_execution', {
            intent: 'code_generation',
            task: text,
            expectedInput: '代码执行结果反馈'
          });
          return '好的，我来帮你生成代码。请稍等...';
        } else if (intent?.name === 'remember') {
          // 提取记忆内容
          const memoryContent = text.replace(/记住|保存|记录|记住我|请记住/g, '').trim();
          if (memoryContent) {
            // 存储到实体记忆
            this.conversationContext.entityMemory.set('user_memory', memoryContent);
            this.transitionDialogueState('follow_up', {
              intent: 'remember',
              followUpQuestions: [
                '我已经记住了，还有其他需要我记住的吗？',
                '还有什么其他信息需要我保存吗？',
                '需要我帮你做什么其他事情吗？'
              ]
            });
            return '好的，我已经记住了！';
          }
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好')) {
          // 检索记忆
          const memory = this.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            this.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            this.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
        break;
        
      case 'task_execution':
        if (emotion.emotion === 'positive') {
          this.transitionDialogueState('follow_up', {
            intent: 'feedback',
            followUpQuestions: [
              '你还需要对这段代码进行优化吗？',
              '需要我解释代码的工作原理吗？',
              '还有其他功能需要实现吗？'
            ]
          });
          return '很高兴你对代码满意！你还需要其他帮助吗？';
        } else if (emotion.emotion === 'frustrated') {
          this.transitionDialogueState('clarification', {
            intent: 'feedback',
            expectedInput: '用户具体问题描述'
          });
          return '我注意到你可能对代码有一些问题。能具体告诉我你遇到了什么问题吗？';
        }
        break;
        
      case 'follow_up':
        if (text.includes('是') || text.includes('需要') || text.includes('对')) {
          this.transitionDialogueState('task_request', {
            intent: 'follow_up',
            expectedInput: '用户具体需求'
          });
          return '好的，告诉我你具体需要什么帮助？';
        } else if (text.includes('不') || text.includes('不需要') || text.includes('够了')) {
          this.transitionDialogueState('conclusion', {
            intent: 'follow_up',
            expectedInput: '用户新的需求'
          });
          return '好的，如果你有其他需要，随时告诉我！';
        } else if (text.includes('喜欢什么') || text.includes('我喜欢') || text.includes('我的偏好') || text.includes('我喜欢什么')) {
          // 检索记忆
          const memory = this.conversationContext.entityMemory.get('user_memory');
          if (memory) {
            this.transitionDialogueState('follow_up', {
              intent: 'ask_question',
              followUpQuestions: [
                '还有其他问题吗？',
                '需要我帮你做什么其他事情吗？',
                '还有什么其他信息需要我记住吗？'
              ]
            });
            return `根据我记住的信息，${memory}`;
          } else {
            this.transitionDialogueState('clarification', {
              intent: 'ask_question',
              expectedInput: '用户偏好信息'
            });
            return '我还没有关于你偏好的记忆。你可以告诉我你喜欢什么，我会记住的。';
          }
        }
    }
    
    return null;
  }

  // 提取技术相关实体
  private extractTechEntities(text: string): Map<string, string> {
    const entities = new Map<string, string>();
    const techKeywords = [
      'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust',
      'react', 'vue', 'angular', 'node.js', 'express', 'django', 'flask',
      'html', 'css', 'sass', 'less', 'tailwind', 'bootstrap',
      'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite',
      'git', 'github', 'gitlab', 'bitbucket',
      'vscode', 'intellij', 'eclipse', 'sublime', 'atom'
    ];
    
    const lowerText = text.toLowerCase();
    techKeywords.forEach(keyword => {
      if (lowerText.includes(keyword.toLowerCase())) {
        entities.set(`tech_${keyword.toLowerCase()}`, keyword);
      }
    });
    
    return entities;
  }

  // 提取任务相关实体
  private extractTaskEntities(text: string): Map<string, string> {
    const entities = new Map<string, string>();
    
    // 提取任务类型
    const taskTypes = [
      { pattern: /生成|创建|编写|开发/g, type: 'task_type', value: 'generation' },
      { pattern: /优化|改进|重构|提升/g, type: 'task_type', value: 'optimization' },
      { pattern: /修复|解决|处理|排除/g, type: 'task_type', value: 'fix' },
      { pattern: /解释|说明|介绍|讲解/g, type: 'task_type', value: 'explanation' },
      { pattern: /测试|验证|检查|调试/g, type: 'task_type', value: 'testing' }
    ];
    
    taskTypes.forEach(({ pattern, type, value }) => {
      if (pattern.test(text)) {
        entities.set(type, value);
      }
    });
    
    return entities;
  }

  // 获取记忆中的实体
  getMemoryEntity(key: string): string | undefined {
    return this.conversationContext.entityMemory.get(key);
  }

  // 存储实体到记忆
  setMemoryEntity(key: string, value: string): void {
    this.conversationContext.entityMemory.set(key, value);
  }

  // 清除记忆中的实体
  clearMemoryEntity(key: string): void {
    this.conversationContext.entityMemory.delete(key);
  }

  // 获取所有记忆实体
  getAllMemoryEntities(): Map<string, string> {
    return new Map(this.conversationContext.entityMemory);
  }

  // 对话状态管理方法
  getCurrentDialogueState(): DialogueState {
    return this.conversationContext.dialogueState;
  }

  getDialogueHistory(): DialogueState[] {
    return [...this.conversationContext.dialogueHistory];
  }

  getCurrentIntent(): string | null {
    return this.conversationContext.currentIntent;
  }

  getExpectedInput(): string | null {
    return this.conversationContext.expectedInput;
  }

  getFollowUpQuestions(): string[] {
    return [...this.conversationContext.followUpQuestions];
  }

  resetDialogueState(): void {
    const initialState: DialogueState = {
      id: crypto.randomUUID(),
      type: 'greeting',
      timestamp: new Date().toISOString(),
      data: {
        intent: 'greeting',
        expectedInput: '用户问候或任务请求'
      }
    };
    
    this.conversationContext.dialogueState = initialState;
    this.conversationContext.dialogueHistory = [initialState];
    this.conversationContext.currentIntent = null;
    this.conversationContext.expectedInput = null;
    this.conversationContext.followUpQuestions = [];
  }

  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationContext.messages];
  }

  getConversationContext(): ConversationContext {
    return {
      ...this.conversationContext,
      entityMemory: new Map(this.conversationContext.entityMemory)
    };
  }

  clearConversationHistory(): void {
    this.conversationContext.messages = [];
    this.conversationContext.currentTopic = null;
    this.conversationContext.lastTask = null;
    this.conversationContext.entityMemory.clear();
    this.conversationContext.updatedAt = new Date().toISOString();
  }

  getLastNMessages(n: number): ConversationMessage[] {
    return this.conversationContext.messages.slice(-n);
  }

  detectEmotion(text: string): EmotionResult {
    return this.emotionDetector.detect(text);
  }

  async saveSkill(skillName: string, skillCode: string, skillLanguage: string, skillDescription?: string): Promise<string | null> {
    // MemoryManager 已移除，技能保存不再可用
    console.warn('saveSkill: MemoryManager has been removed, skill not saved');
    return null;
  }

  async loadSkill(skillName: string): Promise<{ skillCode: string; skillLanguage: string; skillDescription?: string } | null> {
    console.warn('loadSkill: MemoryManager has been removed');
    return null;
  }

  async findSimilarSkills(code: string, language?: string): Promise<Array<{ skillName: string; skillCode: string; skillLanguage: string; skillDescription?: string }>> {
    return [];
  }

  async getAllSkills(): Promise<Array<{ skillName: string; skillDescription?: string; usageCount: number; lastUsedAt?: number }>> {
    return [];
  }

  private async suggestSkillCode(task: string): Promise<string | null> {
    const skillMatch = task.match(/(?:保存|存储|记住).*(?:技能|代码|function|函数|class|组件)/i);
    if (!skillMatch) {
      return null;
    }
    
    const skillNameMatch = task.match(/(?:名称|名字|叫)[^\w]+(\w+)/i);
    const skillName = skillNameMatch ? skillNameMatch[1] : '未命名技能';
    
    return skillName;
  }

  private async handleSkillRequest(task: string): Promise<string | null> {
    // 处理保存技能的请求
    if (task.match(/(?:保存|存储|记住).*(?:技能|代码|function|函数|class|组件)/i)) {
      const skillName = await this.suggestSkillCode(task);
      if (skillName) {
        // 生成技能代码（这里简化处理，实际应该基于任务生成）
        const skillCode = `function example() {
  console.log('Hello, skill!');
}`;
        const saveResult = await this.saveSkill(skillName, skillCode, 'javascript', '示例技能');
        if (saveResult) {
          return `技能 "${skillName}" 保存成功！`;
        } else {
          return '保存技能失败，请重试。';
        }
      }
    }
    
    // 处理使用技能的请求
    if (task.match(/(?:使用|调用|复用|加载).*(?:技能|代码|function|函数)/i)) {
      return await this.reuseExistingSkill(task);
    }
    
    // 处理列出技能的请求
    if (task.match(/(?:列出|显示|查看).*技能/i)) {
      const skills = await this.getAllSkills();
      if (skills.length > 0) {
        const skillList = skills.map((skill, index) => `${index + 1}. ${skill.skillName} (使用次数: ${skill.usageCount})`).join('\n');
        return `已保存的技能：\n\n${skillList}`;
      } else {
        return '还没有保存任何技能。';
      }
    }
    
    return null;
  }

  private async reuseExistingSkill(task: string): Promise<string | null> {
    const reuseMatch = task.match(/(?:使用|调用|复用|加载).*(?:技能|代码|function|函数)/i);
    if (!reuseMatch) {
      return null;
    }
    
    const skillNameMatch = task.match(/技能[\s:：]+"?([^"\s]+)"?|技能\s+"([^"]+)"|(?:使用|调用|复用|加载)\s+(\w+)/i);
    if (skillNameMatch) {
      const skillName = skillNameMatch[1] || skillNameMatch[2] || skillNameMatch[3];
      const skill = await this.loadSkill(skillName);
      if (skill) {
        return `找到已保存的技能 "${skillName}"：\n\n\`\`\`${skill.skillLanguage}\n${skill.skillCode}\n\`\`\`\n\n${skill.skillDescription || '这是一个已保存的技能。'}`;
      }
    }
    
    const similarSkills = await this.findSimilarSkills(task);
    if (similarSkills.length > 0) {
      const skillList = similarSkills.map((s, i) => `${i + 1}. ${s.skillName} (${s.skillLanguage})`).join('\n');
      return `找到 ${similarSkills.length} 个相似技能：\n\n${skillList}\n\n请告诉我你想使用哪个技能。`;
    }
    
    return null;
  }

  private continueLastTask(): string {
    if (!this.conversationContext.lastTask) {
      return '我没有找到上一次的任务记录。能否重新描述一下你想要完成的任务？';
    }
    
    const lastMessages = this.getLastNMessages(4);
    const contextSummary = lastMessages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    return `好的，让我们继续上次的任务。\n\n上一次任务：${this.conversationContext.lastTask}\n\n相关上下文：\n${contextSummary}\n\n请告诉我你想要继续做什么，或者需要什么帮助？`;
  }
}
export default Agent;