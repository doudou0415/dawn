import { ToolDefinition } from './ToolRegistry';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const WriteTool: ToolDefinition = {
  name: 'write',
  description: '写入文件内容（覆盖模式），自动创建父目录',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'content', type: 'string', description: '写入内容', required: true },
    { name: 'append', type: 'boolean', description: '是否追加而非覆盖', required: false, default: false },
  ],
  handler: async (args) => {
    const path = args.path as string;
    const content = args.content as string;
    const append = (args.append as boolean) ?? false;

    if (!path || typeof path !== 'string') throw new Error('path 参数必填');
    if (content === undefined || content === null) throw new Error('content 参数必填');
    if (path.includes('..')) throw new Error('不允许使用相对路径穿越');

    // 自动创建父目录
    const parent = dirname(path);
    await mkdir(parent, { recursive: true });

    if (append) {
      const file = Bun.file(path);
      const existing = (await file.exists()) ? await file.text() : '';
      await Bun.write(path, existing + content);
    } else {
      await Bun.write(path, content);
    }

    return { success: true, path, size: content.length, appended: append };
  },
};
