import React from 'react'
import { useAppStore } from '../stores/appStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useThemeStore } from '../stores/themeStore'

const NAV_ITEMS = [
  { key: 'tasks', icon: '💬', label: '任务' },
  { key: 'evolution', icon: '🔄', label: '审查与进化' },
  { key: 'skills', icon: '⚡', label: '技能中心' },
  { key: 'rules', icon: '📋', label: '规则管理' },
  { key: 'plugins', icon: '🧩', label: '插件市场' },
  { key: 'discover', icon: '🔍', label: '发现' },
  { key: 'settings', icon: '⚙️', label: '设置' },
]

export const Sidebar: React.FC = () => {
  const { activeNav, setActiveNav, logs, clearLogs, addLog } = useAppStore()
  const connectionState = useConnectionStore((s) => s.connectionState)
  const queueLength = useConnectionStore((s) => s.queueLength)
  const { theme, toggleTheme } = useThemeStore()
  const logEndRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="left-sidebar">
      {/* Identity */}
      <div className="sidebar-top">
        <div className="sidebar-identity">
          <div className="avatar" style={{ background: 'linear-gradient(135deg, var(--success), var(--blue))' }}>U</div>
          <div className="info">
            <div className="name">你 <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(我)</span></div>
            <div className="tagline">用户 · 右侧操作</div>
          </div>
        </div>
        <div className="connection-status">
          <span className={`status-dot ${connectionState === 'connected' ? 'online' : connectionState === 'reconnecting' ? 'warning' : 'offline'}`} />
          <span className="status-text">
            {connectionState === 'connected' ? '已连接' :
             connectionState === 'reconnecting' ? `重连中...` :
             connectionState === 'heartbeat_lost' ? '心跳丢失' : '未连接'}
          </span>
          {queueLength > 0 && <span className="queue-badge">{queueLength}</span>}
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            className={`nav-item ${activeNav === item.key ? 'active' : ''}`}
            onClick={() => {
              setActiveNav(item.key)
              addLog('info', `切换到: ${item.label}`)
            }}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Theme toggle */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={toggleTheme}
          style={{
            flex: 1, padding: '4px 8px', background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)', border: '1px solid var(--border-color)',
            borderRadius: 4, cursor: 'pointer', fontSize: 11,
          }}
        >
          {theme === 'dark' ? '☀️ 亮色模式' : '🌙 暗色模式'}
        </button>
      </div>

      {/* Work log */}
      <div className="sidebar-log">
        <div className="log-header">
          <span>工作日志</span>
          <span
            style={{ fontSize: '10px', color: 'var(--danger)', cursor: 'pointer' }}
            onClick={clearLogs}
          >
            清空
          </span>
        </div>
        <div className="log-body" id="log-body">
          {logs.map((log, i) => (
            <div key={i} className={`log-entry log-${log.level}`}>
              <span className="log-time">[{log.time}]</span>
              {log.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
