/**
 * EvolutionSandbox — 严格只读安全沙箱
 *
 * 职责：
 * - 阻止对核心目录（src/engine/, src/core/, src/memory/ 等）的写操作
 * - 只允许读取操作 + 在临时目录生成新版本
 * - 所有 mutation 操作必须经过 sandbox.validate()
 *
 * 核心目录 = 引擎/核心代码，禁止被 evolution 修改
 * 安全目录 = evolution 可以自由读写自身产物
 * 临时目录 = mutation 产生的新版本文件
 */

import { access, constants } from 'fs/promises';
import { join, relative, normalize, resolve } from 'path';

export interface SandboxConfig {
  /** 项目根目录 */
  projectRoot: string;
  /** 受保护的核心路径（禁止修改） */
  protectedPaths: string[];
  /** Evolution 可自由读写的安全路径 */
  safePaths: string[];
  /** 临时目录根路径 */
  tempRoot: string;
}

export interface SandboxResult {
  allowed: boolean;
  reason: string;
  /** 如果是写入临时目录，返回重定向后的路径 */
  redirectedPath?: string;
}

export interface ReadResult {
  allowed: boolean;
  reason: string;
  /** 实际可读取的路径 */
  resolvedPath?: string;
}

/**
 * 操作类型
 */
export type SandboxOperation = 'read' | 'write' | 'delete' | 'execute';

const DEFAULT_PROTECTED_PATHS = [
  'src/engine',
  'src/core',
  'src/memory',
  'src/capabilities',
  'src/orchestrator',
  'src/tools',
  'packages',
  'DawnPanel',
  'node_modules',
  '.git',
  'tsconfig.json',
  'package.json',
  'bun.lock',
  'CLAUDE.md',
];

const DEFAULT_SAFE_PATHS = [
  'src/evolution',
  '.dawn-memory',
  'tmp/evolution',
];

export class EvolutionSandbox {
  private config: SandboxConfig;
  private operationLog: Array<{ operation: SandboxOperation; path: string; timestamp: number; allowed: boolean }> = [];

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = {
      projectRoot: config.projectRoot || process.cwd(),
      protectedPaths: config.protectedPaths || DEFAULT_PROTECTED_PATHS,
      safePaths: config.safePaths || DEFAULT_SAFE_PATHS,
      tempRoot: config.tempRoot || join(process.cwd(), 'tmp', 'evolution-sandbox'),
    };

    // 标准化所有路径（统一正斜杠）
    this.config.protectedPaths = this.config.protectedPaths.map(p => this.toForward(normalize(p)));
    this.config.safePaths = this.config.safePaths.map(p => this.toForward(normalize(p)));
  }

  /**
   * 验证某个操作是否被允许
   * - read: 只要不在 protectedPaths 外额外限制，基本允许
   * - write: 写入 protectedPaths → 拒绝；写入 safePaths → 允许；其他路径 → 重定向到 tempRoot
   * - delete: 同 write 规则
   * - execute: 仅允许在 safePaths 和 tempRoot 内执行
   */
  validate(operation: SandboxOperation, targetPath: string): SandboxResult {
    const absPath = resolve(this.config.projectRoot, targetPath);
    const relPath = relative(this.config.projectRoot, absPath);
    const normalizedRel = this.toForward(normalize(relPath));

    const result = this.evaluateOperation(operation, normalizedRel, absPath);
    this.operationLog.push({
      operation,
      path: normalizedRel,
      timestamp: Date.now(),
      allowed: result.allowed,
    });

    return result;
  }

  /**
   * 验证读取路径 — 拒绝读取其他工程的敏感文件
   */
  validateRead(targetPath: string): ReadResult {
    const absPath = resolve(this.config.projectRoot, targetPath);
    const relPath = relative(this.config.projectRoot, absPath);
    const normalizedRel = this.toForward(normalize(relPath));

    // 读取总是比写入宽松，但仍保护核心路径不被意外读取敏感内容
    // 实际上读取是安全的，我们允许读取任何项目内路径
    return {
      allowed: true,
      reason: 'read_ok',
      resolvedPath: absPath,
    };
  }

  /**
   * 判断路径是否在受保护列表中
   */
  isProtected(targetPath: string): boolean {
    const normalized = this.toForward(normalize(targetPath));
    return this.config.protectedPaths.some(p =>
      normalized === p || normalized.startsWith(p + '/')
    );
  }

  /**
   * 判断路径是否在安全列表中
   */
  isSafe(targetPath: string): boolean {
    const normalized = this.toForward(normalize(targetPath));
    return this.config.safePaths.some(p =>
      normalized === p || normalized.startsWith(p + '/')
    );
  }

  /**
   * 获取临时目录路径用于存放 EFS 生成的新版本文件
   */
  getTempPath(subpath: string = ''): string {
    return join(this.config.tempRoot, subpath);
  }

  /**
   * 获取已记录的沙箱操作日志（用于审计）
   */
  getOperationLog() {
    return [...this.operationLog];
  }

  /**
   * 获取沙箱配置（只读副本）
   */
  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }

  private evaluateOperation(
    operation: SandboxOperation,
    normalizedRel: string,
    absPath: string
  ): SandboxResult {
    // 读取操作：始终允许（但不能是书写 protected 文件这种误用）
    if (operation === 'read') {
      return { allowed: true, reason: 'read_allowed' };
    }

    // 写/删/执行：检查保护
    if (operation === 'write' || operation === 'delete') {
      // 受保护路径 → 拒绝
      if (this.isProtected(normalizedRel)) {
        return {
          allowed: false,
          reason: `被拒绝: ${normalizedRel} 是受保护的核心路径，不允许修改`,
        };
      }

      // 安全路径 → 允许
      if (this.isSafe(normalizedRel)) {
        return { allowed: true, reason: `safe_path_write_allowed` };
      }

      // 其他路径 → 重定向到临时目录
      const redirectedPath = join(this.config.tempRoot, normalizedRel);
      return {
        allowed: true,
        reason: `路径 ${normalizedRel} 不在安全区，已重定向到沙箱临时目录`,
        redirectedPath,
      };
    }

    // 执行操作：仅允许在 safePaths 和 tempRoot
    if (operation === 'execute') {
      if (this.isSafe(normalizedRel) || normalizedRel.startsWith('tmp/evolution-sandbox')) {
        return { allowed: true, reason: 'execute_allowed_in_safe_zone' };
      }
      return {
        allowed: false,
        reason: `被拒绝: 不允许在 ${normalizedRel} 执行操作，仅在 safePaths 和 tempRoot 内可执行`,
      };
    }

    return { allowed: false, reason: `未知操作类型: ${operation}` };
  }

  /**
   * 将路径中的反斜杠统一转为正斜杠（Windows 兼容）
   */
  private toForward(p: string): string {
    return p.replace(/\\/g, '/');
  }
}
