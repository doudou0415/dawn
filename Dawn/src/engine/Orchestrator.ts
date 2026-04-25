import { isEnvTruthy } from '../utils/envUtils.js';

const MAX_TOOL_CALLS = 10
let toolCallCount = 0

export function checkToolCallLimit(): boolean {
  // 在工具调用时累加
  if (toolCallCount >= MAX_TOOL_CALLS) {
    console.log('达到最大工具调用次数，停止执行')
    return true;
  }
  return false;
}

/**
 * 粗略估算消息数组的 token 数（按 4 字符/token 估算）
 */
function estimateTokens(messages: any[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
    totalChars += text.length;
  }
  return Math.round(totalChars / 4);
}

export async function runOrchestrator(input: string): Promise<{ response: string }> {
  const compressionEnabled = isEnvTruthy(process.env.CONTEXT_COMPRESSION_ENABLED);

  if (compressionEnabled) {
    // 从 globalThis 获取当前消息列表（由上游注入）
    const messages = (globalThis as any).__orchestratorMessages as any[] | undefined;
    if (messages && messages.length > 20) {
      const beforeTokens = estimateTokens(messages);
      const compressed = messages.slice(-20);
      const afterTokens = estimateTokens(compressed);
      console.log(`[Context] 压缩率: ${beforeTokens} → ${afterTokens} (${Math.round(afterTokens / beforeTokens * 100)}%)`);
    }
  }

  // Orchestrator runtime: delegates the input to an Agent
  const { default: Agent } = await import('./Agent.js');
  const agent = new Agent();
  return agent.execute(input);
}
