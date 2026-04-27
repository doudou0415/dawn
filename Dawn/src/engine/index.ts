// ── 核心导出 ──
export { Agent } from './core/Agent.js';
export type { PermissionHandler as PermissionChain } from './permissionChain.js';
export { SessionTemplate } from './sessionTemplate.js';

// ── 权限系统（Dawn 本体移植） ──
export {
  PermissionService,
  PermissionChainBuilder,
  SuperAdminHandler,
  PermissionLevelHandler,
  RolePermissionHandler,
  TimeRestrictionHandler,
  IPWhitelistHandler,
  ResourceOwnerHandler,
  WhitelistHandler,
  BasePermissionHandler,
  createDefaultPermissionChain,
  permissionService,
} from './permissionChain.js';

export type {
  PermissionHandler,
  PermissionRequest,
  PermissionResult,
  PermissionMode,
  ExternalPermissionMode,
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionLevel,
} from './permissionChain.js';

export { EXTERNAL_PERMISSION_MODES, INTERNAL_PERMISSION_MODES, PERMISSION_LEVEL_LABELS } from './permissionChain.js';

// ── 新模块（Phase 1 拆解后） ──
export { IntentEngine as NewIntentEngine } from './intent/IntentEngine.js';
export { Coordinator } from './coordinator/Coordinator.js';
export { RuntimeContext } from './runtime/RuntimeContext.js';

// ── Core 子模块 ──
export { EmotionDetector } from './core/EmotionDetector.js';
export { ResponseGenerator } from './core/ResponseGenerator.js';
export { HistoryManager } from './core/HistoryManager.js';
export { ExecutionLoop } from './core/ExecutionLoop.js';
export { callDeepSeek, getApiKey, getBaseUrl, SYSTEM_PROMPT } from './core/LLMProvider.js';
