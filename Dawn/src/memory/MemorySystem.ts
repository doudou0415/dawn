/**
 * MemorySystem — 三层记忆系统
 * - SessionMemory：会话级短期记忆
 * - PersistentMemory：持久化长期记忆（文件/向量）
 * - SkillMemory：技能记忆（行为模式、修复方案等）
 */

import type { IntentType } from '../engine/IntentEngine';
import type { ExecutionContext } from '../engine/Orchestrator';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  type: 'session' | 'persistent' | 'skill';
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  text: string;
  intentType: IntentType;
  limit?: number;
  threshold?: number;
}

class SessionMemory {
  private entries: MemoryEntry[] = [];
  private maxSize = 100;

  async store(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'type'>): Promise<void> {
    this.entries.push({
      ...entry,
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type: 'session',
    });

    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }
  }

  async query(text?: string, limit = 10): Promise<MemoryEntry[]> {
    let results = this.entries.slice(-limit);
    if (text) {
      const lower = text.toLowerCase();
      results = results.filter(e =>
        e.key.toLowerCase().includes(lower) ||
        JSON.stringify(e.value).toLowerCase().includes(lower),
      );
    }
    return results;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}

class PersistentMemory {
  private storagePath: string;

  constructor(basePath: string) {
    this.storagePath = `${basePath}/memory/persistent.json`;
  }

  private async load(): Promise<MemoryEntry[]> {
    try {
      const file = Bun.file(this.storagePath);
      if (!(await file.exists())) return [];
      const content = await file.text();
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async save(entries: MemoryEntry[]): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(entries, null, 2));
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'type'>): Promise<void> {
    const entries = await this.load();
    entries.push({
      ...entry,
      id: `persistent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type: 'persistent',
    });
    await this.save(entries);
  }

  async query(text?: string, limit = 20): Promise<MemoryEntry[]> {
    const entries = await this.load();
    let results = entries.slice(-limit);
    if (text) {
      const lower = text.toLowerCase();
      results = results.filter(e =>
        e.key.toLowerCase().includes(lower) ||
        JSON.stringify(e.value).toLowerCase().includes(lower),
      );
    }
    return results;
  }
}

class SkillMemory {
  private storagePath: string;

  constructor(basePath: string) {
    this.storagePath = `${basePath}/memory/skills.json`;
  }

  private async load(): Promise<MemoryEntry[]> {
    try {
      const file = Bun.file(this.storagePath);
      if (!(await file.exists())) return [];
      const content = await file.text();
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async save(entries: MemoryEntry[]): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(entries, null, 2));
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'type'>): Promise<void> {
    const entries = await this.load();
    entries.push({
      ...entry,
      id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type: 'skill',
    });
    await this.save(entries);
  }

  async query(pattern?: string): Promise<MemoryEntry[]> {
    const entries = await this.load();
    if (!pattern) return entries.slice(-20);
    const lower = pattern.toLowerCase();
    return entries.filter(e =>
      e.key.toLowerCase().includes(lower) ||
      JSON.stringify(e.value).toLowerCase().includes(lower),
    );
  }
}

export class MemorySystem {
  public session: SessionMemory;
  public persistent: PersistentMemory;
  public skill: SkillMemory;

  constructor(basePath?: string) {
    const path = basePath || process.cwd();
    this.session = new SessionMemory();
    this.persistent = new PersistentMemory(path);
    this.skill = new SkillMemory(path);
  }

  async query(text: string, intentType: IntentType): Promise<Record<string, unknown>> {
    const [sessionResults, persistentResults, skillResults] = await Promise.all([
      this.session.query(text, 5),
      this.persistent.query(text, 5),
      this.skill.query(text),
    ]);

    return {
      session: sessionResults,
      persistent: persistentResults,
      skill: skillResults,
      context: {
        text,
        intentType,
        timestamp: Date.now(),
      },
    };
  }

  async record(context: ExecutionContext): Promise<void> {
    const entry = {
      key: `exec_${context.intent.type}_${Date.now()}`,
      value: {
        intent: context.intent.type,
        confidence: context.intent.confidence,
        success: (context.result as Record<string, unknown>)?.success ?? false,
        duration: context.endTime ? context.endTime - context.startTime : 0,
        iterations: context.iterations,
      },
    };

    await this.session.store(entry);

    // 高置信度执行结果入库持久记忆
    if (context.intent.confidence > 0.7) {
      await this.persistent.store(entry);
    }
  }

  async clearSession(): Promise<void> {
    await this.session.clear();
  }
}
