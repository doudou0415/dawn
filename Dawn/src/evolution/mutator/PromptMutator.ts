/**
 * PromptMutator — 提示词变异器
 *
 * 变异策略：
 * - 措辞变异（同义词替换）
 * - 结构变异（调整指令顺序/格式）
 * - 粒度变异（调整详细程度）
 */

export interface PromptMutationInput {
  prompt: string;
  category: 'system' | 'user' | 'tool';
}

export interface PromptMutationResult {
  type: 'wording' | 'structure' | 'granularity';
  mutatedPrompt: string;
  description: string;
  changedTokens: number;
}

export class PromptMutator {
  /**
   * 措辞变异 — 替换同义表达
   */
  wordingMutation(input: PromptMutationInput): PromptMutationResult {
    let prompt = input.prompt;
    const changes: string[] = [];

    const synonymMap: [RegExp, string][] = [
      [/\bplease\b/gi, ''],
      [/\byou should\b/gi, 'you need to'],
      [/\byou must\b/gi, 'it is required that you'],
      [/\buse\b/gi, 'utilize'],
      [/\bget\b/gi, 'retrieve'],
      [/\bshow\b/gi, 'display'],
      [/\bmake sure\b/gi, 'ensure'],
      [/\bhelpful\b/gi, 'useful'],
      [/\bdon't\b/gi, 'do not'],
      [/\bcan't\b/gi, 'cannot'],
      [/\bvery\b/gi, 'highly'],
    ];

    for (const [pattern, replacement] of synonymMap) {
      if (pattern.test(prompt) && this.shouldMutate(0.3)) {
        const before = prompt.match(pattern)?.[0] || '';
        prompt = prompt.replace(pattern, replacement);
        if (before) {
          changes.push(`${before} → ${replacement || '(removed)'}`);
        }
      }
    }

    return {
      type: 'wording',
      mutatedPrompt: prompt,
      description: changes.length > 0
        ? `措辞变异: ${changes.join('; ')}`
        : '无措辞变化',
      changedTokens: changes.length,
    };
  }

  /**
   * 结构变异 — 调整内容顺序
   */
  structureMutation(input: PromptMutationInput): PromptMutationResult {
    const sections = input.prompt.split(/\n\n+/);
    if (sections.length < 2) {
      return {
        type: 'structure',
        mutatedPrompt: input.prompt,
        description: '提示词过短，无法结构变异',
        changedTokens: 0,
      };
    }

    const changes: string[] = [];
    let mutated = [...sections];
    const reorderProb = 0.3;

    // 尝试将末尾的"约束"段提前
    const constraintIndex = mutated.findIndex(s =>
      /(constraint|limit|restriction|rule|rule:|important:|note:)/i.test(s)
    );
    if (constraintIndex > 0 && this.shouldMutate(reorderProb)) {
      const removed = mutated.splice(constraintIndex, 1);
      if (removed[0]) {
        mutated.splice(1, 0, removed[0]);
        changes.push('将约束段提前到开头后');
      }
    }

    // 尝试将定义/描述段后移
    const descIndex = mutated.findIndex(s =>
      /^(you are|your role|you're|as an? )/i.test(s.trim())
    );
    if (descIndex >= 0 && descIndex < mutated.length - 1 && this.shouldMutate(reorderProb)) {
      const removed = mutated.splice(descIndex, 1);
      if (removed[0]) {
        mutated.push(removed[0]);
        changes.push('将角色描述段后移至末尾');
      }
    }

    return {
      type: 'structure',
      mutatedPrompt: mutated.join('\n\n'),
      description: changes.length > 0
        ? `结构变异: ${changes.join('; ')}`
        : '结构未调整',
      changedTokens: changes.length,
    };
  }

  /**
   * 粒度变异 — 增加或减少详细程度
   */
  granularityMutation(input: PromptMutationInput): PromptMutationResult {
    let prompt = input.prompt;
    const changes: string[] = [];

    if (this.shouldMutate(0.4)) {
      // 增加具体性：在祈使句前加步骤前缀
      prompt = prompt.replace(/^([A-Z][^.!?]*(?:\.|!))$/gm, (match) => {
        if (match.length > 20 && this.shouldMutate(0.5)) {
          changes.push('增加步骤编号');
          return `Step: ${match}`;
        }
        return match;
      });
    }

    if (this.shouldMutate(0.3)) {
      // 压缩冗余引导语
      prompt = prompt.replace(/(你(的|是|可以|需要)[^。\n]*。)/g, (match) => {
        if (this.shouldMutate(0.5)) {
          changes.push('压缩引导语');
          return `/* compressed: ${match.substring(0, 15)}... */`;
        }
        return match;
      });
    }

    return {
      type: 'granularity',
      mutatedPrompt: prompt,
      description: changes.length > 0
        ? `粒度变异: ${changes.join('; ')}`
        : '粒度未调整',
      changedTokens: changes.length,
    };
  }

  private shouldMutate(probability: number): boolean {
    return Math.random() < probability;
  }
}
