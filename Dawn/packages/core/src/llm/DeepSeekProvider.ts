/**
 * @dawn/core — DeepSeek Provider
 *
 * 将原有 callDeepSeek / callDeepSeekRaw 包装为 LLMProvider 接口。
 */

import type { LLMMessage } from '../LLMClient.js';
import { callDeepSeekRaw, getApiKey, getBaseUrl } from '../LLMClient.js';
import type { ChatOptions, ChatResponse, Chunk, LLMProvider } from './LLMProvider.js';
import { getDefaultCache } from './LLMCache.js';

export class DeepSeekProvider implements LLMProvider {
  readonly model: string;
  readonly providerName = 'deepseek';

  constructor(model = 'deepseek-chat') {
    this.model = model;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // 查找缓存
    const cache = getDefaultCache();
    const cached = cache.get(messages);
    if (cached) return cached;

    const result = await callDeepSeekRaw(messages, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      timeout: options?.timeout,
    });

    if (!result.success || result.text === null) {
      throw new Error(`DeepSeek chat failed: ${result.error ?? 'unknown error'}`);
    }

    const response: ChatResponse = {
      content: result.text,
      usage: undefined,
    };

    // 写入缓存
    cache.set(messages, response);
    return response;
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<Chunk> {
    // 通过 fetch SSE 实现流式
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未设置');

    const baseURL = getBaseUrl().replace(/\/+$/, '');
    const url = `${baseURL}/v1/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 2048,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      throw new Error(`DeepSeek stream error: HTTP ${res.status}: ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('DeepSeek stream: 无响应体');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            yield { content: delta };
          }
        } catch {
          // 跳过无法解析的 chunk
        }
      }
    }
  }

  async embed(_text: string): Promise<number[]> {
    // DeepSeek 不原生支持 embed，返回空数组
    console.warn('[DeepSeekProvider] embed 暂未实现，返回空向量');
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await callDeepSeekRaw(
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 1, timeout: 5000 },
      );
      return result.success;
    } catch {
      return false;
    }
  }

  getModelInfo(): { model: string; provider: string } {
    return { model: this.model, provider: this.providerName };
  }
}
