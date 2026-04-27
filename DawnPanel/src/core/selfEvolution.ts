/**
 * 自进化引擎 — 任务后分析 + 技能提取 + 改进建议
 *
 * 和 Dawn 本体 selfEvolution.ts 功能等价，但：
 * - 生成更实用的改进建议（而不是模板化的"步骤过多"）
 * - 自动提取可复用技能并存入 SkillMemory
 * - 每次任务后生成结构化进化总结
 */

import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { memoryStore } from './memoryStore.js'

export interface TaskRecord {
  id: string
  description: string
  category: string
  toolsUsed: string[]
  success: boolean
  duration: number
  resultSummary: string
  keywords: string[]
  timestamp: string
}

export interface EvolutionSuggestion {
  type: 'skill' | 'pattern' | 'workflow' | 'knowledge'
  description: string
  detail: string
  actionable: boolean
}

export interface EvolutionSummary {
  taskId: string
  suggestions: EvolutionSuggestion[]
  extractedPattern: string | null
  reusableSkill: {
    name: string
    code: string
    usage: number
  } | null
  timestamp: string
}

export class SelfEvolutionEngine {
  private taskHistory: TaskRecord[] = []

  async analyzeTask(task: TaskRecord): Promise<EvolutionSummary> {
    this.taskHistory.push(task)
    const suggestions: EvolutionSuggestion[] = []
    let reusableSkill: EvolutionSummary['reusableSkill'] = null
    let extractedPattern: string | null = null

    // 1. 技能提取：成功 + 用了工具 + 有代码输出 → 尝试提取可复用技能
    if (task.success && task.resultSummary.length > 20) {
      const skillName = this.inferSkillName(task)
      if (skillName) {
        reusableSkill = {
          name: skillName,
          code: task.resultSummary,
          usage: 1,
        }
        suggestions.push({
          type: 'skill',
          description: `可复用技能「${skillName}」`,
          detail: `从任务"${task.description.substring(0, 40)}..."中提取`,
          actionable: true,
        })
      }
    }

    // 2. 模式检测：关键词模式识别
    const pattern = this.detectPattern(task)
    if (pattern) {
      extractedPattern = pattern
      suggestions.push({
        type: 'pattern',
        description: `检测到模式: ${pattern}`,
        detail: `类似任务出现 ${this.countSimilarTasks(task)} 次`,
        actionable: true,
      })
    }

    // 3. 工作流优化建议
    if (task.toolsUsed.length > 5) {
      suggestions.push({
        type: 'workflow',
        description: '工具调用过多',
        detail: `用了 ${task.toolsUsed.length} 个工具，考虑合并步骤`,
        actionable: true,
      })
    }

    // 4. 知识积累建议
    if (task.keywords.length > 0) {
      suggestions.push({
        type: 'knowledge',
        description: `关键词: ${task.keywords.join(', ')}`,
        detail: '这些关键词可作为后续任务的检索锚点',
        actionable: true,
      })
    }

    // 保存到记忆
    await this.persistEvolution(task, suggestions, reusableSkill)

    // 保存可复用技能到 memoryStore
    if (reusableSkill) {
      await memoryStore.add(
        `[技能] ${reusableSkill.name}: ${reusableSkill.code.substring(0, 200)}`,
        'skill',
      )
    }

    return {
      taskId: task.id,
      suggestions,
      extractedPattern,
      reusableSkill,
      timestamp: new Date().toISOString(),
    }
  }

  private inferSkillName(task: TaskRecord): string | null {
    const categoryMap: Record<string, string> = {
      code_generation: '代码生成',
      debounce: '防抖函数',
      throttle: '节流函数',
      validation: '数据校验',
      formatting: '格式化工具',
      sorting: '排序算法',
      caching: '缓存工具',
      event: '事件系统',
      prompt: '提示词优化',
      review: '代码审查',
      refactor: '代码重构',
      test: '测试编写',
    }
    for (const [key, name] of Object.entries(categoryMap)) {
      if (task.description.toLowerCase().includes(key)) return name
      if (task.category === key) return name
    }
    // 从描述推断
    if (task.description.includes('防抖') || task.description.includes('debounce'))
      return '防抖函数'
    if (task.description.includes('节流') || task.description.includes('throttle'))
      return '节流函数'
    if (task.description.includes('验证') || task.description.includes('校验'))
      return '数据校验'
    if (task.description.includes('排序')) return '排序算法'
    if (task.description.includes('缓存')) return '缓存工具'
    return null
  }

  private detectPattern(task: TaskRecord): string | null {
    const patterns: Array<{ keywords: string[]; pattern: string }> = [
      { keywords: ['生成', '创建', '写'], pattern: '代码生成模式' },
      { keywords: ['修复', '修', 'bug'], pattern: '问题修复模式' },
      { keywords: ['优化', '重构', '改'], pattern: '代码优化模式' },
      { keywords: ['搜索', '查', '找'], pattern: '信息检索模式' },
      { keywords: ['解释', '什么', '如何', '为什么'], pattern: '知识问答模式' },
    ]

    for (const p of patterns) {
      if (p.keywords.some((kw) => task.description.includes(kw))) {
        return p.pattern
      }
    }
    return null
  }

  private countSimilarTasks(task: TaskRecord): number {
    return this.taskHistory.filter(
      (t) => t.id !== task.id && this.calculateSimilarity(t, task) > 0.5,
    ).length
  }

  private calculateSimilarity(a: TaskRecord, b: TaskRecord): number {
    const setA = new Set(a.keywords.map((k) => k.toLowerCase()))
    const setB = new Set(b.keywords.map((k) => k.toLowerCase()))
    const intersection = [...setA].filter((k) => setB.has(k)).length
    const union = new Set([...setA, ...setB]).size
    return union > 0 ? intersection / union : 0
  }

  private async persistEvolution(
    task: TaskRecord,
    suggestions: EvolutionSuggestion[],
    reusableSkill: EvolutionSummary['reusableSkill'],
  ): Promise<void> {
    const dir = join(process.cwd(), '.dawn-memory', 'self-evolution')
    await mkdir(dir, { recursive: true })

    const content = [
      `# 自进化分析报告`,
      `## 任务`,
      `- **描述**: ${task.description}`,
      `- **分类**: ${task.category || '通用'}`,
      `- **结果**: ${task.success ? '成功' : '失败'}`,
      `- **耗时**: ${task.duration}ms`,
      ``,
      `## 改进建议`,
      ...suggestions.map((s) => `- [${s.type.toUpperCase()}] ${s.description}: ${s.detail}${s.actionable ? ' ✅' : ''}`),
      ``,
      ...(reusableSkill
        ? [`## 提取的技能`, `- **名称**: ${reusableSkill.name}`, `- **代码预览**:`, '```', reusableSkill.code.substring(0, 300), '```']
        : []),
      ``,
      `## 关键词`,
      ...task.keywords.map((kw) => `- ${kw}`),
      `---`,
      `生成时间: ${new Date().toISOString()}`,
    ].join('\n')

    const filename = `evolution-${task.id}-${new Date().toISOString().split('T')[0]}.md`
    await writeFile(join(dir, filename), content, 'utf-8')
  }

  /** 获取最近的进化总结（供面板显示） */
  async getRecentSummary(count: number = 3): Promise<string> {
    try {
      const recent = this.taskHistory.slice(-count)
      if (recent.length === 0) return '暂无自进化数据'
      return recent
        .map(
          (t) =>
            `- ${t.success ? '✅' : '❌'} ${t.description.substring(0, 50)} (${t.category || '通用'})`,
        )
        .join('\n')
    } catch {
      return '暂无自进化数据'
    }
  }
}

export const evolutionEngine = new SelfEvolutionEngine()
