import { Skill } from '../skills/skillTypes'

export interface Memory {
  id: string
  content: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  tags: string[]
  createdAt: string
  lastAccessed: string
  accessCount: number
  relevanceScore: number
}

export interface MemoryCluster {
  id: string
  theme: string
  memories: Memory[]
  summary: string
  valueScore: number
}

export class MemoryCompressor {
  // 智能压缩策略
  async compress(memories: Memory[]): Promise<Memory[]> {
    if (memories.length <= 100) {
      return memories // 数量少时不压缩
    }

    // 1. 按主题聚类
    const clusters = await this.clusterByTheme(memories)

    // 2. 合并相似记忆
    const mergedClusters = await this.mergeSimilarClusters(clusters)

    // 3. 生成摘要
    const summarizedClusters = await this.generateSummaries(mergedClusters)

    // 4. 计算价值分数
    const scoredClusters = this.calculateClusterValues(summarizedClusters)

    // 5. 保留高价值，压缩低价值
    return this.selectHighValueMemories(scoredClusters, memories)
  }

  // 按主题聚类
  private async clusterByTheme(memories: Memory[]): Promise<MemoryCluster[]> {
    const clusters: MemoryCluster[] = []

    // 按类型分组
    const typeGroups = new Map<string, Memory[]>()
    for (const memory of memories) {
      const key = memory.type
      if (!typeGroups.has(key)) {
        typeGroups.set(key, [])
      }
      typeGroups.get(key)!.push(memory)
    }

    // 创建基础聚类
    for (const [type, typeMemories] of typeGroups) {
      // 进一步按标签聚类
      const tagGroups = new Map<string, Memory[]>()
      for (const memory of typeMemories) {
        const tags = memory.tags.join(',')
        if (!tagGroups.has(tags)) {
          tagGroups.set(tags, [])
        }
        tagGroups.get(tags)!.push(memory)
      }

      for (const [tags, tagMemories] of tagGroups) {
        clusters.push({
          id: crypto.randomUUID(),
          theme: `${type}:${tags || 'untagged'}`,
          memories: tagMemories,
          summary: '',
          valueScore: 0,
        })
      }
    }

    return clusters
  }

  // 合并相似聚类
  private async mergeSimilarClusters(
    clusters: MemoryCluster[],
  ): Promise<MemoryCluster[]> {
    const merged: MemoryCluster[] = []
    const visited = new Set<string>()

    for (let i = 0; i < clusters.length; i++) {
      if (visited.has(clusters[i].id)) continue

      const current = clusters[i]
      const similarClusters: MemoryCluster[] = [current]

      // 查找相似聚类（基于主题相似度）
      for (let j = i + 1; j < clusters.length; j++) {
        if (visited.has(clusters[j].id)) continue

        const similarity = this.calculateThemeSimilarity(
          current.theme,
          clusters[j].theme,
        )
        if (similarity > 0.7) {
          // 相似度阈值
          similarClusters.push(clusters[j])
          visited.add(clusters[j].id)
        }
      }

      // 合并相似聚类
      if (similarClusters.length > 1) {
        const allMemories: Memory[] = []
        for (const cluster of similarClusters) {
          allMemories.push(...cluster.memories)
        }

        merged.push({
          id: crypto.randomUUID(),
          theme: this.mergeThemes(similarClusters.map(c => c.theme)),
          memories: allMemories,
          summary: '',
          valueScore: 0,
        })
      } else {
        merged.push(current)
      }

      visited.add(current.id)
    }

    return merged
  }

  // 生成摘要
  private async generateSummaries(
    clusters: MemoryCluster[],
  ): Promise<MemoryCluster[]> {
    for (const cluster of clusters) {
      if (cluster.memories.length <= 3) {
        // 记忆少时保留所有内容
        cluster.summary = `包含 ${cluster.memories.length} 条记忆`
      } else {
        // 生成摘要：提取关键信息
        const sampleMemories = cluster.memories
          .sort((a, b) => b.accessCount - a.accessCount)
          .slice(0, 3)

        const keyPoints = sampleMemories
          .map(m => {
            const preview =
              m.content.length > 100
                ? m.content.substring(0, 100) + '...'
                : m.content
            return `• ${preview}`
          })
          .join('\n')

        cluster.summary = `聚类主题: ${cluster.theme}\n包含 ${cluster.memories.length} 条记忆\n关键点:\n${keyPoints}`
      }
    }

    return clusters
  }

  // 计算聚类价值
  private calculateClusterValues(clusters: MemoryCluster[]): MemoryCluster[] {
    for (const cluster of clusters) {
      let totalValue = 0

      for (const memory of cluster.memories) {
        const memoryValue = this.calculateValue(memory)
        totalValue += memoryValue
      }

      cluster.valueScore = totalValue / cluster.memories.length
    }

    return clusters.sort((a, b) => b.valueScore - a.valueScore)
  }

  // 选择高价值记忆
  private selectHighValueMemories(
    clusters: MemoryCluster[],
    originalMemories: Memory[],
  ): Memory[] {
    const selected: Memory[] = []

    // 保留高价值聚类中的所有记忆
    const highValueClusters = clusters.slice(
      0,
      Math.ceil(clusters.length * 0.3),
    ) // 前30%
    for (const cluster of highValueClusters) {
      selected.push(...cluster.memories)
    }

    // 从剩余聚类中选择高价值记忆
    const remainingClusters = clusters.slice(highValueClusters.length)
    for (const cluster of remainingClusters) {
      // 按价值排序，选择前50%
      const sortedMemories = cluster.memories
        .map(m => ({ memory: m, value: this.calculateValue(m) }))
        .sort((a, b) => b.value - a.value)

      const keepCount = Math.ceil(sortedMemories.length * 0.5)
      for (let i = 0; i < keepCount; i++) {
        selected.push(sortedMemories[i].memory)
      }
    }

    // 确保至少保留原始记忆的30%
    const minKeepCount = Math.ceil(originalMemories.length * 0.3)
    if (selected.length < minKeepCount) {
      // 补充一些随机记忆
      const remaining = originalMemories.filter(m => !selected.includes(m))
      const needed = minKeepCount - selected.length
      selected.push(...remaining.slice(0, needed))
    }

    return selected
  }

  // 计算单个记忆的价值
  calculateValue(memory: Memory): number {
    let score = 0

    // 1. 最近使用权重 (0-40分)
    const daysSinceAccess = this.daysBetween(
      new Date(memory.lastAccessed),
      new Date(),
    )
    if (daysSinceAccess <= 1) score += 40
    else if (daysSinceAccess <= 7) score += 30
    else if (daysSinceAccess <= 30) score += 20
    else if (daysSinceAccess <= 90) score += 10

    // 2. 访问频率权重 (0-30分)
    if (memory.accessCount > 100) score += 30
    else if (memory.accessCount > 50) score += 25
    else if (memory.accessCount > 20) score += 20
    else if (memory.accessCount > 10) score += 15
    else if (memory.accessCount > 5) score += 10
    else if (memory.accessCount > 0) score += 5

    // 3. 相关性权重 (0-20分)
    score += Math.min(memory.relevanceScore * 20, 20)

    // 4. 类型权重 (0-10分)
    if (memory.type === 'feedback')
      score += 10 // 反馈最重要
    else if (memory.type === 'user')
      score += 8 // 用户信息次之
    else if (memory.type === 'project') score += 6
    else if (memory.type === 'reference') score += 4

    return score
  }

  // 计算主题相似度
  private calculateThemeSimilarity(theme1: string, theme2: string): number {
    const words1 = new Set(theme1.toLowerCase().split(/[:,_\s]+/))
    const words2 = new Set(theme2.toLowerCase().split(/[:,_\s]+/))

    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])

    return union.size === 0 ? 0 : intersection.size / union.size
  }

  // 合并主题
  private mergeThemes(themes: string[]): string {
    if (themes.length === 0) return ''
    if (themes.length === 1) return themes[0]

    // 提取共同前缀
    const parts = themes.map(t => t.split(':'))
    const commonPrefix = parts[0][0] // 类型部分

    // 合并标签部分
    const allTags = new Set<string>()
    for (const part of parts) {
      if (part.length > 1) {
        const tags = part[1].split(',')
        tags.forEach(tag => allTags.add(tag))
      }
    }

    const tagsStr = Array.from(allTags).join(',')
    return `${commonPrefix}:${tagsStr}`
  }

  // 计算天数差
  private daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  // 压缩记忆内容（智能截断）
  compressContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content

    // 尝试在句子边界截断
    const sentences = content.split(/[.!?。！？]/)
    let compressed = ''

    for (const sentence of sentences) {
      if ((compressed + sentence).length > maxLength) break
      compressed += sentence + '.'
    }

    // 如果句子截断不理想，使用简单截断
    if (compressed.length === 0 || compressed.length < maxLength * 0.3) {
      compressed = content.substring(0, maxLength - 3) + '...'
    }

    return compressed
  }

  // 更新记忆访问统计
  updateAccessStats(memory: Memory): Memory {
    return {
      ...memory,
      lastAccessed: new Date().toISOString(),
      accessCount: memory.accessCount + 1,
    }
  }
}
