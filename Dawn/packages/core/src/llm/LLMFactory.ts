/**
 * @dawn/core — LLM 工厂
 *
 * 根据 LLM_PROVIDER 环境变量切换 Provider。
 * 当前支持: deepseek（默认）
 */

import type { LLMProvider } from './LLMProvider.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';

let _instance: LLMProvider | null = null;

/**
 * 获取 LLM Provider 实例（单例）
 *
 * 环境变量 LLM_PROVIDER 控制选择哪个 Provider：
 *   - 'deepseek'（默认）
 *
 * 环境变量 LLM_MODEL 控制具体模型名：
 *   - 默认 'deepseek-chat'
 */
export function getLLMProvider(): LLMProvider {
  if (_instance) return _instance;

  const provider = (process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
  const model = process.env.LLM_MODEL || 'deepseek-chat';

  switch (provider) {
    case 'deepseek':
    default:
      _instance = new DeepSeekProvider(model);
      break;
  }

  return _instance;
}

/**
 * 重置 Provider 单例（主要用于测试）
 */
export function resetLLMProvider(): void {
  _instance = null;
}

/**
 * 注入自定义 Provider（测试 / 降级用）
 */
export function setLLMProvider(provider: LLMProvider): void {
  _instance = provider;
}
