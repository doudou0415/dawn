/**
 * ResponseCapability — 对话回复能力
 *
 * 覆盖所有"非工具任务"的普通对话场景：
 * - 问候、确认、否定
 * - 技术问答（概念解释、HowTo、Why）
 * - 闲聊、继续上次任务等
 *
 * 与 CapabilityRegistry 集成，走统一路由：
 *   IntentEngine.parse() → CapabilityRegistry.match() → CapabilityRegistry.executeAtomic()
 *
 * 设计原则：
 * - 不硬编码意图分类（由 IntentEngine 判断）
 * - 不包含文件操作（由 FileOpsCapability 处理）
 * - 不包含代码生成（由 CodeGenerationCapability 处理）
 * - 纯文本对话，直接返回字符串
 */

import { getLogger } from '@dawn/core';
const logger = getLogger('ResponseCapability');
import type { AtomicCapability, AtomicInput, CapabilityResult } from '../../registry/types.js';

export class ResponseCapability implements AtomicCapability {
  readonly name = 'response';
  readonly description = '普通对话回复（问候、确认、问答、闲聊）';
  readonly intentTypes: TaskCategory[] = ['chat' as TaskCategory, 'question' as TaskCategory, 'greeting' as TaskCategory, 'confirmation' as TaskCategory];
  readonly permissions: string[] = [];

  async execute(input: AtomicInput): Promise<CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';

    // 问候
    if (this.containsGreeting(rawInput)) {
      const rest = rawInput.replace(/你好|您好|hi|hello|嗨|hey|早上好|下午好|晚上好|在吗|在嘛/ig, '').trim();
      const greeting = rest || '嗨，我是 Dawn。写代码、改代码、查问题都行，直接说。';
      return { success: true, output: greeting };
    }

    // 确认
    if (this.isConfirmation(rawInput)) {
      return { success: true, output: '嗯，你说。' };
    }

    // 否定
    if (this.isNegation(rawInput)) {
      return { success: true, output: '好，有需要再叫我。' };
    }

    // 技术概念解释
    const conceptAnswer = this.explainConcept(rawInput);
    if (conceptAnswer) {
      return { success: true, output: conceptAnswer };
    }

    // 兜底（不应被触发 — Coordinator 已强制 response 走 LLM）
    logger.warn('[ResponseCapability] 兜底被意外调用！（Coordinator 应已拦截）');
    return {
      success: true,
      output: `[DEBUG] ResponseCapability 被意外调用: ${rawInput}`,
    };
  }

  private containsGreeting(text: string): boolean {
    const greetings = ['你好', 'hi', 'hello', '嗨', 'hey', '早上好', '下午好', '晚上好', '在吗', '在嘛'];
    return greetings.some(g => text.toLowerCase().includes(g));
  }

  private isConfirmation(text: string): boolean {
    const confirmations = ['好的', '嗯', 'ok', 'okay', '对对', '没错', '是的'];
    const lower = text.toLowerCase().trim();
    return confirmations.some(c => lower === c || lower.endsWith(c) || lower.startsWith(c));
  }

  private isNegation(text: string): boolean {
    const negations = ['不', '没', '否', '不要', '不用', '算了'];
    return negations.some(n => text.includes(n));
  }

  private explainConcept(question: string): string | null {
    const lower = question.toLowerCase();
    const concepts: Record<string, string> = {
      '闭包': `闭包是指一个函数能访问其词法作用域之外的变量。即使外部函数已返回，内部函数仍持有对外部变量的引用。\n\n\`\`\`typescript\nfunction createCounter() {\n  let count = 0;\n  return function() {\n    count++;\n    return count;\n  };\n}\nconst counter = createCounter();\nconsole.log(counter()); // 1\nconsole.log(counter()); // 2\n\`\`\``,
      'promise': `Promise 是 JavaScript 处理异步操作的对象，表示一个未来完成的操作。状态：Pending → Fulfilled / Rejected。`,
      'async': `async/await 是 Promise 的语法糖，让异步代码看起来像同步代码。`,
      'typescript': 'TypeScript 是 JavaScript 的超集，在 JS 基础上增加了静态类型系统。编译时就能捕获类型错误，IDE 支持更好。',
      'react': 'React 是一个构建用户界面的 JavaScript 库。核心是组件化，UI 被拆成独立、可复用的组件。',
      'hook': `Hook 是 React 16.8 引入的特性，让函数组件能使用状态和生命周期能力。`,
    };

    for (const [key, value] of Object.entries(concepts)) {
      if (lower.includes(key)) {
        return value;
      }
    }

    return null;
  }
}
