/**
 * CodeMutator — 代码变异器
 *
 * 变异类型：
 * - POINT: 微小变异（重命名变量、调整参数值、微调正则）
 * - STRUCTURAL: 结构性变异（重构函数、提取方法、合并模块）
 * - CROSSOVER: 交叉（合并两个实现的特性）
 */

export type MutationType = 'point' | 'structural' | 'crossover';

export interface CodeMutationInput {
  sourceCode: string;
  filePath: string;
  language: string;
}

export interface CodeMutationResult {
  type: MutationType;
  mutatedCode: string;
  description: string;
  changedLines: number;
}

export class CodeMutator {
  /**
   * 执行微小变异（重命名、参数调整、正则微调）
   */
  pointMutation(input: CodeMutationInput): CodeMutationResult {
    let code = input.sourceCode;
    const mutations: string[] = [];

    // 1. 重命名局部变量（识别 let/const/var 声明，改名为类似含义的备选）
    const varPattern = /\b(let|const|var)\s+(\w+)\s*=/g;
    code = code.replace(varPattern, (match, keyword, name) => {
      if (this.shouldMutate(0.3)) {
        const alternative = this.alternativeName(name);
        mutations.push(`重命名变量: ${name} → ${alternative}`);
        return `${keyword} ${alternative} =`;
      }
      return match;
    });

    // 2. 数值参数微调 (±10%)
    const numPattern = /\b(\d+)(\s*[*/+-]\s*\d+)*/g;
    code = code.replace(numPattern, (match) => {
      const num = parseFloat(match);
      if (Number.isFinite(num) && num > 0 && num < 10000 && this.shouldMutate(0.2)) {
        const factor = 1 + (Math.random() - 0.5) * 0.2; // ±10%
        const mutated = Math.round(num * factor);
        mutations.push(`参数微调: ${num} → ${mutated}`);
        return String(mutated);
      }
      return match;
    });

    // 3. 条件表达式微调（反转/调整阈值）
    const condPattern = /([<>!=])=?(\d+(?:\.\d+)?)/g;
    code = code.replace(condPattern, (match, operator, value) => {
      if (this.shouldMutate(0.15)) {
        const operators: Record<string, string> = {
          '>': '>=', '>=': '>',
          '<': '<=', '<=': '<',
          '===': '==', '==': '===',
          '!==': '!=', '!=': '!==',
        };
        if (operators[operator]) {
          mutations.push(`条件运算符变异: ${operator} → ${operators[operator]}`);
          return `${operators[operator]}${value}`;
        }
      }
      return match;
    });

    // 4. 注释增强（微小变异的附带产物）
    if (this.shouldMutate(0.1)) {
      const commentLine = `// [mutated] auto-adjusted by CodeMutator\n`;
      code = commentLine + code;
      mutations.push('添加变异标记注释');
    }

    return {
      type: 'point',
      mutatedCode: code,
      description: mutations.length > 0
        ? mutations.join('; ')
        : '无有效变异（低于变异阈值）',
      changedLines: mutations.length,
    };
  }

  /**
   * 结构性变异（函数提取/内联、条件简化、循环变换）
   */
  structuralMutation(input: CodeMutationInput): CodeMutationResult {
    let code = input.sourceCode;
    const mutations: string[] = [];

    // 1. 长函数检测 → 提取内部逻辑（标记提取点）
    const funcPattern = /(async\s+)?(function\s+\w+|const\s+\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>)/g;
    code = code.replace(funcPattern, (match) => {
      if (this.shouldMutate(0.25)) {
        const marker = `// @extracted-by-mutator\n${match}`;
        mutations.push(`标记长函数 ${match.substring(0, 20)} 为提取候选`);
        return marker;
      }
      return match;
    });

    // 2. 简化双重否定
    const doubleNegPattern = /!\(!(\w+)\)/g;
    code = code.replace(doubleNegPattern, (match, expr) => {
      mutations.push(`简化双重否定: ${match} → ${expr}`);
      return expr;
    });

    // 3. Promise.then → async/await 风格标记
    const thenPattern = /\.then\(\(([^)]+)\)\s*=>\s*{/g;
    code = code.replace(thenPattern, (match) => {
      if (this.shouldMutate(0.2)) {
        mutations.push('标记 .then() 链为 async/await 候选');
        return `// @async-candidate\n${match}`;
      }
      return match;
    });

    return {
      type: 'structural',
      mutatedCode: code,
      description: mutations.length > 0
        ? mutations.join('; ')
        : '无有效结构性变异',
      changedLines: mutations.length,
    };
  }

  /**
   * 交叉变异 — 将两个源码实现合并
   */
  crossoverMutation(inputA: CodeMutationInput, inputB: CodeMutationInput): CodeMutationResult {
    // 简单交叉：取 A 的前半 + B 的后半
    const linesA = inputA.sourceCode.split('\n');
    const linesB = inputB.sourceCode.split('\n');
    const midA = Math.floor(linesA.length / 2);
    const midB = Math.floor(linesB.length / 2);

    const crossed = [
      ...linesA.slice(0, midA),
      `// [crossover] merged from ${inputA.filePath} and ${inputB.filePath}`,
      ...linesB.slice(midB),
    ];

    return {
      type: 'crossover',
      mutatedCode: crossed.join('\n'),
      description: `交叉合并: ${inputA.filePath} (前${midA}行) + ${inputB.filePath} (后${linesB.length - midB}行)`,
      changedLines: Math.round((midA + linesB.length - midB) / 2),
    };
  }

  private shouldMutate(probability: number): boolean {
    return Math.random() < probability;
  }

  private alternativeName(name: string): string {
    const alternatives: Record<string, string[]> = {
      'data': ['payload', 'info', 'content', 'dataset'],
      'result': ['output', 'outcome', 'response', 'value'],
      'items': ['entries', 'elements', 'records', 'list'],
      'config': ['settings', 'options', 'configuration', 'params'],
      'count': ['total', 'size', 'length', 'amount'],
      'index': ['pos', 'position', 'idx', 'offset'],
      'value': ['val', 'amount', 'data', 'entry'],
      'temp': ['tmp', 'cache', 'buffer', 'scratch'],
      'key': ['id', 'identifier', 'name', 'label'],
      'flag': ['enabled', 'active', 'status', 'toggle'],
    };

    const candidates = alternatives[name];
    if (candidates) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return pick ?? name + '_alt';
    }
    return name + '_alt';
  }
}
