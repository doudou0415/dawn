import { ToolDefinition } from './ToolRegistry';
import { execSync } from 'node:child_process';

export const BashTool: ToolDefinition = {
  name: 'bash',
  description: '在终端执行命令',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令', required: true },
    { name: 'timeout', type: 'number', description: '超时时间（毫秒）', required: false, default: 30000 },
  ],
  handler: async (args) => {
    const command = args.command as string;
    const timeout = (args.timeout as number) || 30000;

    try {
      const output = execSync(command, {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: output, stderr: '', exitCode: 0 };
    } catch (error: unknown) {
      const err = error as { stderr?: string; stdout?: string; status?: number; message: string };
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.status ?? 1,
      };
    }
  },
};
