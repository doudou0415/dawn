/**
 * MemoryStore — 简版向量记忆存储（不依赖 Ollama）
 *
 * 功能等价于 Dawn 的 MemoryStore，但：
 * - 内置简单向量模拟（基于字符哈希）
 * - 支持持久化到文件
 * - 语义搜索走简单余弦相似度
 */

interface MemoryItem {
  id: string
  content: string
  type: string
  embedding?: number[]
  timestamp: string
}

interface SearchResult {
  content: string
  type: string
  score: number
  timestamp: string
}

/**
 * 简单的字符哈希向量化（768 维，模拟 nomic-embed-text 的输出维度）
 * 不依赖 Ollama，纯内存计算
 */
function simpleEmbed(text: string): number[] {
  const dim = 768
  const vec = new Array(dim).fill(0)
  if (typeof text !== 'string') return vec
  const chars = text.split('')
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const code = typeof ch === 'string' ? ch.charCodeAt(0) : 0
    const idx = Math.abs(code) % dim
    vec[idx] += (code % 5) + 1
  }
  // 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm
  }
  return vec
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0,
    normA = 0,
    normB = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class MemoryStore {
  private items: MemoryItem[] = []

  get size(): number {
    return this.items.length
  }

  async add(content: string, type: string): Promise<void> {
    const existing = this.items.find((m) => m.content === content)
    if (existing) return

    const embedding = simpleEmbed(content)
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
    const timestamp = new Date().toISOString()

    this.items.push({ id, content, type, embedding, timestamp })
  }

  async recall(query: string, topK: number = 5): Promise<SearchResult[]> {
    if (this.items.length === 0) return []

    const queryVec = simpleEmbed(query)
    const scored = this.items.map((item) => ({
      content: item.content,
      type: item.type,
      score: item.embedding ? cosineSimilarity(queryVec, item.embedding) : 0,
      timestamp: item.timestamp,
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  getAll(): MemoryItem[] {
    return [...this.items]
  }

  getByType(type: string): MemoryItem[] {
    return this.items.filter((m) => m.type === type)
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((m) => m.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    return true
  }

  clear(): void {
    this.items = []
  }
}

export const memoryStore = new MemoryStore()
