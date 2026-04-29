/**
 * TerminalCapability — 命令执行能力
 *
 * 接管所有需要在终端中运行命令的任务（运行脚本、安装依赖、编译、测试等）。
 * 基于 Bun 的 $ shell，无外部依赖。
 *
 * 设计原则：
 * - 只做一件事：执行命令并返回输出
 * - 所有安全策略（白名单、权限等级）由上层权限链负责
 * - 超时由调用方控制，默认 60s
 */

import type { AtomicCapability, AtomicInput, CapabilityResult } from '../../registry/types.js';
import type { TaskCategory } from '@dawn/core';

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TerminalCapability implements AtomicCapability {
  readonly name = 'terminal';
  readonly description = '终端命令执行（运行、编译、测试、安装等）';
  readonly intentTypes: TaskCategory[] = ['terminal' as TaskCategory, 'execution' as TaskCategory, 'build' as TaskCategory, 'test' as TaskCategory, 'deploy' as TaskCategory];
  readonly permissions = ['terminal:exec'];

  async execute(input: AtomicInput): Promise<CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';
    const command = this.extractCommand(rawInput);

    if (!command) {
      return this.tryQuickCommand(rawInput);
    }

    return this.runCommand(command);
  }

  private extractCommand(input: string): string | null {
    // 多种匹配模式：\n``` ... ```, 反引号包裹, "运行 xxx"
    const blockMatch = input.match(/```(?:bash|shell|sh)?\s*\n([\s\S]*?)```/);
    if (blockMatch) return blockMatch[1]!.trim();

    const backtickMatch = input.match(/`([^`]+)`/);
    if (backtickMatch) return backtickMatch[1]!.trim();

    const runMatch = input.match(/^(?:运行|执行|run|exec(?:ute)?)[：:，,\s]*(.+)/i);
    if (runMatch) return runMatch[1]!.trim();

    return null;
  }

  private async tryQuickCommand(input: string): Promise<CapabilityResult> {
    // 简短关键词匹配常见命令
    const quick: Record<string, string> = {
      'node -v': 'node -v',
      'npm -v': 'npm -v',
      'bun -v': 'bun -v',
      'pwd': 'pwd',
      'ls': 'ls',
      'date': 'date',
      'whoami': 'whoami',
    };

    const lower = input.trim().toLowerCase();
    for (const [key, cmd] of Object.entries(quick)) {
      if (lower.includes(key)) {
        return this.runCommand(cmd);
      }
    }

    return { success: false, output: `无法从输入中提取命令: "${input.slice(0, 80)}"` };
  }

  private async runCommand(command: string): Promise<CapabilityResult> {
    const startTime = Date.now();

    try {
      const proc = Bun.spawn(command.split(/\s+/).filter(Boolean), {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeout = 60_000;
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
      const exitCode = proc.exitCode ?? -1;
      const duration = Date.now() - startTime;

      const result: ExecResult = {
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
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
