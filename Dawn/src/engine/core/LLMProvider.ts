/**
 * @dawn/engine — LLM Provider（桥接层）
 *
 * 统一转发至 @dawn/core 的 LLMClient 实现。
 * 保留此文件以确保现有 import 路径不破坏。
 */

export {
  callDeepSeek,
  getApiKey,
  getBaseUrl,
  setInjectedApiKey,
  SYSTEM_PROMPT,
} from '@dawn/core/LLMClient.js';

export type { LLMMessage, LLMOptions, LLMResult } from '@dawn/core/LLMClient.js';
