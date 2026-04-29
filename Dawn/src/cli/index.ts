#!/usr/bin/env bun
/**
 * Dawn CLI 入口
 * 命令行交互主循环
 */

// 手动加载 .env（在 import 之前执行，确保所有模块都能读到环境变量）
import { readFileSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && !process.env[key]) {
      process.env[key] = valueParts.join('=');
    }
  });
} catch { /* .env 不存在时静默跳过 */ }

import { Coordinator as Orchestrator } from '../engine/coordinator/Coordinator.js';
import { ToolRegistry, ReadTool, WriteTool, BashTool, SearchTool } from '../tools';
import { createInterface } from 'node:readline/promises';
import { setupGlobalErrorHandling } from '../utils/index.js';
import { getLogger } from '@dawn/core';
const logger = getLogger('CLI');

const VERSION = '1.0.0';

function printBanner(): void {
  console.log(`\n╔══════════════════════════════════╗\n║          Dawn v${VERSION}            ║\n║     Local AI Coding Assistant    ║\n╚══════════════════════════════════╝\n`);
}

function printHelp(): void {
  console.log(`\n可用命令:\n  /help         - 显示帮助\n  /version      - 显示版本\n  /stats        - 执行统计\n  /evolve       - 手动触发一次进化\n  /evolve-stats - 进化引擎统计\n  /evolve-on    - 开启自动进化\n  /evolve-off   - 关闭自动进化\n  /clear        - 清屏\n  /exit, /quit  - 退出\n\n直接输入任意内容开始对话。\n`);
}

function checkApiKey(): void {
  const key = (typeof Bun !== 'undefined' ? Bun.env.DEEPSEEK_API_KEY : '') || process.env.DEEPSEEK_API_KEY || '';
  if (!key) {
    logger.error('DEEPSEEK_API_KEY 未设置！请在 .env 文件中配置');
    process.exit(1);
  }
  logger.info('API Key 已配置');
}

async function main(): Promise<void> {
  printBanner();
  setupGlobalErrorHandling();
  checkApiKey();

  // 初始化核心
  const orchestrator = new Orchestrator();
  const toolRegistry = new ToolRegistry();

  // 注册工具
  toolRegistry.register(ReadTool);
  toolRegistry.register(WriteTool);
  toolRegistry.register(BashTool);
  toolRegistry.register(SearchTool);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'dawn> ',
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // 内置命令
    if (input.startsWith('/')) {
      const cmd = input.toLowerCase();
      const parts = input.slice(1).split(' ');
      const cmdName = (parts[0] ?? '').toLowerCase();

      // /tools 命令：列出所有已注册工具
      if (cmd === '/tools') {
        logger.info('可用工具：');
        const allTools = toolRegistry.getAll();
        if (allTools.length === 0) {
          logger.info('(无已注册工具)');
        } else {
          for (const t of allTools) {
            logger.info(`  /${t.name.padEnd(12)} ${t.description}`);
          }
        }
        rl.prompt();
        continue;
      }

      // /tool_name args...：直接执行工具
      const tool = toolRegistry.get(cmdName);
      if (tool) {
        const toolArgs = parts.slice(1).join(' ');
        logger.info(`[工具] 执行 ${tool.name}...`);
        try {
          const result = await toolRegistry.execute(cmdName, { command: toolArgs || '' });
          logger.info('执行结果：' + JSON.stringify(result, null, 2));
        } catch (err) {
          logger.error('工具执行失败: ' + String(err));
        }
        rl.prompt();
        continue;
      }

      // 内置命令
      switch (cmd) {
        case '/help':
          printHelp();
          break;
        case '/version':
          logger.info(`Dawn v${VERSION}`);
          break;
        case '/memory':
          logger.info('(内存功能通过 Orchestrator 集成，暂未暴露直接查询)');
          break;
        case '/stats': {
          const stats = orchestrator.getStats();
          logger.info(`执行统计: 共 ${stats.total} 次, 成功 ${stats.success}, 失败 ${stats.failed}, 平均 ${stats.avgDurationMs}ms`);
          break;
        }
        case '/evolve': {
          const suggestions = await orchestrator.runEvolution();
          logger.info(`进化完成，生成 ${suggestions.length} 条改进建议`);
          for (const s of suggestions.slice(0, 5)) {
            logger.info(`  [${s.priority}] ${s.description}`);
          }
          break;
        }
        case '/evolve-on': {
          orchestrator.setAutoEvolution(true);
          logger.info('自动进化已开启');
          break;
        }
        case '/evolve-off': {
          orchestrator.setAutoEvolution(false);
          logger.info('自动进化已关闭');
          break;
        }
        case '/evolve-stats': {
          const es = orchestrator.getEvolutionStats();
          const config = es.config as { autoEvolve?: boolean } | null;
          logger.info(`进化引擎统计:`);
          logger.info(`  进化次数: ${es.evolutionCount}`);
          logger.info(`  建议总数: ${es.suggestionsCount}`);
          logger.info(`  高优先级: ${es.highPriorityCount}`);
          logger.info(`  自动进化: ${config?.autoEvolve ? '开启' : '关闭'}`);
          break;
        }
        case '/clear':
          console.clear();
          printBanner();
          break;
        case '/exit':
        case '/quit':
          logger.info('再见！');
          process.exit(0);
        default:
          logger.warn(`未知命令: ${input}，输入 /help 查看内置命令，/tools 查看工具`);
      }
      rl.prompt();
      continue;
    }

    // 正常对话处理 — 走 Orchestrator.execute()
    logger.info(`[处理中...] ${input.slice(0, 60)}`);
    const result = await orchestrator.execute(input);
    const elapsed = 0;
    const resultCategory = 'general';

    logger.info(`[完成] (${elapsed}ms) 意图: ${resultCategory}`);
    console.log(`\n${result.response}\n`);
    rl.prompt();
  }
}

main().catch((err) => logger.error('CLI 异常: ' + String(err)));
