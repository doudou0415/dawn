/**
 * types.ts — 统一类型导出
 *
 * 作为项目核心类型的统一入口，各模块从此导入而非分散定义。
 */

// ── 引擎类型 (from packages/core) ──
export type {
  OrchestratorConfig,
  OrchestratorResult,
  IntentResult,
  TaskCategory,
  AgentConfig,
  ToolCall,
  ToolPerformance,
  ConversationMessage,
  ConversationContext,
  DialogueState,
  DialogueStateType,
  EmotionResult,
  ReviewResult,
  Capability,
  CapabilityInput,
  AgentResult,
} from '@dawn/core/types.js';

// ── 记忆类型 ──
export type {
  MemoryType,
  MemoryIndexEntry,
  MemoryIndex,
} from './memory/memoryTypes.js';

// ── 进化引擎类型 ──
export type {
  TaskAnalysis,
  ImprovementSuggestion,
} from './evolution/SelfEvolutionEngine.js';
