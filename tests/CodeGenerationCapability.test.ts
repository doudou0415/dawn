import { describe, it, expect, beforeEach, vi } from 'vitest';

// 在 import 被测试模块前 mock LLM 调用
vi.mock('../Dawn/src/engine/core/LLMProvider.js', () => ({
  callDeepSeek: vi.fn().mockResolvedValue('```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```'),
  SYSTEM_PROMPT: 'You are a code generation assistant.',
}));

import { CodeGenerationCapability } from '../Dawn/src/capabilities/atomic/codegen/CodeGenerationCapability.js';
import { callDeepSeek } from '../Dawn/src/engine/core/LLMProvider.js';
import type { AtomicInput } from '../Dawn/src/capabilities/registry/types.js';

describe('CodeGenerationCapability — 代码生成能力', () => {
  let capability: CodeGenerationCapability;

  beforeEach(() => {
    capability = new CodeGenerationCapability();
    vi.clearAllMocks();
  });

  it('应使用默认配置创建实例', () => {
    expect(capability).toBeInstanceOf(CodeGenerationCapability);
    expect(capability.name).toBe('code_generation');
    expect(capability.description).toBe('代码生成、修改和优化');
    expect(capability.intentTypes.length).toBeGreaterThan(0);
  });

  it('execute 应成功生成代码并返回结果', async () => {
    const input: AtomicInput = {
      intentType: 'code_generation' as any,
      params: { rawInput: '写一个 TypeScript 加法函数' },
      context: { sessionId: 'test' },
    };

    const result = await capability.execute(input);

    expect(result.success).toBe(true);
    expect(result.output).toContain('function add');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.language).toBe('typescript');
    expect(result.metadata!.hasCodeBlock).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('execute 应包含代码审查结果', async () => {
    const input: AtomicInput = {
      intentType: 'code_generation' as any,
      params: { rawInput: '写一个 TypeScript 加法函数' },
      context: { sessionId: 'test' },
    };

    const result = await capability.execute(input);

    expect(result.metadata).toBeDefined();
    expect(result.metadata).toHaveProperty('reviewScore');
    expect(result.metadata).toHaveProperty('reviewIssues');
  });

  it('execute 应在 LLM 不可用时返回失败', async () => {
    callDeepSeek.mockResolvedValueOnce(null);

    const input: AtomicInput = {
      intentType: 'code_generation' as any,
      params: { rawInput: '写一个函数' },
      context: { sessionId: 'test' },
    };

    const result = await capability.execute(input);

    expect(result.success).toBe(false);
    expect(result.output).toContain('不可用');
  });

  it('execute 应处理包含已有代码的修改请求', async () => {
    const input: AtomicInput = {
      intentType: 'code_modification' as any,
      params: {
        rawInput: '给这个函数加错误处理',
        code: 'function divide(a: number, b: number): number { return a / b; }',
      },
      context: { sessionId: 'test' },
    };

    const result = await capability.execute(input);

    expect(result.success).toBe(true);
    expect(callDeepSeek).toHaveBeenCalledOnce();
    // mock 应该被调用来验证传入的 messages 包含代码
    const calledWith = callDeepSeek.mock.calls[0]![0] as any[];
    const lastMsg = calledWith[calledWith.length - 1]!;
    expect(lastMsg.content).toContain('divide');
  });

  it('应正确检测编程语言', async () => {
    const input: AtomicInput = {
      intentType: 'code_generation' as any,
      params: { rawInput: '写一个 Python 快速排序' },
      context: { sessionId: 'test' },
    };

    const result = await capability.execute(input);

    expect(result.metadata!.language).toBe('python');
  });
});
