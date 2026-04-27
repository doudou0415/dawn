/**
 * SkillMemory — 技能/流程记忆
 *
 * 存储可复用的行为模式、修复方案、工作流模板等。
 * 特征：
 * - 持久化存储（JSON 文件）
 * - 按模式和关键词检索
 * - **技能匹配度评分**：基于关键词重叠 + 使用频率 + 成功率加权
 * - 支持技能衰减（长时间未使用的技能降权）
 */

import { JsonFileStore, type StoredEntry } from '../../store/MemoryStore.js';
import { calculateImportance } from '../../compressor/ForgettingStrategy.js';

export interface SkillPattern {
  name: string;
  description: string;
  steps: string[];
  keywords: string[];
  successRate: number;
  usageCount: number;
  /** 适用场景标签 */
  tags?: string[];
  /** 最后使用时间 */
  lastUsedAt?: number;
}

export interface SkillMatchResult {
  entry: StoredEntry;
  score: number;
  matchType: 'exact' | 'keyword' | 'semantic';
}

export class SkillMemory {
  private skillStore: JsonFileStore;

  constructor(basePath: string, maxEntries = 300) {
    this.skillStore = new JsonFileStore(
      `${basePath}/.dawn-memory/skills.json`,
      maxEntries,
    );
  }

  async store(
    key: string,
    value: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<StoredEntry> {
    return this.skillStore.save({
      key,
      value,
      metadata,
      accessCount: 0,
      lastAccessed: Date.now(),
    });
  }

  async query(pattern?: string, limit = 20): Promise<StoredEntry[]> {
    if (!pattern) return this.skillStore.getAll().then(e => e.slice(-limit));
    return this.skillStore.search(pattern, limit);
  }

  async getAll(): Promise<StoredEntry[]> {
    return this.skillStore.getAll();
  }

  /**
   * 技能匹配：基于关键词 + 频率 + 成功率的综合评分
   * 返回最匹配的技能（含评分）
   */
  async matchSkill(
    input: string,
    threshold = 0.3,
  ): Promise<SkillMatchResult | null> {
    const all = await this.skillStore.getAll();
    if (all.length === 0) return null;

    const inputKeywords = this.extractKeywords(input);
    if (inputKeywords.length === 0) return null;

    const scored = all.map(entry => {
      const { keywordScore, matchType } = this.scoreKeywordMatch(
        entry,
        inputKeywords,
      );

      // 使用频率加成（0-0.3）
      const freqBonus = Math.min(entry.accessCount / 100, 0.3);

      // 重要性衰减（0-0.2）
      const importance = calculateImportance(entry);
      const importanceBonus = importance * 0.2;

      // 成功率加成（metadata 中的 successRate）
      const successRate =
        ((entry.metadata?.successRate as number) ?? 0.5) * 0.2;

      const totalScore =
        keywordScore + freqBonus + importanceBonus + successRate;

      return { entry, score: Math.min(totalScore, 1.0), matchType };
    });

    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < threshold) return null;

    // 匹配成功后更新访问计数
    await this.touch(best.entry.id);

    return best;
  }

  /**
   * 批量匹配（返回所有高于阈值的匹配）
   */
  async matchAll(
    input: string,
    threshold = 0.2,
  ): Promise<SkillMatchResult[]> {
    const all = await this.skillStore.getAll();
    if (all.length === 0) return [];

    const inputKeywords = this.extractKeywords(input);
    if (inputKeywords.length === 0) return [];

    const results: SkillMatchResult[] = [];
    for (const entry of all) {
      const { keywordScore, matchType } = this.scoreKeywordMatch(
        entry,
        inputKeywords,
      );
      const importance = calculateImportance(entry);
      const totalScore = keywordScore * 0.6 + importance * 0.4;
      if (totalScore >= threshold) {
        results.push({ entry, score: totalScore, matchType });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  // ── 私有方法 ──

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不',
      '人', '都', '一', '一个', '上', '也', '很', '到', '说',
      '要', '去', '你', '会', '着', '没有', '看', '好', '自己',
      'a', 'an', 'the', 'is', 'are', 'was', 'were',
      'to', 'of', 'in', 'for', 'on', 'with', 'at',
    ]);
    return text
      .split(/[\s,，。；;：:、！!？?()（）\[\]【】{}"'"\/\\|_\-+=*&^%$#@~`]/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  private scoreKeywordMatch(
    entry: StoredEntry,
    inputKeywords: string[],
  ): { keywordScore: number; matchType: 'exact' | 'keyword' | 'semantic' } {
    const searchable = JSON.stringify({
      key: entry.key,
      value: entry.value,
      metadata: entry.metadata,
    }).toLowerCase();

    // 检查精确匹配（包含完整输入）
    const inputText = inputKeywords.join(' ');
    if (searchable.includes(inputText)) {
      return { keywordScore: 1.0, matchType: 'exact' };
    }

    // 关键词匹配
    let matched = 0;
    for (const kw of inputKeywords) {
      if (searchable.includes(kw)) matched++;
    }

    if (matched === 0) return { keywordScore: 0, matchType: 'keyword' };

    const ratio = matched / inputKeywords.length;
    const score = Math.min(ratio * 1.2, 0.95); // 不超过 0.95

    return { keywordScore: score, matchType: ratio > 0.7 ? 'exact' : 'keyword' };
  }

  private async touch(id: string): Promise<void> {
    // 更新访问计数和时间戳直接通过 store 的 save 机制
    // 简化实现：在下一次 store.save 时自动更新
  }
}
