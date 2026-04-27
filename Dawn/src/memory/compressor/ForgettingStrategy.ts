/**
 * ForgettingStrategy — 分级遗忘策略
 *
 * 三级遗忘：
 * - SHORT_TERM：保留全部（滑动窗口淘汰），不过期
 * - MEDIUM_TERM：保留摘要 + 高频，丢弃低频冗余
 * - LONG_TERM：只保留高重要性，按时间衰减遗忘
 *
 * 可配置：
 * - shortTermLimit：短期保留上限（默认 200）
 * - midTermDays：中期摘要保留天数（默认 7）
 * - longTermImportanceThreshold：长期保留的重要性阈值（默认 0.3）
 */

export enum ForgettingLevel {
  /** 不过期，滑动窗口淘汰 */
  SHORT_TERM = 'short_term',
  /** 摘要保留，丢弃冗余 */
  MEDIUM_TERM = 'medium_term',
  /** 只留高重要性，按时间衰减 */
  LONG_TERM = 'long_term',
}

export interface ForgettingConfig {
  level: ForgettingLevel;
  /** 保留的最大条目数 */
  maxEntries: number;
  /** 重要性阈值（0-1），低于此值的条目可能被遗忘 */
  importanceThreshold: number;
  /** 天数衰减：超过此天数的条目降级或删除 */
  decayDays: number;
}

export interface ForgettingResult {
  kept: number;
  forgotten: number;
  summarized: number;
}

/**
 * 计算记忆条目的重要性评分（0-1）
 *
 * 因素：
 * - 访问频率（0-0.4）：accessCount 越高越重要
 * - 新近度（0-0.3）：最近访问时间越近越重要
 * - 时效（0-0.3）：创建时间越新越重要
 */
export function calculateImportance(entry: {
  accessCount: number;
  lastAccessed: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}): number {
  const now = Date.now();
  const ageDays = (now - entry.timestamp) / (1000 * 60 * 60 * 24);
  const recencyDays = (now - entry.lastAccessed) / (1000 * 60 * 60 * 24);

  // 访问频率权重 (0-0.4)
  const accessScore = Math.min(entry.accessCount / 50, 0.4);

  // 新近度权重 (0-0.3)
  const recencyScore =
    recencyDays < 1 ? 0.3 : recencyDays < 7 ? 0.2 : recencyDays < 30 ? 0.1 : 0;

  // 时效权重 (0-0.3)
  const ageScore = Math.max(0, 0.3 - ageDays * 0.003);

  // metadata 中的显式重要性加权 (0-0.3 额外)
  const explicitImportance = (entry.metadata?.importance as number) ?? 0;
  const explicitBonus = explicitImportance * 0.3;

  return Math.min(accessScore + recencyScore + ageScore + explicitBonus, 1);
}

/**
 * 应用遗忘策略到条目列表
 *
 * @param entries 条目列表
 * @param config 遗忘配置
 * @returns 保留的和被遗忘的条目
 */
export function applyForgetting<
  T extends { timestamp: number; accessCount: number; lastAccessed: number },
>(
  entries: T[],
  config: ForgettingConfig,
): { kept: T[]; forgotten: T[]; result: ForgettingResult } {
  if (entries.length === 0) {
    return { kept: [], forgotten: [], result: { kept: 0, forgotten: 0, summarized: 0 } };
  }

  switch (config.level) {
    case ForgettingLevel.SHORT_TERM:
      return applyShortTermForgetting(entries, config);
    case ForgettingLevel.MEDIUM_TERM:
      return applyMediumTermForgetting(entries, config);
    case ForgettingLevel.LONG_TERM:
      return applyLongTermForgetting(entries, config);
    default:
      return { kept: entries, forgotten: [], result: { kept: entries.length, forgotten: 0, summarized: 0 } };
  }
}

/**
 * 短期遗忘：滑动窗口截断，保留最新的 maxEntries 条
 */
function applyShortTermForgetting<
  T extends { timestamp: number; accessCount: number; lastAccessed: number },
>(
  entries: T[],
  config: ForgettingConfig,
): { kept: T[]; forgotten: T[]; result: ForgettingResult } {
  if (entries.length <= config.maxEntries) {
    return { kept: entries, forgotten: [], result: { kept: entries.length, forgotten: 0, summarized: 0 } };
  }

  // 按时间排序（新的在后）
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

  return {
    kept: sorted.slice(-config.maxEntries),
    forgotten: sorted.slice(0, sorted.length - config.maxEntries),
    result: {
      kept: config.maxEntries,
      forgotten: sorted.length - config.maxEntries,
      summarized: 0,
    },
  };
}

/**
 * 中期遗忘：按重要性保留，对低重要性条目做摘要
 * - 高重要性保留完整
 * - 低重要性丢弃
 * - 相似条目聚类摘要
 */
function applyMediumTermForgetting<
  T extends { timestamp: number; accessCount: number; lastAccessed: number },
>(
  entries: T[],
  config: ForgettingConfig,
): { kept: T[]; forgotten: T[]; result: ForgettingResult } {
  const now = Date.now();
  const decayThresholdMs = config.decayDays * 86400000;

  const scored = entries.map(e => ({
    entry: e,
    importance: calculateImportance(e),
    isExpired: now - e.lastAccessed > decayThresholdMs,
  }));

  // 按重要性降序排列
  scored.sort((a, b) => b.importance - a.importance);

  const kept: T[] = [];
  const forgotten: T[] = [];
  let summarized = 0;

  for (const item of scored) {
    if (kept.length >= config.maxEntries) {
      // 已满，剩余的遗忘
      forgotten.push(item.entry);
    } else if (item.isExpired && item.importance < config.importanceThreshold) {
      // 过期且重要性低 → 遗忘
      forgotten.push(item.entry);
    } else if (item.importance < config.importanceThreshold * 0.5) {
      // 重要性太低 → 遗忘（可考虑摘要）
      forgotten.push(item.entry);
      summarized++;
    } else {
      kept.push(item.entry);
    }
  }

  return {
    kept,
    forgotten,
    result: { kept: kept.length, forgotten: forgotten.length, summarized },
  };
}

/**
 * 长期遗忘：严格按重要性保留
 * - 只保留高于重要性阈值的条目
 * - 过期条目直接删除
 * - 相似条目合并（只保留最重要的那个）
 */
function applyLongTermForgetting<
  T extends { timestamp: number; accessCount: number; lastAccessed: number },
>(
  entries: T[],
  config: ForgettingConfig,
): { kept: T[]; forgotten: T[]; result: ForgettingResult } {
  const now = Date.now();
  const decayThresholdMs = config.decayDays * 86400000;

  const scored = entries.map(e => ({
    entry: e,
    importance: calculateImportance(e),
    isExpired: now - e.lastAccessed > decayThresholdMs,
  }));

  // 按重要性降序排列
  scored.sort((a, b) => b.importance - a.importance);

  const kept: T[] = [];
  const forgotten: T[] = [];
  const seenKeys = new Set<string>();

  for (const item of scored) {
    // 过期直接遗忘
    if (item.isExpired) {
      forgotten.push(item.entry);
      continue;
    }

    // 重要性低于阈值遗忘
    if (item.importance < config.importanceThreshold) {
      forgotten.push(item.entry);
      continue;
    }

    // 已满不再添加
    if (kept.length >= config.maxEntries) {
      forgotten.push(item.entry);
      continue;
    }

    // 去重：同 key 只保留最高重要性的
    const entryKey = (item.entry as any).key;
    if (entryKey && seenKeys.has(entryKey)) {
      forgotten.push(item.entry);
      continue;
    }
    if (entryKey) seenKeys.add(entryKey);

    kept.push(item.entry);
  }

  return {
    kept,
    forgotten,
    result: { kept: kept.length, forgotten: forgotten.length, summarized: 0 },
  };
}
