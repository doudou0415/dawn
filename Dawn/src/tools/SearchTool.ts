import { ToolDefinition } from './ToolRegistry';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getLogger } from '@dawn/core';
const logger = getLogger('SearchTool');

export const SearchTool: ToolDefinition = {
  name: 'search',
  description: '在项目中搜索文件或内容',
  parameters: [
    { name: 'pattern', type: 'string', description: '搜索关键词或正则', required: true },
    { name: 'rootDir', type: 'string', description: '搜索根目录', required: false, default: '.' },
    { name: 'filePattern', type: 'string', description: '文件过滤模式(如 *.ts)', required: false },
    { name: 'maxResults', type: 'number', description: '最大结果数', required: false, default: 20 },
  ],
  handler: async (args) => {
    const pattern = args.pattern as string;
    const rootDir = args.rootDir as string || '.';
    const maxResults = (args.maxResults as number) || 20;
    const results: Array<{ file: string; line: number; content: string }> = [];

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) return;
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && /\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) {
            try {
              const content = await readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line && line.toLowerCase().includes(pattern.toLowerCase())) {
                  results.push({
                    file: relative(rootDir, fullPath),
                    line: i + 1,
                    content: line.trim(),
                  });
                  if (results.length >= maxResults) break;
                }
              }
            } catch { /* skip unreadable */ }
          }
        }
      } catch { /* skip */ }
    }

    await walk(rootDir);
    return { results, total: results.length, pattern };
  },
};
