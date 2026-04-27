import { ToolDefinition } from './ToolRegistry';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export const ReadTool: ToolDefinition = {
  name: 'read',
  description: '读取文件内容',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'encoding', type: 'string', description: '编码格式', required: false, default: 'utf-8' },
    { name: 'offset', type: 'number', description: '起始行号（从0开始）', required: false },
    { name: 'limit', type: 'number', description: '读取行数', required: false },
  ],
  handler: async (args) => {
    const path = args.path as string;
    if (!path || typeof path !== 'string') throw new Error('path 参数必填');
    // 安全检查：防止路径穿越
    if (path.includes('..')) throw new Error('不允许使用相对路径穿越');

    try {
      await access(path, constants.R_OK);
    } catch {
      throw new Error(`文件不可读或不存在: ${path}`);
    }

    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`文件不存在: ${path}`);

    const content = await file.text();

    // 支持行级偏移读取
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    if (offset !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, offset);
      const end = limit !== undefined ? start + limit : undefined;
      return {
        content: lines.slice(start, end).join('\n'),
        path,
        totalLines: lines.length,
        startLine: start,
        endLine: end ?? lines.length,
      };
    }

    return { content, path, totalLines: content.split('\n').length };
  },
};
