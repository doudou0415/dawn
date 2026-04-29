/**
 * @dawn/core — LLM 抽象接口
 *
 * 所有 LLM Provider 必须实现此接口。
 * 支持 chat / stream / embed / healthCheck / getModelInfo。
 */

import type { LLMMessage } from '../LLMClient.js';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface ChatResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface Chunk {
  content: string;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<Chunk>;
  embed(text: string): Promise<number[]>;
  healthCheck(): Promise<boolean>;
  getModelInfo(): { model: string; provider: string };
}
