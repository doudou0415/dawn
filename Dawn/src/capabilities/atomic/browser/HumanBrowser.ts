/**
 * HumanBrowser — 网页搜索与内容抓取能力
 *
 * 提供搜索引擎查询和网页内容提取功能。
 * 支持多引擎 fallback，自动提取可读摘要。
 */

const SEARCH_ENGINES = [
  // Bing — 之前验证过的可用引擎
  { name: 'bing', url: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  // DuckDuckGo HTML 版
  { name: 'duckduckgo', url: (q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  // Google fallback
  { name: 'google', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en` },
];

import { logger } from '../../../utils/index.js';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface BrowserResult {
  success: boolean;
  summary: string;
  results: SearchResult[];
  source: string;
  error?: string;
}

/**
 * 从 HTML 中提取纯文本（去除标签、样式、脚本）
 */
function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从搜索引擎 HTML 中提取所有可见链接及其周围文本
 * 不依赖特定搜索引擎的 CSS 类名，鲁棒性更强
 */
function parseSearchResults(html: string, query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // 提取查询中的核心词用于相关度过滤
  const queryWords = query.toLowerCase().split(/[\s,，。]+/).filter(w => w.length > 1);

  // 垃圾关键词过滤 — 排除广告、无关结果
  const spamKeywords = ['作业帮', '搜活帮', '本帮菜', '学习机', '广告', '推广', 'sponsored', 'ad', '京ICP', '京公网安', '增值电信'];

  function isSpam(text: string): boolean {
    const lower = text.toLowerCase();
    return spamKeywords.some(k => lower.includes(k));
  }

  // 1. 先尝试按 <a> 标签提取结构化结果
  // 匹配 <a ... href="url"...> 锚文本 </a> 并抓取周围的文本块
  const linkPattern = /<a\s[^>]*href="(https?:\/\/(?!.*(?:google|bing|duckduckgo)\/)[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  // 收集所有候选结果
  const candidates: Array<{ title: string; url: string; contextBlock: string }> = [];

  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1] ?? '';
    const rawTitle = extractText(match[2] ?? '');
    const title = rawTitle.replace(/\s+/g, ' ').trim();

    // 过滤太短、重复、或明显不是结果项的链接
    if (title.length < 4 || !url || seenUrls.has(url)) continue;
    if (url.includes('google.com/search') || url.includes('bing.com/search')) continue;

    // 获取链接前后的文本作为摘要上下文
    const startPos = Math.max(0, match.index - 300);
    const contextHtml = html.slice(startPos, match.index + (match[0]?.length ?? 0) + 300);
    const contextText = extractText(contextHtml).replace(/\s+/g, ' ').trim();

    seenUrls.add(url);
    candidates.push({ title, url, contextBlock: contextText });
  }

  // 2. 基于查询词的相关度评分
  function relevanceScore(title: string, snippet: string): number {
    const text = (title + ' ' + snippet).toLowerCase();
    let score = 0;
    for (const w of queryWords) {
      if (text.includes(w)) score += 2;
    }
    // 查询词在标题中更优
    const titleLower = title.toLowerCase();
    for (const w of queryWords) {
      if (titleLower.includes(w)) score += 3;
    }
    return score;
  }

  // 2b. 过滤垃圾结果并按相关度排序
  const filtered = candidates
    .filter(c => !isSpam(c.title) && !isSpam(c.contextBlock))
    .map(c => ({ ...c, score: relevanceScore(c.title, c.contextBlock) }))
    .filter(c => c.score > 0)  // 仅保留至少匹配一个查询词的结果
    .sort((a, b) => b.score - a.score)
    .filter(c => c.score >= 4);  // 相关度门槛：至少标题匹配一个核心词 + 一些额外匹配

  // 3. 提取 snippet — 从上下文中查找标题后面的几句话
  for (const c of filtered) {
    if (results.length >= 8) break;

    let snippet = '';
    // 尝试从上下文中提取标题后的文本作为摘要
    const titleInContext = c.contextBlock.indexOf(c.title);
    if (titleInContext >= 0) {
      snippet = c.contextBlock.slice(titleInContext + c.title.length).replace(/^[：:\s,，。.]+/, '').slice(0, 200);
    }

    // 如果没找到，用全文搜索
    if (!snippet || snippet.length < 10) {
      const pos = html.indexOf(c.url);
      if (pos >= 0) {
        const afterUrl = html.slice(pos + c.url.length, pos + c.url.length + 500);
        snippet = extractText(afterUrl).replace(/\s+/g, ' ').trim().slice(0, 200);
      }
    }

    // 清理摘要
    snippet = snippet.replace(/^[^a-zA-Z0-9\u4e00-\u9fff]+/, '').slice(0, 200);

    results.push({ title: c.title, snippet, url: c.url });
  }

  // 4. 如果以上方法没有得到结果，尝试按搜索结果页面的常见模式提取
  if (results.length === 0) {
    // 尝试查找 h2/h3 中的链接（很多搜索引擎用 h 标签包裹标题）
    const headingLinkPattern = /<h[23][^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[23]>/gi;
    while ((match = headingLinkPattern.exec(html)) !== null && results.length < 8) {
      const url = match[1] ?? '';
      const title = extractText(match[2] ?? '').replace(/\s+/g, ' ').trim();
      const score = relevanceScore(title, '');
      if (title.length >= 4 && url && !seenUrls.has(url) && !isSpam(title) && score > 0) {
        seenUrls.add(url);
        // 获取标题后的文本
        const after = html.slice(match.index + match[0].length, match.index + match[0].length + 400);
        const snippet = extractText(after).replace(/\s+/g, ' ').trim().slice(0, 200);
        results.push({ title, snippet, url });
      }
    }
  }

  return results;
}

/**
 * 从 HTML 中提取结构化结果文本（不解析具体条目，用于 browse 模式）
 */
function extractPageText(html: string): string {
  return extractText(html)
    .replace(/\n\s*\n\s*\n/g, '\n\n')  // 压缩多余空行
    .trim();
}

/**
 * 搜索网页
 */
function cleanSearchQuery(query: string): string {
  // 去除"帮我""请帮我""能帮我"等无意义前缀
  return query
    .replace(/^(请|能|可以)?帮我/g, '')
    .replace(/^(请|能|可以)?帮我/g, '')
    .replace(/^(请|能|可以)?(查|搜索|搜)一下/g, '')
    .replace(/^(请|能|可以)?(查|搜索|搜)一下/g, '')
    .replace(/并基于它/, '')
    .trim();
}

export async function searchWeb(query: string): Promise<BrowserResult> {
  const searchQuery = cleanSearchQuery(query);
  logger.info(`[HumanBrowser] 搜索: "${searchQuery}"`);

  // 尝试每个搜索引擎，直到有一个返回结果
  for (let ei = 0; ei < SEARCH_ENGINES.length; ei++) {
    const engine = SEARCH_ENGINES[ei]!;
    const timeoutMs = ei === 0 ? 15000 : 8000;
    try {
      const url = engine.url(searchQuery);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.info(`[HumanBrowser] ${engine.name} HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();

      // 使用统一解析器提取结果（传入原始查询词用于相关度过滤）
      const results = parseSearchResults(html, searchQuery);

      if (results.length > 0) {
        const summary = results.slice(0, 5).map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.snippet || '(无摘要)'}\n   ${r.url}`
        ).join('\n\n');

        logger.info(`[HumanBrowser] ${engine.name} 返回 ${results.length} 条高相关度结果`);

        return {
          success: true,
          summary,
          results: results.slice(0, 5),
          source: engine.name,
        };
      } else {
        logger.info(`[HumanBrowser] ${engine.name} 所有结果相关度过低，已丢弃`);
      }
    } catch (e) {
      logger.info(`[HumanBrowser] ${engine.name} 失败: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
  }

  // 所有引擎都失败
  return {
    success: false,
    summary: '',
    results: [],
    source: 'none',
    error: '所有搜索引擎均未能返回结果',
  };
}

/**
 * 抓取并提取指定 URL 的页面内容
 */
export async function browse(url: string): Promise<BrowserResult> {
  try {
    // 验证 URL
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, summary: '', results: [], source: 'error', error: '不支持的协议，仅支持 http/https' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, summary: '', results: [], source: 'error', error: `HTTP ${response.status}` };
    }

    const rawHtml = await response.text();
    const text = extractPageText(rawHtml);

    // 取前 3000 字符作为摘要
    const summary = text.slice(0, 3000) + (text.length > 3000 ? '...' : '');

    return {
      success: true,
      summary,
      results: [{ title: parsed.hostname, snippet: summary, url }],
      source: url,
    };
  } catch (error) {
    return {
      success: false,
      summary: '',
      results: [],
      source: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检查是否应该使用搜索（根据任务关键词）
 */
export function shouldSearchWeb(task: string): boolean {
  const keywords = [
    '查', '搜索', '搜索一下', '搜一下',
    '最新', '2024', '2025', '2026', '2027',
    '最佳实践', '流行趋势', '新闻',
    'what is', 'how to', 'latest', 'best practice', 'tutorial',
    '特性', '更新', '版本', '新功能',
    'compare', 'vs', '对比', '区别',
    '指南', 'guide', '教程',
  ];
  const lower = task.toLowerCase();

  // 必须匹配至少一个搜索关键词
  if (!keywords.some(k => lower.includes(k))) return false;

  // 排除纯粹是"帮我"短语的情况（"帮"后没有其他搜索关键词）
  const helperPhrases = ['帮我', '请帮我', '能帮我'];
  if (helperPhrases.some(p => lower.includes(p))) {
    // "帮我X" 后面要跟着明确的搜索词才触发
    const afterHelp = lower.split(/帮我|请帮我|能帮我/).pop() || '';
    const searchIndicators = ['查', '搜索', '搜', '找', '最新', '2026'];
    if (!searchIndicators.some(s => afterHelp.includes(s))) {
      return false;
    }
  }

  return true;
}

/**
 * 简化摘要，保留关键信息
 */
export function summarizeResults(results: BrowserResult, maxLength: number = 1500): string {
  if (!results.success) {
    return `[搜索失败] ${results.error || '未知错误'}`;
  }

  const header = `[${results.source}搜索结果]\n`;
  let body = results.summary;

  if (body.length > maxLength) {
    body = body.slice(0, maxLength) + '...\n\n(结果已截断)';
  }

  return header + body;
}
