/**
 * BrowserCapability — 网页搜索与浏览原子能力
 * 包装 HumanBrowser 为标准 AtomicCapability。
 */
import type { AtomicCapability, CapabilityInput } from '@dawn/core';
import type { CapabilityResult } from '../../registry/types.js';
import { searchWeb, browse, shouldSearchWeb } from './HumanBrowser.js';

export class BrowserCapability implements AtomicCapability {
  readonly name = 'browser';
  readonly description = '网页搜索与内容抓取';
  readonly intentTypes = ['web_search', 'browse'] as any;
  readonly permissions = ['network:http'];

  async execute(input: CapabilityInput): Promise<CapabilityResult> {
    const rawInput = (input as any).rawInput || '';

    // 检测是否为 URL 浏览
    const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const result = await browse(urlMatch[0]);
      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { type: 'browse', url: urlMatch[0] },
        permissionsUsed: ['network:http'],
      };
    }

    // 搜索意图检测
    if (shouldSearchWeb(rawInput)) {
      const query = rawInput.replace(/^(search|搜索|find|查找|查询)/i, '').trim();
      const result = await searchWeb(query || rawInput);
      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { type: 'web_search', query: query || rawInput },
        permissionsUsed: ['network:http'],
      };
    }

    return {
      success: true,
      output: '请指定搜索关键词或 URL，例如：search TypeScript 教程',
      metadata: { type: 'prompt' },
    };
  }
}
