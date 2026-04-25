#!/usr/bin/env bun
/**
 * Dawn CLI 入口
 * 命令行交互主循环
 */

import { Orchestrator } from '../engine/Orchestrator';
import { EvolutionEngine } from '../evolution/EvolutionEngine';
import { ToolRegistry, ReadTool, WriteTool, BashTool, SearchTool } from '../tools';
import { ChatCapability } from '../capabilities/ChatCapability';
import { FileOpsCapability } from '../capabilities/FileOpsCapability';
import { createInterface } from 'node:readline/promises';

const VERSION = '1.0.0';

function printBanner(): void {
  console.log(`
╔══════════════════════════════════╗
║          Dawn v${VERSION}            ║
║     Local AI Coding Assistant    ║
╚══════════════════════════════════╝
`);
}

function printHelp(): void {
  console.log(`
可用命令:
  /help         - 显示帮助
  /version      - 显示版本
  /memory       - 查看会话记忆
  /stats        - 查看进化引擎统计
  /clear        - 清屏
  /exit, /quit  - 退出

直接输入任意内容开始对话。
`);
}

async function main(): Promise<void> {
  printBanner();

  // 初始化核心
  const orchestrator = new Orchestrator({ debugMode: false });
  const evolution = new EvolutionEngine();
  const toolRegistry = new ToolRegistry();

  // 注册能力
  orchestrator.capabilityRegistry_.register(new ChatCapability());
  orchestrator.capabilityRegistry_.register(new FileOpsCapability());

  // 注册工具
  toolRegistry.register(ReadTool);
  toolRegistry.register(WriteTool);
  toolRegistry.register(BashTool);
  toolRegistry.register(SearchTool);

  // 连接进化引擎
  orchestrator.setEvolutionEngine(evolution);

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
      switch (input.toLowerCase()) {
        case '/help':
          printHelp();
          break;
        case '/version':
          console.log(`Dawn v${VERSION}`);
          break;
        case '/memory':
          console.log('会话记忆:', await orchestrator.memorySystem_.query('', 'chat' as never));
          break;
        case '/stats':
          console.log('进化统计:', await evolution.getStats());
          break;
        case '/clear':
          console.clear();
          printBanner();
          break;
        case '/exit':
        case '/quit':
          console.log('再见！');
          process.exit(0);
        default:
          console.log(`未知命令: ${input}`);
      }
      rl.prompt();
      continue;
    }

    // 正常对话处理
    console.log(`\n[处理中...] 分析意图...`);
    const result = await orchestrator.process(input);
    const elapsed = ((result.endTime ?? Date.now()) - result.startTime).toFixed(0);

    console.log(`\n[完成] (${elapsed}ms, ${result.iterations} 次迭代)`);
    console.log(`  意图: ${result.intent.type} (置信度: ${(result.intent.confidence * 100).toFixed(0)}%)`);

    const data = result.result as Record<string, unknown>;
    if (data?.error) {
      console.log(`  错误: ${data.error}`);
    } else if (data?.message) {
      console.log(`  ${data.message}`);
    } else if (data?.content) {
      console.log(`  内容: ${(data.content as string).slice(0, 200)}...`);
    } else {
      console.log(`  结果:`, data);
    }

    console.log('');
    rl.prompt();
  }
}

main().catch(console.error);
