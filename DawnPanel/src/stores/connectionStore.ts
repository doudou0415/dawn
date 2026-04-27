import { create } from 'zustand'
import type { ConnectionState, RequestStatus } from '../ipc/IpcBridge'

interface ConnectionStore {
  connectionState: ConnectionState
  queueLength: number
  stats: {
    totalRequests: number
    successfulRequests: number
    failedRequests: number
    timedOutRequests: number
    reconnections: number
  }
  recentRequests: Array<{
    id: string
    status: RequestStatus
    duration: number
    method: string
    timestamp: number
  }>
  setConnectionState: (state: ConnectionState) => void
  setQueueLength: (len: number) => void
  setStats: (stats: ConnectionStore['stats']) => void
  addRecentRequest: (req: ConnectionStore['recentRequests'][0]) => void
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connectionState: 'disconnected',
  queueLength: 0,
  stats: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timedOutRequests: 0,
    reconnections: 0,
  },
  recentRequests: [],

  setConnectionState: (state) => set({ connectionState: state }),
  setQueueLength: (len) => set({ queueLength: len }),
  setStats: (stats) => set({ stats }),
  addRecentRequest: (req) =>
    set((s) => ({
      recentRequests: [req, ...s.recentRequests].slice(0, 50),
    })),
}))
