import { findRelevantMemories } from '../memdir/findRelevantMemories.js'
import { getAutoMemPath } from '../memdir/paths.js'
import { getProjectDir } from '../utils/sessionStorage.js'
import { getOriginalCwd } from '../bootstrap/state.js'
import { RulesEngine } from '../utils/rulesEngine.js'

export interface ContextLayer {
  id: string
  name: string
  priority: number
  maxTokens: number
  content: string
}

export interface Context {
  core: ContextLayer
  relevant: ContextLayer
  optional: ContextLayer
  totalTokens: number
  truncated: boolean
}

export class ContextManager {
  private readonly coreContext: ContextLayer
  private readonly skillManager: any
  private readonly rulesEngine: RulesEngine

  constructor(skillManager?: any) {
    this.skillManager = skillManager
    this.rulesEngine = new RulesEngine()

    this.coreContext = {
      id: 'core',
      name: '核心上下文',
      priority: 1,
      maxTokens: 2000,
      content: this.buildCoreContent()
    }
  }

  async buildContext(userInput: string, tokenBudget: number = 8000): Promise<Context> {
    const [core, relevant, optional] = await Promise.all([
      this.loadCoreContext(),
      this.loadRelevant(userInput),
      this.loadOptional(userInput)
    ])

    const totalTokens = estimateTokens(core.content) +
                       estimateTokens(relevant.content) +
                       estimateTokens(optional.content)

    let truncated = false
    if (totalTokens > tokenBudget) {
      const compressed = compressToBudget([core, relevant, optional], tokenBudget)
      return {
        core: compressed[0] as ContextLayer,
        relevant: compressed[1] as ContextLayer,
        optional: compressed[2] as ContextLayer,
        totalTokens: calculateTotalTokens(compressed),
        truncated: true
      }
    }

    return {
      core,
      relevant,
      optional,
      totalTokens,
      truncated: false
    }
  }

  private buildCoreContent(): string {
    const projectDir = getProjectDir(getOriginalCwd())
    const targetFile = projectDir // 用户当前操作的文件，默认取项目根目录
    const rulesSnippet = this.rulesEngine.buildContextRules(targetFile, projectDir)

    return `系统角色：Dawn，本地编程助手
工作目录：${projectDir}
当前时间：${new Date().toISOString()}
可用工具：文件读写、代码分析、命令执行、技能匹配
技能系统：已启用，支持自进化
记忆系统：已启用，支持压缩和检索
代码能力：补全、理解、重构、测试生成、代码审查
${rulesSnippet ? `\n${rulesSnippet}` : ''}`
  }

  private async loadCoreContext(): Promise<ContextLayer> {
    return this.coreContext
  }

  private async loadRelevant(userInput: string): Promise<ContextLayer> {
    const keywords = this.extractKeywords(userInput)
    let relevantContent = ''

    if (keywords.length > 0) {
      relevantContent = `关键词：${keywords.join(', ')}`
    }

    // 通过 memdir 查询真实记忆
    try {
      const memoryDir = getAutoMemPath()
      const relevantMemories = await findRelevantMemories(
        userInput,
        memoryDir,
        new AbortController().signal,
      )
      if (relevantMemories.length > 0) {
        relevantContent += `\n相关记忆文件：\n${relevantMemories.map(m => m.path).join('\n')}`
      }
    } catch {
      // memdir 不可用时静默降级
    }

    // 如果技能管理器可用，添加匹配的技能信息
    if (this.skillManager) {
      const matchedSkill = this.skillManager.match(userInput)
      if (matchedSkill) {
        relevantContent += `\n\n匹配技能：${matchedSkill.name}\n技能描述：${matchedSkill.description}`
      }
    }

    return {
      id: 'relevant',
      name: '相关上下文',
      priority: 2,
      maxTokens: 3000,
      content: relevantContent || '无相关上下文',
    }
  }

  private async loadOptional(userInput: string): Promise<ContextLayer> {
    let optionalContent = ''

    // 通过 memdir 扫描获取记忆文件列表
    try {
      const memoryDir = getAutoMemPath()
      const { scanMemoryFiles } = await import('../memdir/memoryScan.js')
      const memories = await scanMemoryFiles(memoryDir, new AbortController().signal)
      if (memories.length > 0) {
        optionalContent += `可用记忆文件（${memories.length}个）：\n`
        optionalContent += memories.slice(0, 10).map(m =>
          `- ${m.filename}: ${m.description || '无描述'}`
        ).join('\n')
      }
    } catch {
      // memdir 不可用时静默降级
    }

    return {
      id: 'optional',
      name: '可选上下文',
      priority: 3,
      maxTokens: 3000,
      content: optionalContent || '无可选上下文',
    }
  }

  private extractKeywords(input: string): string[] {
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不',
      '人', '都', '一', '一个', '上', '也', '很', '到', '说',
      '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
    ])

    return input
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(word => word.length > 1 && !stopWords.has(word))
  }
}


const estimateTokens = (text: string): number => {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.25)
}

const truncateToTokens = (text: string, maxTokens: number): string => {
  let tokens = 0
  let result = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const isChinese = /[\u4e00-\u9fa5]/.test(char)
    tokens += isChinese ? 1.5 : 0.25

    if (tokens > maxTokens) {
      break
    }
    result += char
  }

  if (result.length < text.length) {
    result += '... [截断]'
  }

  return result
}

const compressToBudget = (
  layers: Array<{ id: string; priority: number; content: string }>,
  budget: number
): Array<{ id: string; content: string }> => {
  const sortedLayers = [...layers].sort((a, b) => a.priority - b.priority)
  let remainingBudget = budget
  const compressedLayers: Array<{ id: string; content: string }> = []

  for (const layer of sortedLayers) {
    const estimatedTokens = estimateTokens(layer.content)

    if (estimatedTokens <= remainingBudget) {
      compressedLayers.push({ id: layer.id, content: layer.content })
      remainingBudget -= estimatedTokens
    } else if (remainingBudget > 100) {
      const truncatedContent = truncateToTokens(layer.content, remainingBudget)
      compressedLayers.push({ id: layer.id, content: truncatedContent })
      remainingBudget = 0
    } else {
      compressedLayers.push({ id: layer.id, content: '[内容因预算限制被省略]' })
    }
  }

  return compressedLayers.sort((a, b) => {
    const aIndex = layers.findIndex(l => l.id === a.id)
    const bIndex = layers.findIndex(l => l.id === b.id)
    return aIndex - bIndex
  })
}

function calculateTotalTokens(
  layers: Array<{ content: string }>,
): number {
  return layers.reduce((sum, l) => sum + estimateTokens(l.content), 0)
}
