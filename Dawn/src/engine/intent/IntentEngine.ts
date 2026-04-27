/**
 * IntentEngine —— LLM + 规则混合意图解析引擎
 *
 * 架构：
 *   1. 若外部注入了 LLM 分析函数，优先调用（支持异步、可携带 context）
 *   2. 若 LLM 返回结果且置信度 > 0.6，采用 LLM 结果
 *   3. 否则降级到传统规则匹配（关键词 + 启发式分类）
 *
 * 向后兼容：保留原 `IntentEngine.ts` 的全部导出函数。
 */

import { TaskCategory } from '../../../packages/core/src/types.js';
import type { IntentResult } from '../../../packages/core/src/types.js';
import type { Intent } from './Intent.js';

// ── 可选的 LLM 分析函数签名 ──
export type LlmAnalyzer = (
  input: string,
  context?: { history?: string[]; lastIntent?: string },
) => Promise<IntentResult | null>;

export interface IntentEngineOptions {
  /** 可选的 LLM 分析函数，用于高级意图解析 */
  llmAnalyzer?: LlmAnalyzer;
}

// ── 工具类任务关键词 ──
const toolKeywords = [
  '实现', '添加', '优化', '重构', '调试', '测试',
  '运行', '部署', '搜索', '查找', '获取', '抓取',
  '爬取', '分析', '统计', '学习', '总结', '提取',
  '生成', '创建', '修改', '删除', '写',
  '帮我', '给我', '做一个', '编写', '开发', '制作',
  // 查询类 — 精准查资料也属于工具任务
  '查一下', '查', '查询', '看看', '告诉我',
  // 代码工具名
  '防抖', '节流', 'debounce', 'throttle',
  '深拷贝', '排序', '校验', '缓存',
  'promise', '异步', 'json解析', '格式化',
  '事件', '链表', '队列', '栈',
  '函数', 'class', '类', '组件',
  '示例', 'demo', 'typescript特性', 'ts特性', 'ts新功能',
  'leading', 'trailing edge',
  // 特性/功能查询
  '特性', '最新', '新功能', '新特性',
  // 常见请求
  'cachedfetch', 'uselocalstorage', 'fetch', 'localstorage',
  '缓存请求', '本地存储', 'react hook', 'hook', 'hooks',
];

// ── 问问题关键词 ──
const questionKeywords = [
  '什么是', '什么叫', '如何', '怎么', '为什么', '何时',
  '哪里', '谁', '解释', '说明', '告诉我', '区别',
  '?', '？', '吗', '呀', '吧',
];

// ── 问候关键词 ──
const greetingKeywords = [
  '你好', 'hi', 'hello', '嗨', 'hey',
  '早上好', '下午好', '晚上好', '在吗', '在嘛',
];

const MAX_INPUT_LENGTH = 10000;

export class IntentEngine {
  private llmAnalyzer?: LlmAnalyzer;

  constructor(options: IntentEngineOptions = {}) {
    this.llmAnalyzer = options.llmAnalyzer;
  }

  /**
   * 主入口 —— 先尝试 LLM，失败则降级到规则匹配。
   *
   * @param input  用户原始输入
   * @param context 可选的对话上下文（历史记录、上一轮意图）
   */
  async analyze(
    input: string,
    context?: { history?: string[]; lastIntent?: string },
  ): Promise<IntentResult> {
    // 1) 优先尝试 LLM 分析
    if (this.llmAnalyzer) {
      try {
        const llmResult = await this.llmAnalyzer(input, context);
        if (llmResult && llmResult.confidence > 0.6) {
          return llmResult;
        }
      } catch {
        // LLM 失败时静默降级，不抛出
      }
    }

    // 2) 降级 —— 传统规则匹配
    return this.ruleBasedAnalyze(input);
  }

  /**
   * 判断输入是否看起来像工具任务（关键词匹配）。
   */
  looksLikeToolTask(input: string): boolean {
    return toolKeywords.some(kw => input.includes(kw));
  }

  /**
   * 从输入中提取有意义的词语（过滤停用词）。
   */
  extractKeywords(input: string): string[] {
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不',
      '人', '都', '一', '一个', '上', '也', '很', '到', '说',
      '要', '去', '你', '会', '着', '没有', '看', '好', '自己',
      '这', '他', '她', '它', '们', '那', '些', '吗', '吧',
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    ]);

    return input
      .split(/[\s,，。；;：:、！!？?()（）\[\]【】{}]/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  /**
   * 验证输入合法性（非空、长度限制）。
   */
  validateInput(input: string): { valid: boolean; error?: string } {
    if (!input || input.trim().length === 0) {
      return { valid: false, error: '输入不能为空' };
    }
    if (input.length > MAX_INPUT_LENGTH) {
      return { valid: false, error: `输入过长，最大 ${MAX_INPUT_LENGTH} 字符` };
    }
    return { valid: true };
  }

  // ── 私有：基于规则的意向降级分析 ──

  /**
   * 完整规则匹配 —— 与原 IntentEngine.ts 的 analyzeIntent 逻辑一致。
   */
  private ruleBasedAnalyze(input: string): IntentResult {
    const lower = input.toLowerCase().trim();

    // 1. 问候检测
    if (greetingKeywords.some(k => lower.includes(k))) {
      return {
        category: TaskCategory.Greeting,
        confidence: 0.9,
        taskDescription: input,
        keywords: this.extractKeywords(input),
        requiresTool: false,
      };
    }

    // 2. 代码生成请求检测
    if (
      this.looksLikeToolTask(lower) &&
      !questionKeywords.some(k => lower.includes(k))
    ) {
      return {
        category: TaskCategory.CodeGeneration,
        confidence: 0.85,
        taskDescription: input,
        keywords: this.extractKeywords(input),
        requiresTool: true,
      };
    }

    // 3. 问题检测
    if (questionKeywords.some(k => lower.includes(k))) {
      if (this.looksLikeToolTask(lower)) {
        return {
          category: TaskCategory.CodeGeneration,
          confidence: 0.7,
          taskDescription: input,
          keywords: this.extractKeywords(input),
          requiresTool: true,
        };
      }
      return {
        category: TaskCategory.Question,
        confidence: 0.8,
        taskDescription: input,
        keywords: this.extractKeywords(input),
        requiresTool: false,
      };
    }

    // 4. 代码修改检测
    if (['修改', '优化', '修复', '改进', '重构', '调整', '改变'].some(k => lower.includes(k))) {
      return {
        category: TaskCategory.CodeModification,
        confidence: 0.8,
        taskDescription: input,
        keywords: this.extractKeywords(input),
        requiresTool: true,
      };
    }

    // 5. 默认
    return {
      category: TaskCategory.Unknown,
      confidence: 0.3,
      taskDescription: input,
      keywords: this.extractKeywords(input),
      requiresTool: false,
    };
  }
}

// ── 向后兼容的独立函数 ──
const _engine = new IntentEngine();

export function looksLikeToolTask(input: string): boolean {
  return _engine.looksLikeToolTask(input);
}

export async function analyzeIntent(input: string): Promise<import('../../../packages/core/src/types.js').IntentResult> {
  return _engine.analyze(input);
}
