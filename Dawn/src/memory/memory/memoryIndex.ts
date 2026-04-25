import { MemoryIndex, MemoryIndexEntry, MemoryType } from './memoryTypes'

export class MemoryIndexManager {
  private index: MemoryIndex

  constructor() {
    this.index = {
      version: '1.0',
      createdAt: new Date(),
      updatedAt: new Date(),
      entries: [],
    }
  }

  addEntry(type: string, path: string): void {
    const entry: MemoryIndexEntry = {
      id: `${type}-${Date.now()}`,
      type: type as any as MemoryType,
      path,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.index.entries.push(entry)
    this.index.updatedAt = new Date()
  }

  getEntriesByType(type: MemoryType): MemoryIndexEntry[] {
    return this.index.entries.filter(entry => entry.type === type)
  }

  getAllEntries(): MemoryIndexEntry[] {
    return this.index.entries
  }

  getIndex(): MemoryIndex {
    return this.index
  }
}
