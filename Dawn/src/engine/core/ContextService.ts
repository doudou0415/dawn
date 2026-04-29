/**
 * ContextService — 共享上下文服务
 *
 * 统一管理 HistoryManager + MemorySystem + IntentEngine，
 * 使 Coordinator 路径也能拥有完整的对话历史与三层记忆系统，
 * 与 Agent.execute() → ExecutionLoop 路径保持一致。
 *
 * 设计原则：最小侵入 + 最大复用
 * - HistoryManager 复用现有实现（需要 ConversationContext）
 * - MemorySystem 复用现有实现
 * - IntentEngine 复用现有实现
 */

import { HistoryManager } from './HistoryManager.js';
import { MemorySystem } from '../../memory/MemorySystem.js';
import { IntentEngine } from '../intent/IntentEngine.js';
import { PreferenceExtractor } from './PreferenceExtractor.js';
import type { ConversationContext } from '@dawn/core';
import crypto from 'node:crypto';
import { DialogueStateType } from '@dawn/core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface LLMContext {
  history: { role: string; content: string }[];
  memoryContext: string;
  atReferences?: string;
}

export class ContextService {
  public historyManager: HistoryManager;
  public memorySystem: MemorySystem;
  public intentEngine: IntentEngine;
  public preferenceExtractor: PreferenceExtractor;

  private contextMap: Map<string, ConversationContext> = new Map();

  constructor(basePath?: string) {
    this.memorySystem = new MemorySystem(basePath);
    this.intentEngine = new IntentEngine();
    this.preferenceExtractor = new PreferenceExtractor();

    // 创建默认会话上下文
    const defaultCtx = this.createContext();
    this.contextMap.set('default', defaultCtx);
    this.historyManager = new HistoryManager(defaultCtx, this.memorySystem);
  }

  /**
   * 获取或创建指定 sessionId 的对话上下文
   */
  getOrCreateContext(sessionId: string = 'default'): ConversationContext {
    let ctx = this.contextMap.get(sessionId);
    if (!ctx) {
      ctx = this.createContext();
      this.contextMap.set(sessionId, ctx);
    }
    return ctx;
  }

  /**
   * 获取指定 session 的 HistoryManager
   */
  getHistoryManager(sessionId: string = 'default'): HistoryManager {
    const ctx = this.getOrCreateContext(sessionId);
    if (sessionId === 'default') return this.historyManager;
    return new HistoryManager(ctx, this.memorySystem);
  }

  /**
   * 获取 MemorySystem 实例
   */
  getMemorySystem(): MemorySystem {
    return this.memorySystem;
  }

  /**
   * 获取 IntentEngine 实例
   */
  getIntentEngine(): IntentEngine {
    return this.intentEngine;
  }

  /**
   * 解析任务中的 @file、@folder、@git 语法，返回注入的上下文信息
   */
  private resolveAtReferences(task: string, cwd: string): string {
    const references: string[] = [];

    // @file <path> — 读取文件内容
    const fileRegex = /@file\s+(\S+)/g;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = fileRegex.exec(task)) !== null) {
      const filePath = fileMatch[1];
      try {
        const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const content = fs.readFileSync(resolved, 'utf-8');
          const lines = content.split('\n').length;
          references.push(
            `--- 文件: ${filePath} (${lines} 行) ---\n${content}\n--- 文件结束 ---`,
          );
        } else {
          references.push(`[ContextService] 文件未找到: ${filePath}`);
        }
      } catch {
        references.push(`[ContextService] 读取失败: ${filePath}`);
      }
    }

    // @folder <path> — 列出目录结构（排除 node_modules, .git）
    const folderRegex = /@folder\s+(\S+)/g;
    let folderMatch: RegExpExecArray | null;
    while ((folderMatch = folderRegex.exec(task)) !== null) {
      const folderPath = folderMatch[1];
      try {
        const resolved = path.isAbsolute(folderPath) ? folderPath : path.join(cwd, folderPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          const tree = this.buildDirectoryTree(resolved, '');
          references.push(`--- 目录结构: ${folderPath} ---\n${tree}\n--- 目录结束 ---`);
        } else {
          references.push(`[ContextService] 目录未找到: ${folderPath}`);
        }
      } catch {
        references.push(`[ContextService] 读取目录失败: ${folderPath}`);
      }
    }

    // @git — Git diff 感知
    if (/@git\b/.test(task)) {
      try {
        const diff = execSync('git diff --stat', { cwd, encoding: 'utf-8', timeout: 5000 });
        const staged = execSync('git diff --cached --stat', { cwd, encoding: 'utf-8', timeout: 5000 });
        const status = execSync('git status --short', { cwd, encoding: 'utf-8', timeout: 5000 });
        references.push(
          '--- Git 状态 ---\n' +
          `未暂存变更:\n${diff || '(无)'}\n` +
          `已暂存变更:\n${staged || '(无)'}\n` +
          `概览:\n${status || '(无)'}\n` +
          '--- Git 状态结束 ---',
        );
      } catch {
        references.push('[ContextService] Git 信息获取失败（可能不在 git 仓库中）');
      }
    }

    return references.length > 0 ? references.join('\n\n') : '';
  }

  /**
   * 递归构建目录树（排除 node_modules, .git）
   */
  private buildDirectoryTree(dirPath: string, prefix: string): string {
    const lines: string[] = [];
    const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'target', '__pycache__']);
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDE.has(entry.name)) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          lines.push(`${prefix}📁 ${entry.name}/`);
          const sub = this.buildDirectoryTree(fullPath, prefix + '  ');
          if (sub) lines.push(sub);
        } else {
          lines.push(`${prefix}📄 ${entry.name}`);
        }
      }
    } catch {
      // 跳过无法读取的目录
    }
    return lines.join('\n');
  }

  /**
   * 获取当前工作目录（尝试从环境变量或 process.cwd()）
   */
  private getCwd(): string {
    return process.env.DAWN_PROJECT_DIR || process.cwd();
  }

  /**
   * 构建 LLM 上下文（含历史消息 + 记忆检索 + @引用注入）
   */
  async buildLLMContext(task: string, sessionId: string = 'default'): Promise<LLMContext> {
    const historyMgr = this.getHistoryManager(sessionId);
    const history = historyMgr.getConversationHistory().map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 记忆检索
    let memoryContext = '';
    try {
      const memCtx = await this.memorySystem.getRelevantMemories({ text: task, limit: 3 });
      if (memCtx.summary && memCtx.summary !== '无相关记忆') {
        memoryContext = memCtx.summary;
      }
    } catch {
      // 记忆检索失败不影响主流程
    }

    // @引用解析（@file / @folder / @git）
    const cwd = this.getCwd();
    const atRefs = this.resolveAtReferences(task, cwd);

    return { history, memoryContext, atReferences: atRefs };
  }

  /**
   * 提取并保存偏好
   */
  async extractAndSavePreferences(input: string): Promise<void> {
    const prefMatch = this.preferenceExtractor.extract(input);
    if (prefMatch) {
      await this.memorySystem.savePreference(prefMatch.key, prefMatch.value);
    }
  }

  /**
   * 创建新的 ConversationContext
   */
  private createContext(): ConversationContext {
    const initialState = {
      id: crypto.randomUUID(),
      type: DialogueStateType.Greeting,
      timestamp: new Date().toISOString(),
      data: {
        intent: 'greeting',
        expectedInput: '用户问候或任务请求',
      },
    };

    return {
      sessionId: crypto.randomUUID(),
      messages: [],
      currentTopic: null,
      lastTask: null,
      entityMemory: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dialogueState: initialState,
      dialogueHistory: [initialState],
      currentIntent: null,
      expectedInput: null,
      followUpQuestions: [],
    };
  }

  /**
   * 清除指定 session 的对话历史
   */
  clearHistory(sessionId: string = 'default'): void {
    const historyMgr = this.getHistoryManager(sessionId);
    historyMgr.clearConversationHistory();
  }
}
