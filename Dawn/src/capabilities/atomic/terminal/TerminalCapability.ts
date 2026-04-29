/**
 * TerminalCapability — 命令执行能力
 *
 * 接管所有需要在终端中运行命令的任务（运行脚本、安装依赖、编译、测试等）。
 * 基于 Bun 的 $ shell，无外部依赖。
 *
 * 安全策略：
 * - 危险命令白名单：rm -rf、curl、wget、dd、mkfs 等需二次确认
 * - 输出大小限制：1MB
 * - 超时：10s（普通命令）/ 30s（长任务）
 * - 命令注入防护
 */

import type { AtomicCapability, AtomicInput, CapabilityResult } from '../../registry/types.js';
import type { TaskCategory } from '@dawn/core';
import { getLogger } from '@dawn/core';

const logger = getLogger('TerminalCapability');

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 危险命令前缀列表（执行前需要用户二次确认）
 */
const DANGEROUS_COMMANDS = [
  'rm -rf', 'rm -r', 'rm -f', 'rm --recursive', 'rm --force',
  'curl', 'wget',
  'dd', 'mkfs', 'format', 'fdisk', 'parted',
  'chmod -R 777', 'chmod 777', 'chown',
  'shutdown', 'reboot', 'halt', 'poweroff',
  '> /dev/sda', '< /dev/sda',
  ':(){ :|:& };:',  // fork bomb
  'mv /', 'cp -r /',
];

/**
 * 快速命令白名单（可直接执行，无需确认）
 */
const QUICK_WHITELIST: Record<string, string> = {
  'node -v': 'node -v',
  'npm -v': 'npm -v',
  'bun -v': 'bun -v',
  'pwd': 'pwd',
  'ls': 'ls',
  'date': 'date',
  'whoami': 'whoami',
  'echo': 'echo',
  'cat': 'cat',
  'head': 'head',
  'tail': 'tail',
  'git status': 'git status',
  'git log': 'git log',
  'git diff': 'git diff',
  'bun test': 'bun test',
  'bun run': 'bun run',
};

export class TerminalCapability implements AtomicCapability {
  readonly name = 'terminal';
  readonly description = '终端命令执行（运行、编译、测试、安装等）';
  readonly intentTypes: TaskCategory[] = ['terminal' as TaskCategory, 'execution' as TaskCategory, 'build' as TaskCategory, 'test' as TaskCategory, 'deploy' as TaskCategory];
  readonly permissions = ['terminal:exec'];

  /** 最大输出大小（1MB） */
  private readonly MAX_OUTPUT_SIZE = 1024 * 1024;
  /** 普通命令超时 (10s) */
  private readonly DEFAULT_TIMEOUT = 10_000;
  /** 长任务超时 (30s) */
  private readonly LONG_TIMEOUT = 30_000;

  async execute(input: AtomicInput): Promise<CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';
    const command = this.extractCommand(rawInput);

    if (!command) {
      return this.tryQuickCommand(rawInput);
    }

    // 安全检查：危险命令
    const dangerCheck = this.checkDangerousCommand(command);
    if (!dangerCheck.safe) {
      return {
        success: false,
        output: `[安全拦截] 命令可能存在风险，已阻止执行。\n命令: ${command}\n原因: ${dangerCheck.reason}\n请确认后手动执行。`,
        permissionsUsed: ['terminal:exec'],
        metadata: { command, blocked: true, reason: dangerCheck.reason },
      };
    }

    return this.runCommand(command);
  }

  /**
   * 检查命令是否在危险列表中
   */
  private checkDangerousCommand(command: string): { safe: boolean; reason: string } {
    const lower = command.trim().toLowerCase();

    for (const dangerous of DANGEROUS_COMMANDS) {
      if (lower.startsWith(dangerous)) {
        return {
          safe: false,
          reason: `命令 "${dangerous}" 属于高风险操作，需要用户二次确认`,
        };
      }
    }

    // 检测 shell 管道到危险操作
    if (/\|\s*(rm|dd|mkfs|format)\b/.test(lower)) {
      return { safe: false, reason: '管道到危险命令被阻止' };
    }

    // 检测 sudo
    if (lower.startsWith('sudo ')) {
      return { safe: false, reason: '禁止通过 sudo 提权执行命令' };
    }

    return { safe: true, reason: '' };
  }

  private extractCommand(input: string): string | null {
    const blockMatch = input.match(/```(?:bash|shell|sh)?\s*\n([\s\S]*?)```/);
    if (blockMatch) return blockMatch[1]!.trim();

    const backtickMatch = input.match(/`([^`]+)`/);
    if (backtickMatch) return backtickMatch[1]!.trim();

    const runMatch = input.match(/^(?:运行|执行|run|exec(?:ute)?)[：:，,\s]*(.+)/i);
    if (runMatch) return runMatch[1]!.trim();

    return null;
  }

  private async tryQuickCommand(input: string): Promise<CapabilityResult> {
    const lower = input.trim().toLowerCase();
    for (const [key, cmd] of Object.entries(QUICK_WHITELIST)) {
      if (lower.includes(key)) {
        return this.runCommand(cmd);
      }
    }

    return { success: false, output: `无法从输入中提取命令: "${input.slice(0, 80)}"` };
  }

  private async runCommand(command: string): Promise<CapabilityResult> {
    const startTime = Date.now();
    logger.info(`执行命令: ${command.slice(0, 100)}`);

    try {
      const proc = Bun.spawn(command.split(/\s+/).filter(Boolean), {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeout = command.length > 200 ? this.LONG_TIMEOUT : this.DEFAULT_TIMEOUT;
      const timedOut = await Promise.race([
        proc.exited,
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            proc.kill();
            resolve(true);
          }, timeout);
        }),
      ]);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // 输出大小限制
      const truncateOutput = (text: string, maxSize: number): string => {
        if (text.length <= maxSize) return text;
        return text.slice(0, maxSize) + `\n\n... (输出截断，原始大小 ${text.length} 字节)`;
      };

      const exitCode = proc.exitCode ?? -1;
      const duration = Date.now() - startTime;

      const result: ExecResult = {
        success: exitCode === 0 && !timedOut,
        stdout: truncateOutput(stdout.trim(), this.MAX_OUTPUT_SIZE),
        stderr: truncateOutput(stderr.trim(), this.MAX_OUTPUT_SIZE),
        exitCode,
      };

      const outputLines: string[] = [];
      if (result.stdout) outputLines.push(result.stdout);
      if (result.stderr) outputLines.push(`[stderr]\n${result.stderr}`);

      const output = outputLines.join('\n\n') || '(无输出)';

      return {
        success: result.success,
        output: timedOut
          ? `命令执行超时（${timeout / 1000}s）\n${output.slice(0, 2000)}`
          : output,
        metadata: {
          command,
          exitCode: result.exitCode,
          durationMs: duration,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
        },
        permissionsUsed: ['terminal:exec'],
      };
    } catch (err) {
      return {
        success: false,
        output: `命令执行失败: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { command },
        permissionsUsed: ['terminal:exec'],
      };
    }
  }
}
