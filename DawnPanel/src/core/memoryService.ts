/**
 * 记忆服务 — 关键词 + 语义混合检索
 *
 * - getRelevantMemories(query): 先做语义搜索（向量），回退到关键词加权匹配
 * - 自动标注匹配来源（semantic / keyword / both）
 * - 在回复里体现"根据你的偏好/刚才的记忆..."
 */

import { memoryStore } from './memoryStore.js'

export interface MemoryMatch {
  content: string
  type: string
  score: number
  timestamp: string
  matchMethod: 'semantic' | 'keyword' | 'both'
}

let store: any = null
let isInitialized = false

async function getStore() {
  if (!store) {
    store = memoryStore
  }
  // 只在第一次调用时从文件加载持久记忆
  if (!isInitialized) {
    isInitialized = true
    try {
      const fs = await import('fs/promises')
      const { join } = await import('path')
      const data = JSON.parse(
        await fs.readFile(join(process.cwd(), 'memory', 'persistent.json'), 'utf-8'),
      )
      for (const item of data) {
        if (item.value?.task) {
          await store.add(item.value.task, 'code_generation')
        }
      }
      console.log(`[MemoryService] 已加载 ${data.length} 条持久记忆`)
    } catch (e: any) {
      console.log(`[MemoryService] 无持久记忆文件或加载失败: ${e.message}`)
    }
  }
  return store
}

/**
 * 获取与查询最相关的记忆
 * - 先尝试语义搜索
 * - 回退到关键词加权匹配
 * - 合并结果去重
 */
export async function getRelevantMemories(
  query: string,
  topK: number = 3,
  minScore: number = 0.05,
): Promise<MemoryMatch[]> {
  const s = await getStore()
  const results: MemoryMatch[] = []
  const seen = new Set<string>()

  // 1. 语义搜索
  try {
    const semanticResults = await s.recall(query, topK * 2)
    for (const r of semanticResults) {
      if (r.score >= minScore) {
        seen.add(r.content)
        results.push({
          content: r.content,
          type: r.type,
          score: r.score,
          timestamp: r.timestamp,
          matchMethod: 'semantic',
        })
      }
    }
  } catch (_) {
    // semantic search unavailable
  }

  // 2. 关键词加权匹配（全量扫描，确保冷启动也能命中）
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)

  if (queryWords.length > 0) {
    const allItems = s.getAll()
    for (const item of allItems) {
      const content = item.content.toLowerCase()
      let matchCount = 0
      for (const word of queryWords) {
        if (content.includes(word)) matchCount++
      }
      const keywordScore = queryWords.length > 0 ? matchCount / queryWords.length : 0
      if (keywordScore >= 0.2) {
        if (seen.has(item.content)) {
          // 标记为 both
          const existing = results.find((r) => r.content === item.content)
          if (existing) {
            existing.matchMethod = 'both'
            existing.score = Math.max(existing.score, keywordScore)
          }
        } else {
          results.push({
            content: item.content,
            type: item.type,
            score: keywordScore,
            timestamp: item.timestamp,
            matchMethod: 'keyword',
          })
          seen.add(item.content)
        }
      }
    }
  }

  // 3. 按分数排序，取 topK
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

/**
 * 将记忆摘要格式化为字符串，供回复时引用
 */
export function formatMemoryContext(memories: MemoryMatch[]): string {
  if (memories.length === 0) return ''
  const lines = memories.map((m, i) => {
    const source = m.matchMethod === 'semantic' ? '语义' : m.matchMethod === 'keyword' ? '关键词' : '语义+关键词'
    return `${i + 1}. [${source} ${(m.score * 100).toFixed(0)}%] ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`
  })
  return `\n[记忆参考]\n${lines.join('\n')}`
}
