import { ToolDefinition } from './ToolRegistry';

export const ReadTool: ToolDefinition = {
  name: 'read',
  description: '读取文件内容',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'encoding', type: 'string', description: '编码格式', required: false, default: 'utf-8' },
  ],
  handler: async (args) => {
    const path = args.path as string;
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) throw new Error(`File not found: ${path}`);
    return { content: await file.text(), path };
  },
};
