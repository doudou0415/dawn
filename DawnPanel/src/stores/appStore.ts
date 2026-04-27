import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  meta?: {
    reviewScore?: number
    executionTimeMs?: number
  }
}

export interface LogEntry {
  time: string
  text: string
  level: 'info' | 'warn' | 'err' | 'ok'
}

interface SidePanelData {
  reviewScore: number | null
  reviewIssues: Array<{ severity: string; message: string }>
  memoryEntities: Array<{ key: string; value: string }>
  evolutionSummary: string
  memoryContext: string
  evolutionRecent: string
}

interface MemoryState {
  sessionCount: number
  persistentCount: number
  skillCount: number
}

interface AppState {
  // Messages
  messages: Message[]
  addMessage: (role: Message['role'], content: string, meta?: Message['meta']) => void
  clearMessages: () => void

  // Loading
  isLoading: boolean
  setLoading: (v: boolean) => void

  // Logs
  logs: LogEntry[]
  addLog: (level: LogEntry['level'], text: string) => void
  clearLogs: () => void

  // Side panel
  sidePanel: SidePanelData
  setSidePanel: (data: Partial<SidePanelData>) => void

  // Memory state
  memoryState: MemoryState
  setMemoryState: (data: Partial<MemoryState>) => void

  // Permission
  permissionLevel: number
  setPermissionLevel: (level: number) => void

  // Navigation
  activeNav: string
  setActiveNav: (nav: string) => void

  // Evolution dashboard
  evolutionData: string[]
  setEvolutionData: (data: string[]) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  messages: [],
  addMessage: (role, content, meta) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: crypto.randomUUID(), role, content, timestamp: Date.now(), meta },
      ],
    })),
  clearMessages: () => set({ messages: [] }),

  isLoading: false,
  setLoading: (v) => set({ isLoading: v }),

  logs: [],
  addLog: (level, text) =>
    set((s) => {
      const entry: LogEntry = { time: new Date().toLocaleTimeString(), text, level }
      const logs = [...s.logs, entry]
      if (logs.length > 200) logs.shift()
      return { logs }
    }),
  clearLogs: () => set({ logs: [] }),

  sidePanel: {
    reviewScore: null,
    reviewIssues: [],
    memoryEntities: [],
    evolutionSummary: '',
    memoryContext: '',
    evolutionRecent: '',
  },
  setSidePanel: (data) =>
    set((s) => ({ sidePanel: { ...s.sidePanel, ...data } })),

  memoryState: { sessionCount: 0, persistentCount: 0, skillCount: 0 },
  setMemoryState: (data) =>
    set((s) => ({ memoryState: { ...s.memoryState, ...data } })),

  permissionLevel: 3,
  setPermissionLevel: (level) => set({ permissionLevel: level }),

  activeNav: 'tasks',
  setActiveNav: (nav) => set({ activeNav: nav }),

  evolutionData: [],
  setEvolutionData: (data) => set({ evolutionData: data }),
}))

// Note: Direct API calls are deprecated in favor of IpcBridge (src/ipc/IpcBridge.ts).
// All components should use `ipc.invoke()` from DawnPanelApp or the useApi hooks.
