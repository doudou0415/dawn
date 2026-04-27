/**
 * WorkflowMutator — 工作流变异器
 *
 * 变异策略：
 * - 重排步骤顺序
 * - 并行化（识别独立步骤）
 * - 合并冗余步骤
 * - 插入校验步骤
 */

export interface WorkflowStep {
  id: string;
  name: string;
  tool: string;
  description: string;
  dependsOn: string[];
  isCheckpoint?: boolean;
}

export interface WorkflowMutationInput {
  workflowId: string;
  steps: WorkflowStep[];
  workflowPrompt: string;
}

export interface WorkflowMutationResult {
  type: 'reorder' | 'parallelize' | 'merge' | 'insert_checkpoint';
  mutatedSteps: WorkflowStep[];
  mutatedPrompt: string;
  description: string;
}

export class WorkflowMutator {
  /**
   * 重排步骤顺序
   */
  reorderMutation(input: WorkflowMutationInput): WorkflowMutationResult {
    const steps = [...input.steps];
    const changes: string[] = [];

    // 安全检查：不能把依赖关系打破
    const depMap = new Map<string, string[]>();
    for (const step of steps) {
      depMap.set(step.id, step.dependsOn);
    }

    // 尝试将独立（无依赖）的步骤提前
    const independent = steps.filter(s => s.dependsOn.length === 0);
    const dependent = steps.filter(s => s.dependsOn.length > 0);

    if (independent.length >= 2 && this.shouldMutate(0.4)) {
      // 把第一个独立步骤和最后一个独立步骤交换
      const idx1 = 0;
      const idx2 = independent.length - 1;
      const a = independent[idx1]!;
      const b = independent[idx2]!;
      independent[idx1] = b;
      independent[idx2] = a;
      changes.push(`交换独立步骤: ${a.name} ↔ ${b.name}`);
    }

    return {
      type: 'reorder',
      mutatedSteps: [...independent, ...dependent],
      mutatedPrompt: input.workflowPrompt,
      description: changes.length > 0 ? changes.join('; ') : '顺序未调整',
    };
  }

  /**
   * 并行化标记 — 找出无相互依赖的步骤对
   */
  parallelizeMutation(input: WorkflowMutationInput): WorkflowMutationResult {
    const steps = [...input.steps];
    const parallelGroups: string[] = [];

    // 寻找可并行步骤对
    for (let i = 0; i < steps.length; i++) {
      for (let j = i + 1; j < steps.length; j++) {
        const a = steps[i]!;
        const b = steps[j]!;
        const depsA = new Set(a.dependsOn);
        const depsB = new Set(b.dependsOn);

        // A不依赖B且B不依赖A
        if (!depsA.has(b.id) && !depsB.has(a.id) && this.shouldMutate(0.3)) {
          parallelGroups.push(`${a.name} || ${b.name}`);
          // 标记为并行
          steps[i] = { ...a, dependsOn: [...a.dependsOn] };
          steps[j] = { ...b, dependsOn: [...b.dependsOn] };
          break;
        }
      }
    }

    return {
      type: 'parallelize',
      mutatedSteps: steps,
      mutatedPrompt: parallelGroups.length > 0
        ? input.workflowPrompt + `\n# [parallel] ${parallelGroups.join(', ')}`
        : input.workflowPrompt,
      description: parallelGroups.length > 0
        ? `可并行化: ${parallelGroups.join('; ')}`
        : '未发现可并行步骤',
    };
  }

  /**
   * 合并冗余步骤
   */
  mergeMutation(input: WorkflowMutationInput): WorkflowMutationResult {
    const steps = [...input.steps];
    const changes: string[] = [];
    const merged = new Set<string>();

    for (let i = 0; i < steps.length - 1; i++) {
      const current = steps[i]!;
      const next = steps[i + 1]!;

      if (merged.has(current.id) || merged.has(next.id)) continue;

      // 连续使用同工具 → 合并
      if (current.tool === next.tool && this.shouldMutate(0.3)) {
        const mergedStep: WorkflowStep = {
          id: `${current.id}_${next.id}`,
          name: `${current.name}+${next.name}`,
          tool: current.tool,
          description: `[merged] ${current.description}; ${next.description}`,
          dependsOn: [...new Set([...current.dependsOn, ...next.dependsOn.filter(d => d !== current.id)])],
        };
        steps.splice(i, 2, mergedStep);
        merged.add(current.id);
        merged.add(next.id);
        changes.push(`合并: ${current.name} + ${next.name}`);
        break; // 每次只做一次合并
      }
    }

    return {
      type: 'merge',
      mutatedSteps: steps.filter(s => !merged.has(s.id)),
      mutatedPrompt: input.workflowPrompt,
      description: changes.length > 0 ? changes.join('; ') : '未发现可合并步骤',
    };
  }

  /**
   * 在校验点后插入中间校验步骤
   */
  insertCheckpoint(input: WorkflowMutationInput): WorkflowMutationResult {
    const steps = [...input.steps];
    const checkpointIndex = steps.findIndex(s => s.isCheckpoint);

    if (checkpointIndex >= 0 && this.shouldMutate(0.4)) {
      const afterCheckpoint = checkpointIndex + 1;
      const validationStep: WorkflowStep = {
        id: `validation-${Date.now()}`,
        name: '中间校验',
        tool: 'validator',
        description: '验证上一步输出是否符合预期格式和质量要求',
        dependsOn: [steps[checkpointIndex]!.id],
      };
      steps.splice(afterCheckpoint, 0, validationStep);

      return {
        type: 'insert_checkpoint',
        mutatedSteps: steps,
        mutatedPrompt: input.workflowPrompt + `\n# [validation] 在 ${steps[checkpointIndex]!.name} 后增加校验步骤`,
        description: `在校验点 ${steps[checkpointIndex]!.name} 后插入校验步骤`,
      };
    }

    return {
      type: 'insert_checkpoint',
      mutatedSteps: steps,
      mutatedPrompt: input.workflowPrompt,
      description: '未插入校验步骤（无校验点/概率未命中）',
    };
  }

  private shouldMutate(probability: number): boolean {
    return Math.random() < probability;
  }
}
