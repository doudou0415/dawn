import { ToolDefinition } from './ToolRegistry';

export const WriteTool: ToolDefinition = {
  name: 'write',
  description: '写入文件内容（覆盖模式）',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'content', type: 'string', description: '写入内容', required: true },
  ],
  handler: async (args) => {
    const path = args.path as string;
    const content = args.content as string;
    await Bun.write(path, content);
    return { success: true, path, size: content.length };
  },
};
