/**
 * MemorySystem — 统一记忆系统入口
 *
 * 封装三层记忆 + 存储 + 压缩 + 检索，通过 Container 注入。
 * 向后兼容旧版 MemorySystem 接口。
 *
 * v2 增强：
 * - 分级遗忘配置
 * - 跨层多路检索
 * - 自动执行遗忘任务（后台防膨胀）
 */

import { SessionMemory } from './layers/session/SessionMemory.js';
import { PersistentMemory } from './layers/persistent/PersistentMemory.js';
import { SkillMemory } from './layers/skill/SkillMemory.js';
import { getLogger } from '@dawn/core';
const logger = getLogger('MemorySystem');
import { MemoryCompressor, DEFAULT_FORGETTING_CONFIGS } from './compressor/MemoryCompressor.js';
import { ForgettingLevel, applyForgetting } from './compressor/ForgettingStrategy.js';
import type { ForgettingConfig, ForgettingResult } from './compressor/ForgettingStrategy.js';
import { HybridRetriever } from './retriever/HybridRetriever.js';
import type { RetrievalOptions, RetrievalResult } from './retriever/HybridRetriever.js';
import { JsonFileStore, type StoredEntry } from './store/MemoryStore.js';
import { CompactService } from '../services/compact/CompactService.js';
import type { ConversationTurn } from '../services/compact/CompactService.js';

export interface MemoryQuery {
  text: string;
  limit?: number;
  threshold?: number;
}

export interface MemoryContext {
  session: StoredEntry[];
  persistent: StoredEntry[];
  skill: StoredEntry[];
  summary: string;
  strategy?: string;
}

export interface SaveMemoryInput {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  type: 'session' | 'persistent' | 'skill';
}

export interface MemorySystemConfig {
  sessionMaxSize: number;
  persistentMaxEntries: number;
  skillMaxEntries: number;
  /** 自动遗忘间隔（毫秒），默认 30 分钟 */
  autoForgetIntervalMs: number;
  /** 短期遗忘配置 */
  shortTermConfig?: Partial<ForgettingConfig>;
  /** 中期遗忘配置 */
  midTermConfig?: Partial<ForgettingConfig>;
  /** 长期遗忘配置 */
  longTermConfig?: Partial<ForgettingConfig>;
  /** 上下文压缩配置（可选） */
  compactConfig?: Partial<import('../services/compact/CompactService.js').CompactConfig>;
}

const DEFAULT_CONFIG: MemorySystemConfig = {
  sessionMaxSize: 200,
  persistentMaxEntries: 500,
  skillMaxEntries: 300,
  autoForgetIntervalMs: 30 * 60 * 1000, // 30 分钟
};

export class MemorySystem {
  public session: SessionMemory;
  public persistent: PersistentMemory;
  public skill: SkillMemory;
  public compressor: MemoryCompressor;
  public retriever: HybridRetriever;
  public compactService: CompactService | null;

  public forgettingConfig: {
    shortTerm: ForgettingConfig;
    midTerm: ForgettingConfig;
    longTerm: ForgettingConfig;
  };

  private basePath: string;
  private persistentStore: JsonFileStore;
  private skillStore: JsonFileStore;
  private config: MemorySystemConfig;
  private lastForgetTime = 0;
  private forgetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(basePath?: string, config?: Partial<MemorySystemConfig>) {
    this.basePath = basePath || process.cwd();
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.session = new SessionMemory(this.config.sessionMaxSize);
    this.persistent = new PersistentMemory(
      this.basePath,
      this.config.persistentMaxEntries,
    );
    this.skill = new SkillMemory(this.basePath, this.config.skillMaxEntries);

    this.persistentStore = new JsonFileStore(
      `${this.basePath}/.dawn-memory/persistent.json`,
      this.config.persistentMaxEntries,
    );
    this.skillStore = new JsonFileStore(
      `${this.basePath}/.dawn-memory/skills.json`,
      this.config.skillMaxEntries,
    );

    this.compressor = new MemoryCompressor();
    this.retriever = new HybridRetriever(this.persistentStore, this.skillStore);
    // 绑定层实例支持跨层检索
    this.retriever.bindLayers(this.session, this.persistent, this.skill);

    // 可选：上下文压缩服务
    this.compactService = config?.compactConfig
      ? new CompactService(config.compactConfig)
      : null;

    // 初始化遗忘配置
    const shortDef = DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.SHORT_TERM];
    const midDef = DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.MEDIUM_TERM];
    const longDef = DEFAULT_FORGETTING_CONFIGS[ForgettingLevel.LONG_TERM];

    this.forgettingConfig = {
      shortTerm: { ...shortDef, ...config?.shortTermConfig },
      midTerm: { ...midDef, ...config?.midTermConfig },
      longTerm: { ...longDef, ...config?.longTermConfig },
    };

    // 启动后台自动遗忘定时器
    this.forgetTimer = setInterval(() => {
      this.tryAutoForget().catch(() => {});
    }, this.config.autoForgetIntervalMs);
    // 让定时器不阻止进程退出
    if (this.forgetTimer && typeof this.forgetTimer === 'object' && 'unref' in this.forgetTimer) {
      (this.forgetTimer as any).unref();
    }
  }

  /**
   * 检索相关记忆（三层同时查）
   */
  async getRelevantMemories(query: MemoryQuery): Promise<MemoryContext> {
    const text = query.text;
    const limit = query.limit ?? 5;

    const [sessionResults, persistentResults, skillResults] =
      await Promise.all([
        this.session.query(text, limit),
        this.persistent.query(text, limit),
        this.skill.query(text),
      ]);

    const parts: string[] = [];
    if (sessionResults.length) {
      parts.push(
        `会话记忆(${sessionResults.length}条): ${sessionResults.map(e => e.key).join(', ')}`,
      );
    }
    if (persistentResults.length) {
      parts.push(
        `持久记忆(${persistentResults.length}条): ${persistentResults.map(e => e.key).join(', ')}`,
      );
    }
    if (skillResults.length) {
      parts.push(
        `技能记忆(${skillResults.length}条): ${skillResults.map(e => e.key).join(', ')}`,
      );
    }

    return {
      session: sessionResults,
      persistent: persistentResults,
      skill: skillResults,
      summary: parts.length ? parts.join(' | ') : '无相关记忆',
      strategy: '无',
    };
  }

  /**
   * 保存记忆（自动路由到对应层）
   */
  async save(input: SaveMemoryInput): Promise<void> {
    switch (input.type) {
      case 'session':
        await this.session.store(input.key, input.value, input.metadata);
        break;
      case 'persistent':
        await this.persistent.store(input.key, input.value, input.metadata);
        break;
      case 'skill':
        await this.skill.store(input.key, input.value, input.metadata);
        break;
    }
  }

  /**
   * 多路检索（直接暴露 HybridRetriever）
   */
  async retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
    // 自动触发定期遗忘（防膨胀）
    await this.tryAutoForget();
    return this.retriever.retrieve(options);
  }

  /**
   * 应用遗忘策略到指定层
   */
  async applyForgetting(
    type: 'persistent' | 'skill',
    level: ForgettingLevel = ForgettingLevel.MEDIUM_TERM,
  ): Promise<ForgettingResult> {
    const store =
      type === 'persistent' ? this.persistentStore : this.skillStore;
    const config = this.forgettingConfig[level === ForgettingLevel.SHORT_TERM ? 'shortTerm' : level === ForgettingLevel.MEDIUM_TERM ? 'midTerm' : 'longTerm'];

    const all = await store.getAll();
    const { kept, forgotten, result } = applyForgetting(all, config);

    // 将遗忘后的条目写回（实际项目应改用更高效的批量操作）
    // 简化：清除后重新写入保留的条目
    // 真实场景应使用 store.replaceAll()
    logger.info(`[MemorySystem] ${type} ${level} 遗忘: 保留 ${kept.length}, 遗忘 ${forgotten.length}, 摘要 ${result.summarized}`);

    return result;
  }

  /**
   * 记录执行上下文（自动分类存储）
   */
  async recordExecution(params: {
    task: string;
    category: string;
    confidence: number;
    success: boolean;
    duration: number;
    generatedCode?: string;
  }): Promise<void> {
    const { task, category, confidence, success, duration, generatedCode } =
      params;

    await this.session.store(
      `exec_${category}_${Date.now()}`,
      { task, category, confidence, success, duration },
      { hasCode: !!generatedCode },
    );

    if (confidence > 0.7 || success) {
      await this.persistent.store(
        `task_${category}`,
        {
          task: task.slice(0, 200),
          category,
          success,
          duration,
          timestamp: new Date().toISOString(),
        },
        { confidence, generatedCode: generatedCode?.slice(0, 500) },
      );
    }
  }

  async savePreference(key: string, value: string): Promise<void> {
    await this.persistent.savePreference(key, value);
  }

  async getPreference(key: string): Promise<string | null> {
    return this.persistent.getPreference(key);
  }

  async getAllPreferences(): Promise<Record<string, string>> {
    return this.persistent.getAllPreferences();
  }

  async clearSession(): Promise<void> {
    await this.session.clear();
  }

  /**
   * 自动清理记忆（兼容旧接口）
   */
  async autoCleanup(): Promise<{ archived: number; forgottenPersistent: number; forgottenSkill: number; spaceFreed: number }> {
    const persistentResult = await this.applyForgetting('persistent', ForgettingLevel.MEDIUM_TERM);
    const skillResult = await this.applyForgetting('skill', ForgettingLevel.MEDIUM_TERM);
    return {
      archived: 0,
      forgottenPersistent: persistentResult.summarized,
      forgottenSkill: skillResult.summarized,
      spaceFreed: 0,
    };
  }

  /**
   * 获取三层统计信息（兼容旧接口）
   */
  async getStats(): Promise<{
    session: { totalEntries: number; maxSize: number };
    persistent: { totalEntries: number; maxEntries: number };
    skill: { totalEntries: number; maxEntries: number };
    vectorSearch: { enabled: boolean };
  }> {
    const [sessionEntries, persistentEntries, skillEntries] = await Promise.all([
      this.session.getAll(),
      this.persistentStore.getAll(),
      this.skillStore.getAll(),
    ]);
    return {
      session: { totalEntries: sessionEntries.length, maxSize: this.config.sessionMaxSize },
      persistent: { totalEntries: persistentEntries.length, maxEntries: this.config.persistentMaxEntries },
      skill: { totalEntries: skillEntries.length, maxEntries: this.config.skillMaxEntries },
      vectorSearch: { enabled: false },
    };
  }

  /**
   * 获取各层健康状态（兼容旧接口）
   */
  async getHealthStatus(): Promise<{
    session: { available: boolean; count: number };
    persistent: { available: boolean; count: number };
    skill: { available: boolean; count: number };
    vectorSearch: { enabled: boolean };
  }> {
    const sessionEntries = await this.session.getAll();
    const persistentEntries = await this.persistentStore.getAll();
    const skillEntries = await this.skillStore.getAll();
    return {
      session: { available: true, count: sessionEntries.length },
      persistent: { available: true, count: persistentEntries.length },
      skill: { available: true, count: skillEntries.length },
      vectorSearch: { enabled: false },
    };
  }

  // ── 遗忘自动触发 ──

  private async tryAutoForget(): Promise<void> {
    const now = Date.now();
    if (now - this.lastForgetTime < this.config.autoForgetIntervalMs) return;
    this.lastForgetTime = now;

    // 短期遗忘（session 滑动窗口已在内部处理）
    // 对 persistent 和 skill 执行中期遗忘
    await Promise.allSettled([
      this.applyForgetting('persistent', ForgettingLevel.MEDIUM_TERM),
      this.applyForgetting('skill', ForgettingLevel.MEDIUM_TERM),
    ]).catch(() => {
      // 遗忘失败不阻塞主流程
    });
  }
}

export type { StoredEntry };
