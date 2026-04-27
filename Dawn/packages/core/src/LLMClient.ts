/**
 * @dawn/core — 统一 LLM 客户端
 *
 * 合并自：
 *   - src/engine/core/LLMProvider.ts
 *   - src/services/llmService.ts
 *
 * 提供统一的 callDeepSeek、指数退避重试、API Key 管理。
 */

// ── API Key 管理 ──

/** 模块级注入（绕过 globalThis 跨模块丢失问题）*/
let _injectedApiKey = '';
let _injectedBaseUrl = '';

export function setInjectedApiKey(key: string, baseUrl?: string): void {
  _injectedApiKey = key;
  if (baseUrl) _injectedBaseUrl = baseUrl;
}

/**
 * 获取 API Key
 * 优先级：模块级注入 > globalThis > Bun.env > process.env
 */
export function getApiKey(): string {
  try {
    const key = (
      _injectedApiKey ||
      (globalThis as any).__DAWN_API_KEY ||
      (typeof Bun !== 'undefined' ? (Bun as any).env.DEEPSEEK_API_KEY : '') ||
      process.env.DEEPSEEK_API_KEY ||
      ''
    );
    if (!key) {
      console.warn('[LLMClient] 所有 API Key 来源均为空');
    }
    return key;
  } catch {
    return '';
  }
}

/**
 * 获取 Base URL
 * 优先级：模块级注入 > globalThis > process.env > 默认值
 */
export function getBaseUrl(): string {
  try {
    return (
      _injectedBaseUrl ||
      (globalThis as any).__DAWN_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      'https://api.deepseek.com'
    );
  } catch {
    return 'https://api.deepseek.com';
  }
}

// ── 消息类型 ──

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  stream?: boolean;
  /** 重试次数，默认 3 */
  retries?: number;
}

export interface LLMResult {
  success: boolean;
  text: string | null;
  error?: string;
  /** 实际使用的重试次数（0 = 首次成功） */
  retriesUsed: number;
}

// ── 辅助 ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 核心调用 ──

/**
 * 内部实现 — 返回完整 LLMResult
 *
 * 内置指数退避重试：
 *   - 默认重试 3 次
 *   - HTTP 429（限流）自动退避 1s → 2s → 4s
 *   - 网络异常也退避重试
 *   - 失败时记录日志
 */
export async function callDeepSeekRaw(
  messages: LLMMessage[],
  options?: LLMOptions,
): Promise<LLMResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    const msg = '[LLMClient] DEEPSEEK_API_KEY 未设置，回退到本地规则';
    console.warn(msg);
    return { success: false, text: null, error: msg, retriesUsed: 0 };
  }

  const baseURL = getBaseUrl().replace(/\/+$/, '');
  const url = `${baseURL}/v1/chat/completions`;
  const TIMEOUT_MS = options?.timeout ?? 60000;
  const useStream = options?.stream ?? false;
  const maxRetries = options?.retries ?? 3;
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens ?? 2048;

  let lastError: string | undefined;
  let retriesUsed = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000; // 1s → 2s → 4s
      console.log(`[LLMClient] 重试第 ${attempt}/${maxRetries} 次，等待 ${delay}ms`);
      await sleep(delay);
      retriesUsed = attempt;
    }

    console.log(
      `[LLMClient] 调用 DeepSeek... POST ${url} (stream=${useStream}, timeout=${TIMEOUT_MS}ms, attempt=${attempt + 1})`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: useStream,
        }),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        lastError = `HTTP ${res.status}: ${errText}`;

        if (res.status === 429) {
          console.warn(`[LLMClient] 限流 (429)，${attempt < maxRetries ? '准备重试' : '已达最大重试次数'}`);
          continue;
        }

        console.error(`[LLMClient] 请求失败: ${lastError}`);
        return { success: false, text: null, error: lastError, retriesUsed };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json?.choices?.[0]?.message?.content;
      if (content) {
        console.log(`[LLMClient] 回复成功 (${content.length} chars, retries=${retriesUsed})`);
        return { success: true, text: content, retriesUsed };
      }

      lastError = 'API 返回空内容';
      console.warn(`[LLMClient] ${lastError}`);
      continue;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        lastError = `请求超时 (${TIMEOUT_MS}ms)`;
      } else {
        lastError = err.message || '未知错误';
      }
      console.error(`[LLMClient] 请求异常 (attempt ${attempt + 1}): ${lastError}`);

      if (attempt >= maxRetries) {
        console.error(`[LLMClient] 已达最大重试次数 (${maxRetries})，放弃`);
      }
    }
  }

  console.error(`[LLMClient] 最终失败: ${lastError}`);
  return { success: false, text: null, error: lastError, retriesUsed };
}

/**
 * 向后兼容的 callDeepSeek — 返回 string | null
 *
 * 新代码推荐使用 callDeepSeekRaw 获取完整 LLMResult。
 */
export async function callDeepSeek(
  messages: LLMMessage[],
  options?: LLMOptions,
): Promise<string | null> {
  const result = await callDeepSeekRaw(messages, options);
  return result.success ? result.text : null;
}

// ── System Prompt ──

export const SYSTEM_PROMPT = `你是一个专业的编程助手，名叫 Dawn。

语气和风格：
- 说话像真人，自然、直接、简洁。不要模板感，不要机械。
- 用户简短你就简短，用户详细你就详细。
- 代码任务：先一句话说明思路，再贴代码，最后加一句实用建议。代码要完整可直接运行。
- 技术问题：定义 -> 实际例子 -> 关键点，三层就够了。
- 问候/闲聊：正常聊天就行，别端架子。如果用户问"心情怎么样"之类，自然回应。
- 用户说"介绍一下你自己"：回答 "Dawn，本地编程助手，能帮你写代码、改代码、回答问题" 这种短句即可，别长篇。
- 所有代码默认用 TypeScript，除非用户指定其他语言。
- 不知道就说不知道，别强行编。

避免：
- 不要反问"你具体要什么"、"能提供更多上下文吗"
- 不要用"好的，关于X，这是一个..."这种模板开头
- 不要每句话加"！"或表情符号
- 不要解释自己的回答规则`;
