/**
 * ChatCapability — 对话能力
 * 处理普通对话、帮助、打招呼等意图。
 */

import { Capability, CapabilityInput } from './CapabilityRegistry';

export class ChatCapability implements Capability {
  readonly name = 'chat';
  readonly description = '普通对话回复能力';
  readonly intentTypes = ['chat'] as const;

  async execute(input: CapabilityInput): Promise<unknown> {
    const { rawInput } = input;

    if (/^(hi|hello|hey|你好)/i.test(rawInput)) {
      return { type: 'greeting', message: '你好！我是 Dawn，你的本地编程助手。有什么可以帮你的？' };
    }

    if (/^(help|\/help)/i.test(rawInput)) {
      return {
        type: 'help',
        message: '可用命令：\n- 代码审查 /review\n- 搜索 /search\n- 文件操作 /file\n- 记忆 /memory',
      };
    }

    return { type: 'chat', message: `收到：${rawInput}` };
  }
}
