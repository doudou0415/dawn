import React, { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { useMemoryState, useContextState } from '../hooks/useApi'
import { ipc } from '../DawnPanelApp'

export const SidePanel: React.FC = () => {
  const { sidePanel, permissionLevel, setPermissionLevel } = useAppStore()
  const { data: memoryData } = useMemoryState() as { data: any }
  const { data: contextData } = useContextState() as { data: any }

  return (
    <div className="side-panel" id="side-panel">
      {/* Review Score */}
      <PanelSection title="审查评分" defaultOpen>
        <div className="score-large" id="review-score">
          {sidePanel.reviewScore != null ? (
            <>
              <span
                className="score-number"
                style={{
                  color:
                    sidePanel.reviewScore >= 90
                      ? '#4ade80'
                      : sidePanel.reviewScore >= 70
                        ? '#f59e0b'
                        : '#ef4444',
                }}
              >
                {sidePanel.reviewScore}
              </span>
              <span style={{ fontSize: '14px', color: '#888' }}>/100</span>
            </>
          ) : (
            <>
              <span className="score-number" style={{ color: 'var(--text-muted)' }}>
                --
              </span>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>/100</span>
            </>
          )}
        </div>
        {sidePanel.reviewIssues.length > 0 && (
          <div id="review-issues">
            {sidePanel.reviewIssues.map((issue, i) => (
              <div key={i} className={`issue ${issue.severity}`}>
                {issue.message}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      {/* Self Evolution Summary */}
      <PanelSection title="自我进化汇总" defaultOpen>
        <div id="evolution-summary">
          {sidePanel.evolutionRecent ? (
            sidePanel.evolutionRecent.split('\n').filter(Boolean).map((line, i) => (
              <div key={i} className="evo-item">{line}</div>
            ))
          ) : (
            <span className="empty-state">暂无数据</span>
          )}
        </div>
        <div id="memory-state" style={{ marginTop: '8px' }}>
          {contextData && (
            <>
              {contextData.totalTasks != null && (
                <div className="mem-item">
                  <span className="mem-key">任务分析</span>
                  <span className="mem-val">{contextData.totalTasks}</span>
                </div>
              )}
              {contextData.totalIterations != null && (
                <div className="mem-item">
                  <span className="mem-key">迭代次数</span>
                  <span className="mem-val">{contextData.totalIterations}</span>
                </div>
              )}
            </>
          )}
          {memoryData && (
            <>
              <div className="mem-item">
                <span className="mem-key">会话数</span>
                <span className="mem-val">{memoryData.sessionCount ?? 0}</span>
              </div>
              <div className="mem-item">
                <span className="mem-key">持久记忆</span>
                <span className="mem-val">{memoryData.persistentCount ?? 0}</span>
              </div>
              {memoryData.skillCount != null && (
                <div className="mem-item">
                  <span className="mem-key">技能数</span>
                  <span className="mem-val">{memoryData.skillCount}</span>
                </div>
              )}
            </>
          )}
        </div>
      </PanelSection>

      {/* Permission Level */}
      <PanelSection title="权限等级" defaultOpen>
        <div className="setting-row">
          <label>级别</label>
          <select
            value={permissionLevel}
            onChange={async (e) => {
              const level = parseInt(e.target.value, 10)
              setPermissionLevel(level)
              // 同步到 IpcBridge，后续所有请求自动带上 X-Permission-Level 头
              ipc.permissionLevel = level
              // 直接发 fetch 到后端 permission API
              // （不用 ipc.invoke 因为 IpcBridge 对 permission 序列化格式不匹配）
              try {
                await fetch('http://localhost:3458/api/permission', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ level }),
                })
              } catch (err) {
                console.error('设置权限失败:', err)
              }
            }}
          >
            <option value={1}>只读模式 (plan)</option>
            <option value={2}>标准模式 (default)</option>
            <option value={3}>编码模式 (acceptEdits)</option>
            <option value={4}>自动模式 (auto)</option>
            <option value={5}>全部自动 (bypass)</option>
          </select>
        </div>
      </PanelSection>

      {/* Model Config */}
      <PanelSection title="模型配置" defaultOpen>
        <div className="setting-row">
          <label>模型</label>
          <select defaultValue="deepseek-v4">
            <option value="deepseek-v4">deepseek-v4 (默认)</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="claude-sonnet">Claude Sonnet</option>
          </select>
        </div>
      </PanelSection>

      {/* Guardrails */}
      <PanelSection title="模型护栏 & 白名单" defaultOpen>
        <div style={{ marginBottom: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            白名单目录
          </div>
          <span className="guard-chip">Dawn</span>
          <span className="guard-chip">Dawn</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          所有写入操作经过 CodeModifyValidator 校验
        </div>
      </PanelSection>
    </div>
  )
}

/** Collapsible panel section */
const PanelSection: React.FC<{
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}> = ({ title, defaultOpen, children }) => {
  const [open, setOpen] = React.useState(defaultOpen ?? true)

  return (
    <div className="panel-section">
      <div
        className="panel-collapse-header"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      >
        <h3>{title}</h3>
        <span className={`arrow ${open ? 'open' : ''}`}>▶</span>
      </div>
      <div
        className="panel-collapse-body"
        style={{ maxHeight: open ? '500px' : '0', opacity: open ? 1 : 0 }}
      >
        <div className="panel-body-inner">{children}</div>
      </div>
    </div>
  )
}
