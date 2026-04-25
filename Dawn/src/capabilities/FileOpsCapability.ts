/**
 * FileOpsCapability — 文件操作能力
 * 读取、写入、编辑、删除、移动文件等。
 * 基于 Bun 的 file I/O，无外部依赖。
 */

import { Capability, CapabilityInput } from './CapabilityRegistry';

type FileOpType = 'read' | 'write' | 'edit' | 'delete' | 'list' | 'info';

export class FileOpsCapability implements Capability {
  readonly name = 'file_ops';
  readonly description = '文件读写、编辑、删除等操作';
  readonly intentTypes = ['file_operation'] as const;

  async execute(input: CapabilityInput): Promise<unknown> {
    const op = this.detectOperation(input.rawInput);
    const filePath = this.extractPath(input.rawInput);

    switch (op) {
      case 'read':
        return this.readFile(filePath);
      case 'list':
        return this.listDirectory(filePath);
      case 'info':
        return this.getFileInfo(filePath);
      default:
        return { op, filePath, message: `操作类型 '${op}' 需要更完整的实现` };
    }
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
    return match ? match[1] : '';
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
}
