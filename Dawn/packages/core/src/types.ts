/**
 * @dawn/core — 核心类型定义
 *
 * 所有引擎模块共享的核心接口，通过 DI 容器注入。
 */

// ── Agent 状态机 ──

export enum AgentState {
  Idle = 'idle',
  Initializing = 'initializing',
  Processing = 'processing',
  ExecutingTool = 'executing_tool',
  Responding = 'responding',
  Error = 'error',
  Terminated = 'terminated',
}

export enum DialogueStateType {
  Greeting = 'greeting',
  TaskRequest = 'task_request',
  TaskExecution = 'task_execution',
  FollowUp = 'follow_up',
  Clarification = 'clarification',
  Conclusion = 'conclusion',
  Error = 'error',
}

// ── 意图系统 ──

export enum TaskCategory {
  CodeGeneration = 'code_generation',
  CodeModification = 'code_modification',
  Question = 'question',
  Greeting = 'greeting',
  General = 'general',
  Unknown = 'unknown',
}

export interface IntentResult {
  category: TaskCategory;
  confidence: number;
  taskDescription: string;
  keywords: string[];
  requiresTool: boolean;
}

// ── 工具调用 ──

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

// ── 对话 ──

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

// ── 情绪系统 ──

export interface EmotionResult {
  emotion: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'excited';
  intensity: number;
  confidence: number;
}

// ── 代码审查 ──

export interface ReviewResult {
  score?: number;
  issues?: Array<{ severity: string; message: string }>;
}

// ── Agent 配置 ──

export interface AgentConfig {
  enableSelfReview?: boolean;
  enableMemory?: boolean;
  enableToolPerformanceTracking?: boolean;
  enableConversationHistory?: boolean;
  maxConversationHistory?: number;
  enableAdvancedDialogue?: boolean;
  enableIntentRecognition?: boolean;
  memoryBasePath?: string;
}

// ── Agent 执行结果 ──

/** @deprecated 旧版知识存储类型 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KnowledgeData = any;

export interface AgentResult {
  response: string;
  reviewResult?: ReviewResult;
  learnedKnowledge?: KnowledgeData;
  memorySummary?: string;
}

// ── 编排器 ──

export interface OrchestratorConfig {
  enableCompression?: boolean;
  maxHistoryLength?: number;
  enableAnalytics?: boolean;
  memoryBasePath?: string;
  evolutionEnabled?: boolean;
}

export interface OrchestratorResult {
  response: string;
  category: string;
  confidence: number;
  timestamp: string;
  meta?: {
    toolCalls?: string[];
    executionTimeMs?: number;
    evolutionSuggestions?: number;
  };
}

// ── 进化引擎 ──

export interface EvolutionTask {
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

export interface EvolutionInsight {
  id: string;
  type: 'pattern' | 'optimization' | 'learning' | 'suggestion';
  description: string;
  confidence: number;
  source: string;
  timestamp: string;
}

// ── 记忆系统 ──

export interface MemoryEntry {
  id: string;
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  type: 'session' | 'persistent' | 'skill';
  timestamp: string;
  ttl?: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
}

export interface MemoryContext {
  session: MemoryEntry[];
  persistent: MemoryEntry[];
  skill: MemoryEntry[];
  summary: string;
}

// ── 能力系统 ──

export type CapabilityInput = Record<string, unknown>;

/** 旧版能力接口（向后兼容） */
export interface Capability {
  name: string;
  intentTypes: TaskCategory[];
  execute(input: CapabilityInput): Promise<{ success: boolean; output: string }>;
}

/** 能力执行结果 */
export interface CapabilityResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
  permissionsUsed?: string[];
  durationMs?: number;
}

/** 原子能力接口 — 最小不可拆能力单元 */
export interface AtomicCapability {
  name: string;
  description: string;
  intentTypes: TaskCategory[];
  permissions: string[];
  execute(input: CapabilityInput): Promise<CapabilityResult>;
  validate?(input: CapabilityInput): boolean;
}

/** 复合能力接口 — 编排多个原子能力完成高阶任务 */
export interface CompositeCapability {
  name: string;
  description: string;
  subCapabilities: string[];
  execute(input: CapabilityInput): Promise<CapabilityResult>;
}
