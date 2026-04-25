/**
 * Dawn 核心引擎测试
 */

import { IntentEngine } from '../Dawn/src/engine/IntentEngine';
import { Orchestrator } from '../Dawn/src/engine/Orchestrator';
import { EvolutionEngine } from '../Dawn/src/evolution/EvolutionEngine';
import { ChatCapability } from '../Dawn/src/capabilities/ChatCapability';

// IntentEngine 测试
const intentEngine = new IntentEngine();

const chatResult = await intentEngine.analyze('你好');
console.assert(chatResult.type === 'chat', `Expected chat, got ${chatResult.type}`);
console.log('[PASS] IntentEngine: 问候意图识别');

const fileResult = await intentEngine.analyze('读取 src/index.ts');
console.assert(fileResult.type === 'file_operation', `Expected file_operation, got ${fileResult.type}`);
console.log('[PASS] IntentEngine: 文件操作意图识别');

const searchResult = await intentEngine.analyze('搜索 TODO 关键词');
console.assert(searchResult.type === 'web_search', `Expected web_search, got ${searchResult.type}`);
console.log('[PASS] IntentEngine: 搜索意图识别');

// Orchestrator 测试
const orchestrator = new Orchestrator({ debugMode: false });
orchestrator.capabilityRegistry_.register(new ChatCapability());

const result = await orchestrator.process('你好');
console.assert(result.intent.type === 'chat', `Orchestrator expected chat, got ${result.intent.type}`);
console.assert(result.result !== undefined, 'Orchestrator should produce a result');
console.log('[PASS] Orchestrator: 完整处理流程');

// EvolutionEngine 测试
const evolution = new EvolutionEngine({ minObservations: 3, analysisIntervalMs: 0 });

for (let i = 0; i < 5; i++) {
  await evolution.observe({
    intent: { type: 'chat', confidence: 0.9, rawInput: 'hello', params: {} },
    startTime: Date.now(),
    endTime: Date.now(),
    iterations: 1,
    result: { success: true },
  } as never);
}

const stats = await evolution.getStats();
console.assert(stats.totalObservations === 5, `Expected 5 observations, got ${stats.totalObservations}`);
console.log('[PASS] EvolutionEngine: 观察与统计');

console.log('\n所有测试通过！');
