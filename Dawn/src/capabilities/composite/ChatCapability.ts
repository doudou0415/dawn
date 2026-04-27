/**
 * ChatCapability — 对话能力
 * 处理普通对话、帮助、打招呼等意图。
 */

import type { CompositeCapability, AtomicInput } from '../registry/types.js';

export class ChatCapability implements CompositeCapability {
  readonly name = 'chat';
  readonly description = '普通对话回复能力';
  readonly subCapabilities: string[] = [];

  async execute(input: AtomicInput, _registry?: { getAtomic(name: string): import('../registry/types.js').AtomicCapability | undefined }): Promise<import('../registry/types.js').CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';

    if (/^(hi|hello|hey|你好)/i.test(rawInput)) {
      return { success: true, output: '你好！我是 Dawn，你的本地编程助手。有什么可以帮你的？' };
    }

    if (/^(help|\/help)/i.test(rawInput)) {
      return {
        success: true,
        output: '可用命令：\n- 代码审查 /review\n- 搜索 /search\n- 文件操作 /file\n- 记忆 /memory',
      };
    }

    return { success: true, output: `收到：${rawInput}` };
  }
}
