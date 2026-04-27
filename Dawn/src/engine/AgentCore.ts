/**
 * AgentCore — 后向兼容壳
 * DawnPanel backend 动态 import('../../Dawn/src/engine/AgentCore.ts') 需要此文件存在。
 * 实际实现已拆解到 core/Agent.ts，这里只是 re-export。
 */
export { Agent as default } from './core/Agent.js';
export type { Agent } from './core/Agent.js';
