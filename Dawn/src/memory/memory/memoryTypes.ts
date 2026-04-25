export type MemoryType = 'user' | 'project' | 'feedback' | 'reference'

export interface MemoryIndexEntry {
  id: string
  type: MemoryType
  path: string
  createdAt: Date
  updatedAt: Date
}

export interface MemoryIndex {
  version: string
  createdAt: Date
  updatedAt: Date
  entries: MemoryIndexEntry[]
}
