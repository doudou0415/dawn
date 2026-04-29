/**
 * BrowserCapability — 网页搜索与浏览原子能力
 * 包装 HumanBrowser 为标准 AtomicCapability。
 *
 * 安全策略：
 * - URL 白名单：仅允许 http/https 协议
 * - 禁止内网地址（127.0.0.1, localhost, 10.x, 172.16-31.x, 192.168.x）
 * - 超时控制
 */

import type { AtomicCapability, CapabilityInput } from '@dawn/core';
import type { CapabilityResult } from '../../registry/types.js';
import { searchWeb, browse, shouldSearchWeb } from './HumanBrowser.js';
import { getLogger } from '@dawn/core';

const logger = getLogger('BrowserCapability');

/**
 * 内网 IP 正则（禁止访问）
 */
const PRIVATE_IP = /https?:\/\/(127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0)/i;

/**
 * 仅允许 http/https 协议
 */
const ALLOWED_PROTOCOLS = /^https?:\/\//i;

export class BrowserCapability implements AtomicCapability {
  readonly name = 'browser';
  readonly description = '网页搜索与内容抓取';
  readonly intentTypes = ['web_search', 'browse'] as any;
  readonly permissions = ['network:http'];

  /** 浏览超时（15s） */
  private readonly BROWSE_TIMEOUT = 15_000;

  async execute(input: CapabilityInput): Promise<CapabilityResult> {
    const rawInput = (input as any).rawInput || '';

    // 检测是否为 URL 浏览
    const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];

      // URL 安全检查
      const urlCheck = this.validateUrl(url);
      if (!urlCheck.safe) {
        logger.warn(`URL 被阻止: ${url} — ${urlCheck.reason}`);
        return {
          success: false,
          output: `[安全拦截] ${urlCheck.reason}: ${url}`,
          metadata: { type: 'browse', url, blocked: true },
          permissionsUsed: ['network:http'],
        };
      }

      const result = await this.browseWithTimeout(url);
      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { type: 'browse', url },
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

  /**
   * 验证 URL 的安全性
   */
  private validateUrl(url: string): { safe: boolean; reason: string } {
    if (!ALLOWED_PROTOCOLS.test(url)) {
      return { safe: false, reason: '仅允许 http/https 协议' };
    }

    if (PRIVATE_IP.test(url)) {
      return { safe: false, reason: '禁止访问内网地址' };
    }

    return { safe: true, reason: '' };
  }

  /**
   * 带超时的浏览
   */
  private async browseWithTimeout(url: string): Promise<string | object> {
    try {
      const result = await Promise.race([
        browse(url),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('浏览超时')), this.BROWSE_TIMEOUT),
        ),
      ]);
      return result;
    } catch (error) {
      return `浏览失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
