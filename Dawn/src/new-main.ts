#!/usr/bin/env node
/**
 * DawnNew - 临时 CLI 入口 (REPL)
 *
 * 阶段 0-1: 基础入口，能加载引擎并执行简单任务
 */

import { Agent } from "./engine/AgentCore";
import { Orchestrator } from "./engine/Orchestrator";
import { IntentEngine } from "./engine/IntentEngine";
import { SelfEvolutionEngine } from "./evolution/SelfEvolutionEngine";
import * as readline from "node:readline";

async function main() {
  const agent = new Agent({ /* TODO: 加载配置 */ });
  const orchestrator = new Orchestrator(agent);
  const intentEngine = new IntentEngine();
  const evolution = new SelfEvolutionEngine(/* memory */);

  console.log("DawnNew REPL v0.1 — 输入任务或输入 /quit 退出");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  let running = true;
  while (running) {
    const input = await ask("> ");
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === "/quit") { running = false; break; }

    try {
      const intent = await intentEngine.analyze(trimmed);
      console.log(`[意图] ${intent.action}`);
      const result = await orchestrator.runFullTask(trimmed);
      console.log(`[结果]`, JSON.stringify(result, null, 2).slice(0, 500));
    } catch (err: any) {
      console.error(`[错误] ${err.message || err}`);
    }
  }

  rl.close();
  console.log("再见。");
}

main().catch(console.error);
