// 自进化模块 - 实现任务完成后自动分析、生成改进建议、存入记忆
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { SkillGenerator, getSkillGenerator } from './skillGenerator.js';

export interface TaskAnalysis {
  id: string
  description: string
  toolsUsed: string[]
  stepsTaken: string[]
  success: boolean
  duration: number
  createdAt: string
  completedAt: string
  keywords: string[]
}

export interface ImprovementSuggestion {
  id: string
  taskId: string
  type: 'skill' | 'workflow' | 'tool' | 'memory'
  description: string
  priority: 'low' | 'medium' | 'high'
  implementation: string
  createdAt: string
}

export class SelfEvolutionEngine {
  private taskHistory: TaskAnalysis[] = []
  private suggestions: ImprovementSuggestion[] = []
  private skillGenerator: SkillGenerator

  constructor() {
    this.skillGenerator = getSkillGenerator();
  }

  // 任务完成后调用
  async analyzeTask(task: TaskAnalysis): Promise<ImprovementSuggestion[]> {
    this.taskHistory.push(task)
    
    const suggestions: ImprovementSuggestion[] = []
    
    // 1. 检查是否可生成新技能
    if (task.toolsUsed.length >= 3 && task.success) {
      const skillSuggestion = await this.generateSkillSuggestion(task)
      if (skillSuggestion) suggestions.push(skillSuggestion)
      
      // 尝试生成技能
      const skill = await this.skillGenerator.generateSkillFromTask(task)
      if (skill) {
        console.log(`生成新技能: ${skill.name}`)
      }
    }
    
    // 2. 检查工作流优化
    const workflowSuggestion = await this.analyzeWorkflow(task)
    if (workflowSuggestion) suggestions.push(workflowSuggestion)
    
    // 3. 检查工具使用模式
    const toolSuggestion = await this.analyzeToolUsage(task)
    if (toolSuggestion) suggestions.push(toolSuggestion)
    
    // 4. 检查记忆存储
    const memorySuggestion = await this.analyzeMemoryStorage(task)
    if (memorySuggestion) suggestions.push(memorySuggestion)
    
    this.suggestions.push(...suggestions)
    
    // 保存到记忆
    await this.saveToMemory(task, suggestions)
    
    return suggestions
  }
  
  private async generateSkillSuggestion(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    // 检查重复任务模式
    const similarTasks = this.findSimilarTasks(task)
    if (similarTasks.length >= 2) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'skill',
        description: `检测到重复任务模式: "${task.description.substring(0, 50)}..."，建议生成可复用技能`,
        priority: 'high',
        implementation: `调用 SkillGenerator 从任务历史生成新技能`,
        createdAt: new Date().toISOString()
      }
    }
    return null
  }
  
  private async analyzeWorkflow(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    // 分析步骤效率
    if (task.stepsTaken.length > 10) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'workflow',
        description: `任务步骤过多 (${task.stepsTaken.length}步)，建议优化工作流`,
        priority: 'medium',
        implementation: `合并相关步骤，减少工具调用次数`,
        createdAt: new Date().toISOString()
      }
    }
    return null
  }
  
  private async analyzeToolUsage(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    // 检查工具使用模式
    const toolCount = task.toolsUsed.length
    const uniqueTools = new Set(task.toolsUsed).size
    
    if (toolCount > 5 && uniqueTools < toolCount * 0.5) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'tool',
        description: `工具使用重复率高，建议优化工具调用模式`,
        priority: 'low',
        implementation: `分析工具调用序列，寻找优化机会`,
        createdAt: new Date().toISOString()
      }
    }
    return null
  }
  
  private async analyzeMemoryStorage(task: TaskAnalysis): Promise<ImprovementSuggestion | null> {
    // 检查是否应该存入长期记忆
    const keywords = task.keywords
    const hasImportantKeywords = keywords.some(kw => 
      ['fix', 'bug', 'error', 'security', 'performance', 'refactor'].includes(kw.toLowerCase())
    )
    
    if (hasImportantKeywords && task.success) {
      return {
        id: crypto.randomUUID(),
        taskId: task.id,
        type: 'memory',
        description: `任务包含重要关键词，建议存入长期记忆`,
        priority: 'medium',
        implementation: `将任务结果保存到 .dawn-memory/reference/`,
        createdAt: new Date().toISOString()
      }
    }
    return null
  }
  
  private findSimilarTasks(task: TaskAnalysis): TaskAnalysis[] {
    return this.taskHistory.filter(t => 
      t.id !== task.id && 
      this.calculateTaskSimilarity(t, task) > 0.6
    )
  }
  
  private calculateTaskSimilarity(task1: TaskAnalysis, task2: TaskAnalysis): number {
    // 基于关键词相似度
    const keywords1 = new Set(task1.keywords)
    const keywords2 = new Set(task2.keywords)
    
    const intersection = [...keywords1].filter(k => keywords2.has(k)).length
    const union = new Set([...keywords1, ...keywords2]).size
    
    return union > 0 ? intersection / union : 0
  }
  
  private async saveToMemory(task: TaskAnalysis, suggestions: ImprovementSuggestion[]): Promise<void> {
    const memoryContent = `# 任务分析报告
## 任务信息
- ID: ${task.id}
- 描述: ${task.description}
- 完成时间: ${task.completedAt}
- 成功率: ${task.success ? '成功' : '失败'}
- 耗时: ${task.duration}ms

## 工具使用
${task.toolsUsed.map(tool => `- ${tool}`).join('\n')}

## 改进建议
${suggestions.map(s => `- [${s.priority.toUpperCase()}] ${s.description}`).join('\n')}

## 学习要点
${task.keywords.map(kw => `- ${kw}`).join('\n')}
`
    
    // 保存到文件
    const memoryDir = join(process.cwd(), '.dawn-memory', 'self-evolution')
    await mkdir(memoryDir, { recursive: true })
    
    const filename = `task-${task.id}-${new Date().toISOString().split('T')[0]}.md`
    await writeFile(join(memoryDir, filename), memoryContent, 'utf-8')
  }
  
  // 获取所有改进建议
  getAllSuggestions(): ImprovementSuggestion[] {
    return [...this.suggestions]
  }
  
  // 获取高优先级建议
  getHighPrioritySuggestions(): ImprovementSuggestion[] {
    return this.suggestions.filter(s => s.priority === 'high')
  }
  
  // 清除旧建议
  clearOldSuggestions(days: number = 30): void {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    
    this.suggestions = this.suggestions.filter(s => 
      new Date(s.createdAt) > cutoff
    )
  }
}
