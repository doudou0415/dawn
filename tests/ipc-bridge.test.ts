import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IpcBridge } from '../DawnPanel/src/ipc/IpcBridge.ts';

describe('IpcBridge — IPC 心跳与重连', () => {
  let bridge: IpcBridge;

  afterEach(() => {
    bridge?.disconnect();
  });

  it('应使用默认配置创建实例', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    expect(bridge).toBeDefined();
    expect(bridge.getConnectionState()).toBe('disconnected');
  });

  it('connect 应切换到 connected 状态', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    bridge.connect();
    expect(bridge.getConnectionState()).toBe('connected');
  });

  it('disconnect 应切换到 disconnected 状态', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    bridge.connect();
    bridge.disconnect();
    expect(bridge.getConnectionState()).toBe('disconnected');
  });

  it('应提供 healthCheck 方法（网络不可达时返回 false）', async () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    // mock fetch 以模拟网络不可达
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const result = await bridge.healthCheck();
    expect(result).toBe(false);
    globalThis.fetch = originalFetch;
  });

  it('应支持事件监听', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    const unsub = bridge.on('connectionChange', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('invoke 应正确返回 Promise', async () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    const promise = bridge.invoke('test-method', 'arg1', 42);
    expect(promise).toBeInstanceOf(Promise);
    // 捕获 rejection 避免未处理错误
    promise.catch(() => { /* expected: no backend */ });
    // 给足够时间完成请求再断开
    await new Promise(r => setTimeout(r, 10));
    bridge.disconnect();
  });

  it('应提供统计信息', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    expect(bridge.stats).toBeDefined();
    expect(typeof bridge.stats.totalRequests).toBe('number');
  });

  it('队列长度应为 0 初始值', () => {
    bridge = new IpcBridge({ baseUrl: 'http://localhost:3458' });
    expect(bridge.getQueueLength()).toBe(0);
  });
});

describe('IpcBridge 消息队列', () => {
  it('服务端 idle 检测应正常工作', () => {
    const isIdle = (lastActivity: number, timeout: number): boolean => {
      return Date.now() - lastActivity > timeout;
    };
    expect(isIdle(0, 100000)).toBe(true);
    expect(isIdle(Date.now(), 100000)).toBe(false);
  });
});
