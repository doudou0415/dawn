/**
 * VersionArchivist — 版本化存档
 *
 * Git-like 版本管理：
 * - 每次进化产生一个新版本
 * - 存储版本元数据 + JSON diff
 * - 支持回滚到任意版本
 * - 保留完整历史链
 */

import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';

export interface VersionEntry {
  versionId: string;
  parentVersionId: string | null;
  timestamp: string;
  description: string;
  candidateType: 'code' | 'prompt' | 'workflow';
  sourcePath: string;
  content: string;
  score: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface DiffRecord {
  versionId: string;
  parentVersionId: string | null;
  additions: number;
  deletions: number;
  changedLines: number;
  summary: string;
}

export class VersionArchivist {
  private archiveDir: string;
  private versions: VersionEntry[] = [];
  private initialized = false;

  constructor(archiveDir?: string) {
    this.archiveDir = archiveDir || join(process.cwd(), '.dawn-memory', 'evolution-archive');
  }

  /**
   * 初始化存档目录
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.archiveDir, { recursive: true });
    await mkdir(join(this.archiveDir, 'versions'), { recursive: true });
    await mkdir(join(this.archiveDir, 'diffs'), { recursive: true });
    this.initialized = true;
  }

  /**
   * 存档一个新版本
   */
  async archive(entry: VersionEntry): Promise<DiffRecord> {
    await this.initialize();
    this.versions.push(entry);

    // 保存版本内容
    const versionFile = join(this.archiveDir, 'versions', `${entry.versionId}.json`);
    await writeFile(versionFile, JSON.stringify(entry, null, 2), 'utf-8');

    // 生成并保存 diff 记录
    const diff = await this.computeDiff(entry);
    const diffFile = join(this.archiveDir, 'diffs', `${entry.versionId}.json`);
    await writeFile(diffFile, JSON.stringify(diff, null, 2), 'utf-8');

    // 更新索引
    await this.saveIndex();

    return diff;
  }

  /**
   * 获取指定版本
   */
  async getVersion(versionId: string): Promise<VersionEntry | null> {
    await this.initialize();
    const cached = this.versions.find(v => v.versionId === versionId);
    if (cached) return cached;

    try {
      const file = join(this.archiveDir, 'versions', `${versionId}.json`);
      const content = await readFile(file, 'utf-8');
      return JSON.parse(content) as VersionEntry;
    } catch {
      return null;
    }
  }

  /**
   * 获取版本历史
   */
  async getHistory(limit: number = 20): Promise<VersionEntry[]> {
    await this.ensureIndexLoaded();
    return this.versions.slice(-limit).reverse();
  }

  /**
   * 获取所有版本的 diff 记录
   */
  async getDiffHistory(limit: number = 20): Promise<DiffRecord[]> {
    await this.initialize();
    const diffDir = join(this.archiveDir, 'diffs');
    try {
      const files = await readdir(diffDir);
      const sorted = files.sort().reverse().slice(0, limit);
      const diffs: DiffRecord[] = [];
      for (const file of sorted) {
        try {
          const content = await readFile(join(diffDir, file), 'utf-8');
          diffs.push(JSON.parse(content));
        } catch { /* skip corrupt */ }
      }
      return diffs;
    } catch {
      return [];
    }
  }

  /**
   * 回滚到某个版本（返回该版本的内容）
   */
  async rollback(versionId: string): Promise<VersionEntry | null> {
    const version = await this.getVersion(versionId);
    if (!version) return null;

    // 创建回滚记录
    const rollbackEntry: VersionEntry = {
      ...version,
      versionId: `rollback-${Date.now()}`,
      parentVersionId: versionId,
      timestamp: new Date().toISOString(),
      description: `Rollback to version ${versionId}: ${version.description}`,
      tags: [...version.tags, 'rollback'],
    };

    await this.archive(rollbackEntry);
    return rollbackEntry;
  }

  /**
   * 根据类型筛选版本
   */
  async getVersionsByType(type: VersionEntry['candidateType']): Promise<VersionEntry[]> {
    await this.ensureIndexLoaded();
    return this.versions.filter(v => v.candidateType === type);
  }

  /**
   * 获取存档统计
   */
  async getStats(): Promise<{
    totalVersions: number;
    byType: Record<string, number>;
    averageScore: number;
    topScore: number;
  }> {
    await this.ensureIndexLoaded();
    const byType: Record<string, number> = {};
    let totalScore = 0;

    for (const v of this.versions) {
      byType[v.candidateType] = (byType[v.candidateType] || 0) + 1;
      totalScore += v.score;
    }

    return {
      totalVersions: this.versions.length,
      byType,
      averageScore: this.versions.length > 0 ? Math.round(totalScore / this.versions.length) : 0,
      topScore: this.versions.length > 0 ? Math.max(...this.versions.map(v => v.score)) : 0,
    };
  }

  private async computeDiff(current: VersionEntry): Promise<DiffRecord> {
    if (!current.parentVersionId) {
      return {
        versionId: current.versionId,
        parentVersionId: null,
        additions: current.content.length,
        deletions: 0,
        changedLines: current.content.split('\n').length,
        summary: 'Initial version',
      };
    }

    const parent = await this.getVersion(current.parentVersionId);
    if (!parent) {
      return {
        versionId: current.versionId,
        parentVersionId: current.parentVersionId,
        additions: 0,
        deletions: 0,
        changedLines: 0,
        summary: 'Parent version not found',
      };
    }

    const currentLines = current.content.split('\n');
    const parentLines = parent.content.split('\n');
    const additions = currentLines.filter(l => !parentLines.includes(l)).length;
    const deletions = parentLines.filter(l => !currentLines.includes(l)).length;

    return {
      versionId: current.versionId,
      parentVersionId: current.parentVersionId,
      additions,
      deletions,
      changedLines: additions + deletions,
      summary: `+${additions} / -${deletions} lines`,
    };
  }

  private async saveIndex(): Promise<void> {
    const indexFile = join(this.archiveDir, 'index.json');
    await writeFile(indexFile, JSON.stringify(this.versions.map(v => v.versionId), null, 2), 'utf-8');
  }

  private async ensureIndexLoaded(): Promise<void> {
    await this.initialize();
    if (this.versions.length > 0) return;

    try {
      const indexFile = join(this.archiveDir, 'index.json');
      const indexContent = await readFile(indexFile, 'utf-8');
      const versionIds: string[] = JSON.parse(indexContent);
      for (const vid of versionIds) {
        const v = await this.getVersion(vid);
        if (v) this.versions.push(v);
      }
    } catch {
      // 无索引，从零开始
    }
  }
}
