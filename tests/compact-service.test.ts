import { describe, it, expect } from 'vitest';
import { CompactService } from '../Dawn/src/services/compact/CompactService.js';

describe('CompactService — 上下文压缩集成', () => {
  it('应使用默认配置创建实例', () => {
    const service = new CompactService();
    expect(service).toBeDefined();
  });

  it('shouldCompact 对短对话返回 false', () => {
    const service = new CompactService();
    const messages = [
      { role: 'user', content: '你好', timestamp: Date.now() },
    ];
    expect(service.shouldCompact(messages as any)).toBe(false);
  });

  it('compact 返回结果包含 wasCompacted 等字段', async () => {
    const service = new CompactService();
    const messages = [
      { role: 'user', content: '你好，帮我写一个函数' },
      { role: 'assistant', content: '当然，你要什么函数？' },
      { role: 'user', content: '一个排序算法' },
      { role: 'assistant', content: '好的，这是快速排序的实现...' },
    ];
    const result = await service.compact(messages as any);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('wasCompacted');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('entriesCompacted');
    expect(typeof result.entriesCompacted).toBe('number');
  });

  it('空消息列表 compact 不抛异常', async () => {
    const service = new CompactService();
    const result = await service.compact([]);
    expect(result.wasCompacted).toBe(false);
    expect(result.entriesCompacted).toBe(0);
  });

  it('少于 3 条消息不做压缩', async () => {
    const service = new CompactService();
    const messages = [{ role: 'user', content: '你好' }];
    const result = await service.compact(messages as any);
    expect(result.wasCompacted).toBe(false);
    expect(result.entriesCompacted).toBe(0);
  });

  it('getStatus 应返回状态信息', () => {
    const service = new CompactService();
    const messages = [
      { role: 'user', content: '你好', timestamp: Date.now() },
    ];
    const status = service.getStatus(messages as any);
    expect(status).toBeDefined();
    expect(status).toHaveProperty('estimatedTokens');
    expect(status).toHaveProperty('threshold');
    expect(status).toHaveProperty('shouldCompact');
    expect(typeof status.shouldCompact).toBe('boolean');
  });

  it('shortMessageConfig 应不触发压缩', () => {
    const service = new CompactService({ thresholdTokens: 1000000 }); // 超大阈值
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];
    const status = service.getStatus(messages as any);
    expect(status.shouldCompact).toBe(false);
  });
});
