/**
 * EvolutionSelector — 进化选择器
 *
 * 选择策略：
 * - Top-K 截断（保留最高分 K 个）
 * - 多样性保持（相似度过高的候选去重保留一个）
 * - 探索-利用平衡（epsilon-greedy）
 */

export interface SelectableCandidate {
  id: string;
  score: number;
  description: string;
  type: 'code' | 'prompt' | 'workflow';
  tags: string[];
  createdAt: string;
  embedding?: number[]; // 向量用于相似度计算
}

export interface SelectionConfig {
  topK: number;
  minScore: number;
  diversityThreshold: number; // 0-1，高于此值的相似度被认为是重复
  explorationRate: number;    // 0-1，探索新候选的概率
}

const DEFAULT_CONFIG: SelectionConfig = {
  topK: 5,
  minScore: 30,
  diversityThreshold: 0.75,
  explorationRate: 0.15,
};

export class EvolutionSelector {
  private config: SelectionConfig;

  constructor(config: Partial<SelectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 选择最佳候选
   */
  select(candidates: SelectableCandidate[], count?: number): SelectableCandidate[] {
    const k = count ?? this.config.topK;

    // 过滤最低分
    let filtered = candidates.filter(c => c.score >= this.config.minScore);

    if (filtered.length === 0) {
      return [];
    }

    // 按分数降序排列
    filtered.sort((a, b) => b.score - a.score);

    // 多样性去重
    const diverse: SelectableCandidate[] = [];
    for (const candidate of filtered) {
      const isDuplicate = diverse.some(
        existing => this.calculateSimilarity(existing, candidate) >= this.config.diversityThreshold
      );
      if (!isDuplicate) {
        diverse.push(candidate);
      }
    }

    // Top-K 截断
    const topK = diverse.slice(0, k);

    // 探索-利用平衡：用低分随机替换一个
    if (Math.random() < this.config.explorationRate && filtered.length > topK.length) {
      const lowScoreCandidates = filtered.slice(k);
      const randomExplorer = lowScoreCandidates[Math.floor(Math.random() * lowScoreCandidates.length)];
      if (randomExplorer) {
        const replaceIndex = Math.floor(Math.random() * topK.length);
        topK[replaceIndex] = randomExplorer;
      }
    }

    return topK;
  }

  /**
   * 获取配置副本
   */
  getConfig(): SelectionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SelectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 计算两个候选间的相似度
   */
  private calculateSimilarity(a: SelectableCandidate, b: SelectableCandidate): number {
    // 如果有向量嵌入就用向量相似度
    if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
      return this.cosineSimilarity(a.embedding, b.embedding);
    }

    // 否则用标签 Jaccard 相似度
    const tagsA = new Set(a.tags);
    const tagsB = new Set(b.tags);
    const intersection = [...tagsA].filter(t => tagsB.has(t)).length;
    const union = new Set([...tagsA, ...tagsB]).size;

    return union > 0 ? intersection / union : 0;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }
}
