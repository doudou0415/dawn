/**
 * FileOpsCapability — 文件操作能力
 * 读取、写入、编辑、删除、移动文件等。
 * 基于 Bun 的 file I/O，无外部依赖。
 */

import type { AtomicCapability, CapabilityInput } from '@dawn/core';
import type { CapabilityResult } from '../../registry/types.js';

type FileOpType = 'read' | 'write' | 'edit' | 'delete' | 'list' | 'info';

export class FileOpsCapability implements AtomicCapability {
  readonly name = 'file_ops';
  readonly description = '文件读写、编辑、删除等操作';
  readonly intentTypes = ['file_operation', 'code_modification'] as any;
  readonly permissions = ['fs:read', 'fs:write', 'fs:delete'];

  async execute(input: CapabilityInput): Promise<CapabilityResult> {
    const op = this.detectOperation((input as any).rawInput || '');
    const filePath = this.extractPath((input as any).rawInput || '');

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
      const dir = Bun.file(targetPath);
      // Bun.file 不支持 readdir，需要改用 fs
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
    // 从输入中提取要写入的内容（"写入 内容 到 路径"或"write 内容 to 路径"）
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
      // 从输入中提取替换模式（"将 old 替换为 new" 或 "replace old with new"）
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
