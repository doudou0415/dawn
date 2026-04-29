#!/usr/bin/env node
/**
 * Dawn — CLI 入口 (REPL + 任务执行)
 *
 * 阶段 2: 引擎核心完善 — 支持 runFullTask
 */

import { Coordinator as Orchestrator } from './engine/coordinator/Coordinator.js';
import type { OrchestratorConfig } from '@dawn/core';
import { getLogger } from '@dawn/core';
const logger = getLogger('Main');

function checkApiKey(): void {
  const key = (typeof Bun !== 'undefined' ? Bun.env.DEEPSEEK_API_KEY : '') || process.env.DEEPSEEK_API_KEY || '';
  if (!key) {
    logger.error('DEEPSEEK_API_KEY 未设置！请在 .env 文件中配置');
    process.exit(1);
  }
}

/**
 * 完整任务执行函数
 * 接收用户输入，经 Orchestrator 编排后返回响应
 */
export async function runFullTask(task: string, code?: string, memoryBasePath?: string): Promise<string> {
  const orchestrator = new Orchestrator({ memoryBasePath } as OrchestratorConfig);
  const result = await orchestrator.execute(task, code);
  const stats = orchestrator.getStats();

  // 附加执行统计信息
  const memoryNote = memoryBasePath ? '\n[记忆系统] 已启用' : '\n[记忆系统] 未启用';
  const elapsed = 0;
  const meta = elapsed
    ? `\n\n[执行统计] 耗时 ${elapsed}ms | 总任务 ${stats.total} | 成功率 ${stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 100}%${memoryNote}`
    : '';

  return result.response + meta;
}

// ── REPL 模式 ──
async function replMode() {
  const orchestrator = new Orchestrator({} as OrchestratorConfig);
  const readline = (await import('readline')).default.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Dawn> ',
  });

  logger.info('Dawn REPL v1.0 — 引擎核心完善');
  logger.info('输入任务或 "exit" 退出，输入 "stats" 查看统计');
  readline.prompt();

  for await (const line of readline) {
    const input = line.trim();
    if (!input) { readline.prompt(); continue; }
    if (input === 'exit') break;
    if (input === 'stats') {
      const s = orchestrator.getStats();
      logger.info(`[统计] 总任务 ${s.total} | 成功 ${s.success} | 失败 ${s.failed} | 平均耗时 ${s.avgDurationMs}ms`);
      readline.prompt();
      continue;
    }
    if (input === 'evolve') {
      const suggestions = await orchestrator.runEvolution();
      logger.info(`进化完成，生成 ${suggestions.length} 条改进建议`);
      for (const s of suggestions.slice(0, 5)) {
        logger.info(`  [${s.priority}] ${s.description}`);
      }
      readline.prompt();
      continue;
    }
    if (input === 'evolve-stats') {
      const es = orchestrator.getEvolutionStats();
      logger.info(`进化引擎: 次数=${es.evolutionCount} 建议=${es.suggestionsCount} 高优=${es.highPriorityCount}`);
      readline.prompt();
      continue;
    }

    const start = Date.now();
    try {
      const result = await orchestrator.execute(input);
      const elapsed = Date.now() - start;
      logger.info(`\n${result.response}`);
      logger.info(`[完成] ${elapsed}ms`);
    } catch (e: any) {
      logger.error('任务执行错误: ' + (e.message || String(e)));
    }
    readline.prompt();
  }

  readline.close();
}

// ── 直接执行 ──
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--repl') || args.length === 0) {
    await replMode();
    return;
  }

  // 单次任务模式
  const task = args.join(' ');
  const result = await runFullTask(task);
  logger.info(String(result));
  process.exit(0);
}

main().catch((err) => logger.error('main 异常: ' + String(err)));
