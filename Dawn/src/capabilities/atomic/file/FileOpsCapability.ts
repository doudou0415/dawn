/**
 * FileOpsCapability — 文件操作能力
 * 读取、写入、编辑、删除、移动文件等。
 * 基于 Bun 的 file I/O，无外部依赖。
 *
 * 安全策略：
 * - 沙箱路径限制：仅允许操作项目目录内的文件
 * - 禁止操作敏感路径：.git、node_modules 根级等
 */

import type { AtomicCapability, CapabilityInput } from '@dawn/core';
import type { CapabilityResult } from '../../registry/types.js';
import { resolve, normalize, relative } from 'path';
import { getLogger } from '@dawn/core';

const logger = getLogger('FileOpsCapability');

type FileOpType = 'read' | 'write' | 'edit' | 'delete' | 'list' | 'info';

/**
 * 禁止操作的文件/目录模式
 */
const BLOCKED_PATTERNS = [
  /[/\\]\.git[/\\]/,
  /[/\\]node_modules[/\\]/,
  /\.env$/,
  /\.env\.local$/,
  /credentials\./,
  /\.ssh[/\\]/,
];

/**
 * 项目根目录（工作目录，用于沙箱路径限制）
 */
function getProjectRoot(): string {
  return process.cwd();
}

/**
 * 检查路径是否在沙箱范围内
 */
function isPathInSandbox(targetPath: string): { safe: boolean; reason?: string } {
  const projectRoot = getProjectRoot();
  const resolved = resolve(projectRoot, targetPath);
  const normalized = normalize(resolved);
  const rel = relative(projectRoot, normalized);

  // 路径必须在项目目录内（不能通过 .. 逃逸）
  if (rel.startsWith('..') || (rel.length > 0 && !rel.startsWith('.'))) {
    // 如果 relative 以 .. 开头，说明在项目目录外
    const absPath = resolve(targetPath);
    const absRel = relative(projectRoot, absPath);
    if (absRel.startsWith('..')) {
      return { safe: false, reason: `路径 "${targetPath}" 在项目目录外，已阻止` };
    }
  }

  const forwardPath = normalized.replace(/\\/g, '/');

  // 检查敏感模式
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(forwardPath)) {
      return { safe: false, reason: `路径匹配敏感模式: ${pattern}` };
    }
  }

  return { safe: true };
}

function sanitizePath(rawPath: string): string {
  const projectRoot = getProjectRoot();
  const resolved = resolve(projectRoot, rawPath || '.');
  return normalized(resolved);
}

function normalized(p: string): string {
  return normalize(p);
}

export class FileOpsCapability implements AtomicCapability {
  readonly name = 'file_ops';
  readonly description = '文件读写、编辑、删除等操作';
  readonly intentTypes = ['file_operation', 'code_modification'] as any;
  readonly permissions = ['fs:read', 'fs:write', 'fs:delete'];

  async execute(input: CapabilityInput): Promise<CapabilityResult> {
    const op = this.detectOperation((input as any).rawInput || '');
    const rawPath = this.extractPath((input as any).rawInput || '');
    const filePath = sanitizePath(rawPath);

    // 安全检查
    const sandboxCheck = isPathInSandbox(rawPath);
    if (!sandboxCheck.safe) {
      logger.warn(`文件操作被阻止: ${op} ${rawPath} — ${sandboxCheck.reason}`);
      return {
        success: false,
        output: `[安全拦截] ${sandboxCheck.reason}`,
        permissionsUsed: ['fs:read'],
        metadata: { operation: op, path: rawPath, blocked: true },
      };
    }

    let result: any;
    switch (op) {
      case 'read':
        result = await this.readFile(filePath);
        break;
      case 'write':
        result = await this.writeFile(filePath, (input as any).rawInput || '');
        break;
      case 'edit':
        result = await this.editFile(filePath, (input as any).rawInput || '');
        break;
      case 'delete':
        result = await this.deleteFile(filePath);
        break;
      case 'list':
        result = await this.listDirectory(filePath);
        break;
      case 'info':
        result = await this.getFileInfo(filePath);
        break;
      default:
        result = { success: false, output: `未知操作类型: '${op}'` };
    }
    return {
      success: result.success !== false,
      output: result.message || result.error || JSON.stringify(result),
      metadata: result,
      permissionsUsed: ['fs:read'],
      durationMs: 0,
    };
  }

  private detectOperation(input: string): FileOpType {
    if (/(读取|读|打开|read|open|cat)/i.test(input)) return 'read';
    if (/(写入|写|write|创建|create)/i.test(input)) return 'write';
    if (/(编辑|edit|修改|update|改写)/i.test(input)) return 'edit';
    if (/(删除|delete|rm|移除|remove)/i.test(input)) return 'delete';
    if (/(列表|list|ls|目录|dir)/i.test(input)) return 'list';
    return 'info';
  }

  private extractPath(input: string): string {
    const match = input.match(/(?:路径|path|文件|file)?[:：]?\s*"?([^\s"']+\.[^\s"']+)"?/);
    return (match ? match[1] : '') ?? '';
  }

  private async readFile(filePath: string): Promise<unknown> {
    if (!filePath) return { error: '未指定文件路径' };
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) return { error: `文件不存在: ${filePath}` };
      const content = await file.text();
      return { success: true, filePath, content, size: content.length };
    } catch (error) {
      return { error: `读取失败: ${(error as Error).message}` };
    }
  }

  private async listDirectory(dirPath: string): Promise<unknown> {
    const targetPath = dirPath || '.';
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(targetPath);
      return { success: true, path: targetPath, entries };
    } catch (error) {
      return { error: `列表失败: ${(error as Error).message}` };
    }
  }

  private async getFileInfo(filePath: string): Promise<unknown> {
    if (!filePath) return { error: '未指定文件路径' };
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) return { error: `文件不存在: ${filePath}` };
      const stat = await file.stat();
      return {
        success: true,
        filePath,
        size: stat.size,
        modifiedTime: stat.mtime,
        createdTime: stat.birthtime,
        isDirectory: false,
      };
    } catch (error) {
      return { error: `获取信息失败: ${(error as Error).message}` };
    }
  }

  private async writeFile(filePath: string, rawInput: string): Promise<unknown> {
    if (!filePath) return { error: '未指定文件路径' };
    const contentMatch = rawInput.match(/(?:写入|写|write|创建|create)\s*[:：]?\s*["'`]?([\s\S]*?)["'`]?\s*(?:到|至|to|@)\s*["'`]?(.+?)["'`]?\s*$/i);
    const content = (contentMatch ? contentMatch[1]?.trim() : '') ?? '';
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      return { success: true, filePath, size: content.length, message: `已写入 ${content.length} 字符` };
    } catch (error) {
      return { error: `写入失败: ${(error as Error).message}` };
    }
  }

  private async editFile(filePath: string, rawInput: string): Promise<unknown> {
    if (!filePath) return { error: '未指定文件路径' };
    try {
      const { readFile, writeFile } = await import('node:fs/promises');
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) return { error: `文件不存在: ${filePath}` };
      const currentContent = await readFile(filePath, 'utf-8');
      const replaceMatch = rawInput.match(/(?:将|把|replace)\s*["'`]?(.+?)["'`]?\s*(?:替换为|替换成|改为|改为|with|to)\s*["'`]?(.+?)["'`]?\s*(?:在|in|@)?\s*$/i);
      if (replaceMatch) {
        const oldStr = replaceMatch[1] ?? '';
        const newStr = replaceMatch[2] ?? '';
        const updated = currentContent.replaceAll(oldStr, newStr);
        await writeFile(filePath, updated, 'utf-8');
        return { success: true, filePath, message: `已替换所有 "${oldStr}" → "${newStr}"`, changed: currentContent !== updated };
      }
      return { success: true, filePath, message: '文件内容未修改（未检测到替换模式）' };
    } catch (error) {
      return { error: `编辑失败: ${(error as Error).message}` };
    }
  }

  private async deleteFile(filePath: string): Promise<unknown> {
    if (!filePath) return { error: '未指定文件路径' };
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
      return { success: true, filePath, message: `已删除: ${filePath}` };
    } catch (error) {
      return { error: `删除失败: ${(error as Error).message}` };
    }
  }
}
