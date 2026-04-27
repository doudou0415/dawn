import { ToolDefinition } from './ToolRegistry';
import { execSync, ExecSyncOptions } from 'node:child_process';

// ── 安全配置 ──

/** 禁止的破坏性命令（正则匹配完整命令） */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /^rm\s+-rf\s+\/\s*$/,
  /^dd\s+/, /^mkfs/, /^format/,
  /^powershell.*Remove-Item/, /^del\s+\/f/, /^rd\s+\/s/,
];

/** 白名单命令前缀（不在白名单中的非内部命令将被拒绝） */
const ALLOWED_COMMAND_PREFIXES = [
  'git', 'npm', 'bun', 'node', 'tsc', 'eslint', 'prettier',
  'ls', 'cat', 'head', 'tail', 'echo', 'printf',
  'cd', 'pwd', 'mkdir', 'rmdir', 'cp', 'mv', 'touch', 'chmod',
  'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'sort', 'uniq', 'wc',
  'curl', 'wget',
  'docker', 'docker-compose',
  'pnpm', 'yarn',
  'pip', 'pip3', 'python', 'python3', 'go', 'rustc', 'cargo',
  'make', 'cmake',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'ps', 'top', 'htop', 'df', 'du', 'free', 'uname', 'whoami', 'id',
  'env', 'export', 'source',
  'diff', 'patch',
  'tee', 'xargs',
  'jq', 'yq',
  'kill', 'killall',
  'which', 'type', 'file',
  'date', 'cal', 'bc',
  'ping', 'nslookup', 'dig',
  'ssh', 'scp', 'rsync',
  // Windows 特定
  'cmd', 'powershell', 'where', 'tasklist', 'taskkill',
  'tree', 'dir', 'type', 'copy', 'move', 'del', 'ren', 'mklink',
  'cargo', 'rustup',
];

function isDangerousPattern(command: string): boolean {
  return FORBIDDEN_PATTERNS.some(p => p.test(command.trim().toLowerCase()));
}

function isCommandWhitelisted(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return false;
  return ALLOWED_COMMAND_PREFIXES.includes(firstWord);
}

/**
 * 检查命令是否包含注入特征
 * - 禁止空字节、换行注入等
 */
function hasInjectionChars(command: string): boolean {
  return command.includes('\u0000') || /\r?\n/.test(command);
}

/**
 * 命令注入安全检查
 */
function validateCommand(command: string): string | null {
  if (!command || typeof command !== 'string') {
    return 'command 参数必填';
  }
  if (isDangerousPattern(command)) {
    return '禁止执行危险命令: ' + command;
  }
  if (hasInjectionChars(command)) {
    return '命令包含非法字符';
  }
  if (!isCommandWhitelisted(command)) {
    // 允许以 /、./、.\\、/ 开头的路径执行（本地脚本）
    const firstWord = command.trim().split(/\s+/)[0] ?? '';
    if (
      firstWord.startsWith('/') ||
      firstWord.startsWith('./') ||
      firstWord.startsWith('.\\') ||
      firstWord.startsWith('"')
    ) {
      return null; // 本地路径执行允许
    }
    return `命令不在白名单中: ${firstWord}`;
  }
  return null;
}

export const BashTool: ToolDefinition = {
  name: 'bash',
  description: '在终端执行命令（带安全限制和白名单）',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令', required: true },
    { name: 'timeout', type: 'number', description: '超时时间（毫秒）', required: false, default: 30000 },
    { name: 'cwd', type: 'string', description: '工作目录', required: false },
  ],
  handler: async (args) => {
    const command = args.command as string;

    // ── 命令注入安全检查 ──
    const validationError = validateCommand(command);
    if (validationError) {
      return { stdout: '', stderr: validationError, exitCode: 1 };
    }

    const timeout = Math.min(Math.max((args.timeout as number) || 30000, 1000), 300000); // 1s~5min
    const cwd = args.cwd as string | undefined;

    // 清理环境变量中的空字节
    const cleanEnv = { ...process.env };
    for (const [key, value] of Object.entries(cleanEnv)) {
      if (value && value.includes('\u0000')) {
        cleanEnv[key] = value.replace(/\u0000/g, '');
      }
    }

    const options: ExecSyncOptions = {
      timeout,
      encoding: 'utf-8' as const,
      maxBuffer: 10 * 1024 * 1024,
      env: cleanEnv,
      ...(cwd ? { cwd } : {}),
    };

    try {
      const output = execSync(command, options);
      return {
        stdout: output?.toString() || '',
        stderr: '',
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as {
        stderr?: string | Buffer;
        stdout?: string | Buffer;
        status?: number;
        message: string;
      };
      return {
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || err.message,
        exitCode: err.status ?? 1,
      };
    }
  },
};
