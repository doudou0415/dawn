/**
 * CodeGenerationCapability — 代码生成/修改能力
 *
 * 接管所有代码生成、代码修改、代码优化场景。
 * 核心逻辑委托给 LLMProvider（callDeepSeek），不包含任何硬编码的代码模板。
 *
 * 与 ExecutionLoop 中 LLM 调用的区别：
 * - ExecutionLoop 面向"通用对话 + 工具调用"，由 Coordinator 决定是否路由到这里
 * - CodeGenerationCapability 只关注"生成代码并做基本审查"
 * - 生成结果附带代码审查（复用 SmartCodeReviewer）
 *
 * P0.5 重构：从 ExecutionLoop 的硬编码分支中提取代码生成逻辑到此能力。
 */

import type { AtomicCapability, AtomicInput, CapabilityResult } from '../../registry/types.js';
import type { TaskCategory } from '@dawn/core';
import { callDeepSeek, SYSTEM_PROMPT } from '../../../engine/core/LLMProvider.js';
import { SmartCodeReviewer } from '../../../engine/core/CodeOptimizer.js';

export class CodeGenerationCapability implements AtomicCapability {
  readonly name = 'code_generation';
  readonly description = '代码生成、修改和优化';
  readonly intentTypes: TaskCategory[] = ['code_generation' as TaskCategory, 'code_modification' as TaskCategory, 'refactoring' as TaskCategory];
  readonly permissions: string[] = [];

  async execute(input: AtomicInput): Promise<CapabilityResult> {
    const rawInput = typeof input.params?.rawInput === 'string' ? input.params.rawInput : '';
    const code = typeof input.params?.code === 'string' ? input.params.code : undefined;

    // 构建代码生成专用的 prompt
    const language = this.detectLanguage(rawInput);
    const systemPrompt = `${SYSTEM_PROMPT}\n\n你正在执行代码生成任务。请只返回代码（含必要的 import 和类型定义），不要添加额外解释，除非用户要求。`;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (code) {
      messages.push({
        role: 'user',
        content: `当前代码：\n\`\`\`${language}\n${code}\n\`\`\`\n\n任务：${rawInput}`,
      });
    } else {
      messages.push({ role: 'user', content: rawInput });
    }

    const startTime = Date.now();
    const llmResponse = await callDeepSeek(messages);

    if (!llmResponse) {
      return {
        success: false,
        output: 'LLM 不可用，无法生成代码',
      };
    }

    const duration = Date.now() - startTime;

    // 从回复中提取代码块
    const codeBlock = this.extractCodeBlock(llmResponse);
    const reviewResult = codeBlock ? SmartCodeReviewer.review(codeBlock) : undefined;

    return {
      success: true,
      output: llmResponse,
      metadata: {
        language,
        hasCodeBlock: !!codeBlock,
        generatedLength: llmResponse.length,
        reviewScore: reviewResult?.score,
        reviewIssues: reviewResult?.issues?.filter(i => i.severity === 'warning').length ?? 0,
      },
      durationMs: duration,
    };
  }

  private detectLanguage(input: string): string {
    const langMap: Record<string, string> = {
      typescript: 'typescript',
      ts: 'typescript',
      javascript: 'javascript',
      js: 'javascript',
      python: 'python',
      py: 'python',
      go: 'go',
      rust: 'rust',
      rs: 'rust',
      java: 'java',
      cpp: 'cpp',
      'c++': 'cpp',
      'c#': 'csharp',
      html: 'html',
      css: 'css',
      sql: 'sql',
      bash: 'bash',
      shell: 'bash',
      yaml: 'yaml',
      json: 'json',
      markdown: 'markdown',
      md: 'markdown',
    };

    const lower = input.toLowerCase();
    for (const [key, lang] of Object.entries(langMap)) {
      if (lower.includes(key)) return lang;
    }

    return 'typescript'; // 默认 TypeScript
  }

  private extractCodeBlock(text: string): string | null {
    const match = text.match(/```[\w]*\n([\s\S]*?)```/);
    return match ? match[1]!.trim() : null;
  }
}
