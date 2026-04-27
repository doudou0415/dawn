/**
 * @dawn/core — 核心类型、DI 容器、LLM 客户端
 */

export * from './types.js';
export { Container } from './Container.js';
export {
  callDeepSeek,
  callDeepSeekRaw,
  getApiKey,
  getBaseUrl,
  setInjectedApiKey,
  SYSTEM_PROMPT,
} from './LLMClient.js';

export type { LLMMessage, LLMOptions, LLMResult } from './LLMClient.js';
export {
  Logger,
  LogLevel,
  getLogger,
  setLogLevel,
  disposeAllLoggers,
} from './Logger.js';

export type { LogSink } from './Logger.js';
export { ConsoleSink, FileSink } from './Logger.js';
