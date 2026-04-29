import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock LLM 调用 ──
vi.mock('../src/engine/core/LLMProvider.js', () => ({
  callDeepSeek: vi.fn(),
  SYSTEM_PROMPT: 'You are Dawn. Focus on code generation.',
}));

import { CodeGenerationCapability } from '../src/capabilities/atomic/codegen/CodeGenerationCapability.js';
import { callDeepSeek } from '../src/engine/core/LLMProvider.js';
import type { AtomicInput } from '../src/capabilities/registry/types.js';

const mockCallDeepSeek = callDeepSeek as unknown as ReturnType<typeof vi.fn>;

describe('CodeGenerationCapability', () => {
  let capability: CodeGenerationCapability;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = new CodeGenerationCapability();
  });

  describe('基础属性', () => {
    it('应该有正确的名称和描述', () => {
      expect(capability.name).toBe('code_generation');
      expect(capability.description).toBeTruthy();
      expect(capability.intentTypes.length).toBeGreaterThan(0);
    });
  });

  describe('execute() — 代码生成', () => {
    it('应该返回成功结果包含生成的代码', async () => {
      mockCallDeepSeek.mockResolvedValue('```typescript\nconst greet = (name: string) => `Hello, ${name}!`;\n```');

      const input: AtomicInput = {
        intentType: 'code_generation' as any,
        params: { rawInput: '写一个 greet 函数' },
        context: { sessionId: 'test', workingDirectory: '/tmp' },
      };

      const result = await capability.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      expect(result.metadata).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
    });

    it('生成的代码应该附带代码审查结果', async () => {
      mockCallDeepSeek.mockResolvedValue('```python\ndef hello():\n    print("hello")\n```');

      const input: AtomicInput = {
        intentType: 'code_generation' as any,
        params: { rawInput: '写一个 hello 函数' },
        context: { sessionId: 'test', workingDirectory: '/tmp' },
      };

      const result = await capability.execute(input);

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata).toHaveProperty('hasCodeBlock');
      expect(result.metadata).toHaveProperty('reviewScore');
      expect(result.metadata).toHaveProperty('reviewIssues');
    });

    it('LLM 失败时应该返回失败结果', async () => {
      mockCallDeepSeek.mockResolvedValue(null);

      const input: AtomicInput = {
        intentType: 'code_generation' as any,
        params: { rawInput: '生成代码' },
        context: { sessionId: 'test', workingDirectory: '/tmp' },
      };

      const result = await capability.execute(input);

      expect(result.success).toBe(false);
      expect(result.output).toContain('不可用');
    });

    it('应该支持带上下文代码的生成', async () => {
      mockCallDeepSeek.mockResolvedValue('```typescript\nconst result = input + 1;\n```');

      const input: AtomicInput = {
        intentType: 'code_generation' as any,
        params: { rawInput: '给这段代码加 1', code: 'let input = 5;' },
        context: { sessionId: 'test', workingDirectory: '/tmp' },
      };

      const result = await capability.execute(input);

      expect(result.success).toBe(true);
      expect(mockCallDeepSeek).toHaveBeenCalledOnce();
    });
  });

  describe('语言检测', () => {
    it('应该正确检测 TypeScript', () => {
      const lang = (capability as any).detectLanguage('写一个 typescript 函数');
      expect(lang).toBe('typescript');
    });

    it('应该正确检测 Python', () => {
      const lang = (capability as any).detectLanguage('写 python 代码');
      expect(lang).toBe('python');
    });

    it('默认应该返回 typescript', () => {
      const lang = (capability as any).detectLanguage('随便写点什么');
      expect(lang).toBe('typescript');
    });
  });

  describe('代码块提取', () => {
    it('应该从 markdown 中提取代码块', () => {
      const code = (capability as any).extractCodeBlock('```typescript\nconst x = 1;\n```');
      expect(code).toBe('const x = 1;');
    });

    it('没有代码块时应该返回 null', () => {
      const code = (capability as any).extractCodeBlock('这是一段纯文本回复');
      expect(code).toBeNull();
    });

    it('多代码块应该只提取第一个', () => {
      const code = (capability as any).extractCodeBlock(
        '```ts\nconst a = 1;\n```\n\n```py\nprint("hi")\n```',
      );
      expect(code).toContain('const a = 1');
      expect(code).not.toContain('print');
    });
  });
});
