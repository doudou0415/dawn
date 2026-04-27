import React, { useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { SidePanel } from './components/SidePanel'
import { PluginMarket } from './components/PluginMarket'
import { AboutPanel } from './components/AboutPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SkillsCenter } from './pages/SkillsCenter'
import { RulesManager } from './pages/RulesManager'
import { DiscoverPage } from './pages/DiscoverPage'
import { TasksPage } from './pages/TasksPage'
import { EvolutionDashboard } from './pages/EvolutionDashboard'
import { IpcBridge } from './ipc/IpcBridge'
import { useConnectionStore } from './stores/connectionStore'
import { useAppStore } from './stores/appStore'

// 全局单例
export const ipc = new IpcBridge({
  baseUrl: 'http://localhost:3457',
  heartbeatInterval: 5000,
  requestTimeout: 30000,
  maxRetries: 3,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  heartbeatLostThreshold: 3,
})

const App: React.FC = () => {
  const setConnectionState = useConnectionStore((s) => s.setConnectionState)
  const setStats = useConnectionStore((s) => s.setStats)
  const addRecentRequest = useConnectionStore((s) => s.addRecentRequest)
  const initialized = useRef(false)
  const activeNav = useAppStore((s) => s.activeNav)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // 注册事件监听
    const unsub1 = ipc.on('connectionChange', (state) => {
      setConnectionState(state)
    })

    const unsub2 = ipc.on('requestComplete', (id, status, duration) => {
      addRecentRequest({ id, status, duration, method: '', timestamp: Date.now() })
      setStats({
        totalRequests: ipc.stats.totalRequests,
        successfulRequests: ipc.stats.successfulRequests,
        failedRequests: ipc.stats.failedRequests,
        timedOutRequests: ipc.stats.timedOutRequests,
        reconnections: ipc.stats.reconnections,
      })
    })

    const unsub3 = ipc.on('reconnecting', (attempt) => {
      setConnectionState('reconnecting')
    })

    // 立即同步初始状态
    setConnectionState(ipc.getConnectionState())

    // 启动连接（HTTP 心跳）
    ipc.connect()

    // 启动 WebSocket（实时日志推送）
    ipc.connectWs()

    // 定期同步 IpcBridge 内部状态到 zustand store（兜底）
    async function syncState() {
      try {
        const actualState = ipc.getConnectionState()
        const { useConnectionStore: store } = await import('./stores/connectionStore')
        const currentStoreState = store.getState().connectionState
        if (currentStoreState !== actualState) {
          store.getState().setConnectionState(actualState)
        }
      } catch { /* 容错 */ }
    }
    const syncTimer = setInterval(syncState, 3000)
    syncState() // 立即执行一次

    return () => {
      clearInterval(syncTimer)
      unsub1()
      unsub2()
      unsub3()
      ipc.disconnectWs()
      ipc.disconnect()
    }
  }, [setConnectionState, setStats, addRecentRequest])

  return (
    <div className="app-container">
      <Sidebar />
      <ErrorBoundary>
        {activeNav === 'evolution' ? (
          <EvolutionDashboard />
        ) : activeNav === 'tasks' ? (
          <TasksPage />
        ) : activeNav === 'skills' ? (
          <SkillsCenter />
        ) : activeNav === 'rules' ? (
          <RulesManager />
        ) : activeNav === 'plugins' ? (
          <PluginMarket />
        ) : activeNav === 'discover' ? (
          <DiscoverPage />
        ) : activeNav === 'settings' ? (
          <AboutPanel />
        ) : (
          <TasksPage />
        )}
      </ErrorBoundary>
      <SidePanel />
    </div>
  )
}

export default App
