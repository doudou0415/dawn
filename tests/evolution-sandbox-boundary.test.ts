import { describe, it, expect } from 'vitest';
import {
  EvolutionSandbox,
  CodeMutator,
  PerformanceEvaluator,
} from '../Dawn/src/evolution/index.js';

describe('EvolutionSandbox — 边界情况', () => {
  const sandbox = new EvolutionSandbox();

  it('空路径应触发拒绝或重定向（不抛异常）', () => {
    const result = sandbox.validate('write', '');
    expect(result).toBeDefined();
    expect(typeof result.allowed).toBe('boolean');
  });

  it('相对路径 .. 应触发重定向或拒绝（不抛异常）', () => {
    const result = sandbox.validate('write', '../outside/secret.txt');
    expect(result).toBeDefined();
    expect(typeof result.allowed).toBe('boolean');
  });

  it('深层嵌套安全路径应允许', () => {
    const result = sandbox.validate('write', 'src/evolution/experiments/deep/nested/test.ts');
    expect(result.allowed).toBe(true);
  });

  it('同时匹配 protected 和 safe 应保守拒绝', () => {
    // protected 优先
    const result = sandbox.validate('write', 'src/engine/evolution/test.ts');
    expect(result.allowed).toBe(false);
  });

  it('getConfig 返回的副本修改不影响原始配置', () => {
    const config1 = sandbox.getConfig();
    const config2 = sandbox.getConfig();
    // getConfig 每次返回新对象
    expect(config1).not.toBe(config2);
    // 修改 config1 不改变 config2
    const origLen = config2.protectedPaths.length;
    (config1 as any).protectedPaths = [];
    expect(config2.protectedPaths.length).toBe(origLen);
  });

  it('isSafe 对不在安全列表中的路径返回 false', () => {
    expect(sandbox.isSafe('/etc/passwd')).toBe(false);
    expect(sandbox.isSafe('C:\\Windows\\System32')).toBe(false);
  });

  it('isProtected 对根级别目录返回 false', () => {
    expect(sandbox.isProtected('test.ts')).toBe(false);
    expect(sandbox.isProtected('README.md')).toBe(false);
  });
});

describe('CodeMutator — 边界情况', () => {
  const mutator = new CodeMutator();

  it('空代码应返回有效结果', () => {
    const result = mutator.pointMutation({
      sourceCode: '',
      filePath: 'empty.ts',
      language: 'typescript',
    });
    expect(result.description).toBeDefined();
    expect(typeof result.mutatedCode).toBe('string');
  });

  it('极短代码不应抛异常', () => {
    const result = mutator.pointMutation({
      sourceCode: 'const a = 1;',
      filePath: 'tiny.ts',
      language: 'typescript',
    });
    expect(result).toBeDefined();
  });

  it('纯注释代码也应产生有效结果', () => {
    const result = mutator.pointMutation({
      sourceCode: '// 这是一行注释\n/* 多行\n注释 */',
      filePath: 'comments.ts',
      language: 'typescript',
    });
    expect(result.description).toBeDefined();
  });
});

describe('PerformanceEvaluator — 边界情况', () => {
  const evaluator = new PerformanceEvaluator();

  it('零时长执行不除零错误', () => {
    const result = evaluator.evaluate({
      taskId: 'zero-duration',
      taskDescription: '零时长',
      success: true,
      executionDurationMs: 0,
      toolsUsed: [],
      stepsTaken: [],
      createdAt: new Date().toISOString(),
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('大量工具使用不应导致分数溢出', () => {
    const manyTools = Array.from({ length: 50 }, (_, i) => `tool_${i}`);
    const result = evaluator.evaluate({
      taskId: 'many-tools',
      taskDescription: '大量工具',
      success: true,
      executionDurationMs: 10000,
      toolsUsed: manyTools,
      stepsTaken: ['start', 'end'],
      createdAt: new Date().toISOString(),
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('极长执行时间应得低分但不为负', () => {
    const result = evaluator.evaluate({
      taskId: 'long-task',
      taskDescription: '超长任务',
      success: true,
      executionDurationMs: 3600000, // 1小时
      toolsUsed: ['t1'],
      stepsTaken: ['s1'],
      createdAt: new Date().toISOString(),
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('空工具/步骤不抛异常', () => {
    const result = evaluator.evaluate({
      taskId: 'empty',
      taskDescription: '',
      success: true,
      executionDurationMs: 100,
      toolsUsed: [],
      stepsTaken: [],
      createdAt: new Date().toISOString(),
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });
});
