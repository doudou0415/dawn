import { describe, it, expect } from 'vitest';
import { Agent } from '../Dawn/src/engine/index.js';

describe('Agent (Engine 核心)', () => {
  it('应使用默认配置创建 Agent 实例', () => {
    const agent = new Agent();
    expect(agent).toBeInstanceOf(Agent);
  });

  it('execute 应返回包含响应文本的 AgentResult', async () => {
    const agent = new Agent({ enableMemory: false });
    const result = await agent.execute('hello');
    expect(result).toHaveProperty('response');
    expect(typeof result.response).toBe('string');
  });

  it('应正确管理工具调用历史', () => {
    const agent = new Agent();
    expect(agent.getToolCallHistory()).toEqual([]);
    agent.clearToolCallHistory();
    expect(agent.getToolCallHistory()).toEqual([]);
  });

  it('应能重置工具性能统计', () => {
    const agent = new Agent();
    agent.resetToolPerformance();
    expect(agent.getToolPerformance()).toEqual([]);
  });

  it('应返回已使用的工具列表', () => {
    const agent = new Agent();
    expect(agent.getToolsUsed()).toEqual([]);
  });

  it('情绪检测应正确识别简单文本', () => {
    const agent = new Agent();
    const result = agent.detectEmotion('hello world');
    expect(result).toBeDefined();
    expect(typeof result.emotion).toBe('string');
    expect(typeof result.confidence).toBe('number');
  });

  it('应能管理实体记忆', () => {
    const agent = new Agent();
    agent.setMemoryEntity('username', 'dawn');
    expect(agent.getMemoryEntity('username')).toBe('dawn');
    expect(agent.getAllMemoryEntities().get('username')).toBe('dawn');
    agent.clearMemoryEntity('username');
    expect(agent.getMemoryEntity('username')).toBeUndefined();
  });

  it('应管理对话历史', () => {
    const agent = new Agent();
    expect(agent.getConversationHistory()).toEqual([]);
    expect(agent.getLastNMessages(5)).toEqual([]);
    agent.clearConversationHistory();
    expect(agent.getConversationHistory()).toEqual([]);
  });

  it('应返回对话状态信息', () => {
    const agent = new Agent();
    const state = agent.getCurrentDialogueState();
    expect(state).toBeDefined();
    expect(state.id).toBeDefined();
    expect(agent.getDialogueHistory().length).toBeGreaterThanOrEqual(1);
  });
});
