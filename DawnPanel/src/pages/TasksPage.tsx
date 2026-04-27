/**
 * TasksPage — 任务/对话页面
 *
 * 融合对话界面与任务管理：
 * - 对话即任务，每个任务是一段对话
 * - 支持新建任务（清空对话）
 * - 输入框底部动态显示停止按钮
 * - 右侧可切换查看历史任务和定时任务
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

interface TaskRecord {
  id: string
  type: string
  description: string
  status: 'pending' | 'running' | 'success' | 'fail' | 'cancelled'
  createdAt: string
  completedAt?: string
  durationMs?: number
  result?: string
  error?: string
}

interface CronJob {
  id: string
  name: string
  description: string
  cronExpr: string
  command: string
  enabled: boolean
  lastRun?: string
  nextRun?: string
  runCount: number
  lastStatus?: 'success' | 'fail' | 'running'
}

export const TasksPage: React.FC = () => {
  const {
    messages, addMessage, isLoading, setLoading,
    activeNav, addLog, setSidePanel,
  } = useAppStore()
  const [input, setInput] = useState('')
  const msgEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 子标签: 'chat' | 'history' | 'cron'
  const [subTab, setSubTab] = useState<'chat' | 'history' | 'cron'>('chat')

  // 历史任务
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [taskFilter, setTaskFilter] = useState<string>('all')
  const [selectedTask, setSelectedTask] = useState<TaskRecord | null>(null)

  // 定时任务
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [showCronEditor, setShowCronEditor] = useState(false)
  const [editingCron, setEditingCron] = useState<Partial<CronJob> | null>(null)

  // 当前任务 ID（用于停止）
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)

  // 自动滚动
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 初始聚焦
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50)
    // 组件卸载时断开 WebSocket
    return () => {
      ipc.disconnectWs()
    }
  }, [])

  // ── 加载历史任务 ──
  const loadTasks = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ tasks: TaskRecord[] }>('tasks/list')
      setTasks(data.tasks ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (subTab === 'history') loadTasks()
  }, [subTab, loadTasks])

  // ── 加载定时任务 ──
  const loadCronJobs = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ jobs: CronJob[] }>('cron/list')
      setCronJobs(data.jobs ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (subTab === 'cron') loadCronJobs()
    const interval = setInterval(loadCronJobs, 15000)
    return () => clearInterval(interval)
  }, [subTab, loadCronJobs])

  // ── 发送消息（执行任务，支持实时日志） ──
  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    addMessage('user', text)
    addLog('info', `用户: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`)
    setLoading(true)

    // 连接 WebSocket 订阅实时日志
    ipc.connectWs(
      // 收到过程日志
      (level, logText) => {
        const levelMap: Record<string, 'info' | 'ok' | 'warn' | 'err'> = {
          info: 'info',
          ok: 'ok',
          warn: 'warn',
          err: 'err',
        }
        addLog(levelMap[level] || 'info', logText)
        // 同时将过程日志作为 assistant 消息追加展示（仅非 info 级别的重要步骤）
        if (level !== 'info') {
          addMessage('assistant', `> ${logText}`)
        }
      },
      // 任务完成回调（已通过 HTTP 响应处理，这里可忽略）
      () => {},
    )

    try {
      const data = await ipc.invoke<{
        response: string
        taskId?: string
        sidePanel?: any
      }>('runFullTask', text)
      addMessage('assistant', data.response)
      if (data.taskId) setCurrentTaskId(data.taskId)
      if (data.sidePanel) {
        setSidePanel({
          reviewScore: data.sidePanel.reviewScore ?? null,
          reviewIssues: data.sidePanel.reviewIssues ?? [],
          memoryEntities: data.sidePanel.memoryEntities ?? [],
          evolutionRecent: data.sidePanel.evolutionRecent ?? '',
          memoryContext: data.sidePanel.memoryContext ?? '',
        })
      }
      addLog('ok', 'Dawn 回复完成')
    } catch (error: any) {
      addMessage('assistant', `错误: ${error.message}\n\n> 请确保后端服务正在运行 (http://localhost:3458)`)
      addLog('err', `执行错误: ${error.message}`)
    } finally {
      setLoading(false)
      setCurrentTaskId(null)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  // ── 停止任务 ──
  const handleStop = async () => {
    try {
      if (currentTaskId) {
        await ipc.invoke<{ success: boolean }>('tasks/cancel', { id: currentTaskId })
      } else {
        await ipc.invoke<{ success: boolean }>('tasks/cancelCurrent')
      }
      addMessage('assistant', '⏹ 任务已停止')
      addLog('info', '任务已手动停止')
    } catch (err: any) {
      addLog('err', `停止失败: ${err.message}`)
    } finally {
      setLoading(false)
      setCurrentTaskId(null)
    }
  }

  // ── 新建任务（清空对话） ──
  const handleNewTask = () => {
    useAppStore.getState().clearMessages()
    addLog('info', '新建任务，对话已清空')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // ── 键盘事件 ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }

  return (
    <div className="main-area">
      {/* Status bar */}
      <div className="status-bar">
        <div className="status-item">
          <span className="status-dot online" />
          系统运行中
        </div>
        <div className="sub-tabs" style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          <span
            className={`sub-tab ${subTab === 'chat' ? 'active' : ''}`}
            onClick={() => setSubTab('chat')}
          >对话</span>
          <span
            className={`sub-tab ${subTab === 'history' ? 'active' : ''}`}
            onClick={() => { setSubTab('history'); loadTasks() }}
          >历史任务</span>
          <span
            className={`sub-tab ${subTab === 'cron' ? 'active' : ''}`}
            onClick={() => { setSubTab('cron'); loadCronJobs() }}
          >定时任务</span>
        </div>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={handleNewTask} style={{ marginRight: 8 }}>
          + 新建任务
        </button>
        <span className="warning-tag">✅ 权限已配置</span>
      </div>

      {/* ── 对话子标签 ── */}
      {subTab === 'chat' && (
        <>
          <div className="messages">
            {messages.length === 0 && (
              <div className="message message-assistant">
                <div className="message-header"><strong>Dawn</strong></div>
                <div className="message-content">
                  <p>你好！我是 Dawn，可以帮你完成各种任务。在下方输入你的需求开始新任务。</p>
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} {...msg} />
            ))}
            {isLoading && (
              <div className="message message-assistant">
                <div className="message-header"><strong>Dawn</strong></div>
                <div className="message-content">
                  <div className="thinking-dots"><span>.</span><span>.</span><span>.</span></div>
                </div>
              </div>
            )}
            <div ref={msgEndRef} />
          </div>

          {/* Input area */}
          <div className="input-area">
            <div className="input-row">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                disabled={isLoading}
              />
              {isLoading ? (
                <button className="btn-send btn-stop" onClick={handleStop}>
                  ⏹ 停止
                </button>
              ) : (
                <button className="btn-send" onClick={handleSend}>
                  发送
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── 历史任务子标签 ── */}
      {subTab === 'history' && (
        <div className="plugin-market" style={{ padding: '20px' }}>
          <div className="plugin-header">
            <h2>📌 历史任务</h2>
            <button className="btn" onClick={loadTasks}>刷新</button>
          </div>
          <div className="plugin-search">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['all', 'pending', 'running', 'success', 'fail', 'cancelled'].map(f => (
                <button
                  key={f}
                  className={`tab ${taskFilter === f ? 'active' : ''}`}
                  onClick={() => setTaskFilter(f)}
                  style={{ fontSize: 12, padding: '2px 10px' }}
                >
                  {f === 'all' ? '全部' : f === 'pending' ? '等待中' : f === 'running' ? '运行中' : f === 'success' ? '成功' : f === 'fail' ? '失败' : '已取消'}
                </button>
              ))}
            </div>
          </div>
          <div className="plugin-list">
            {tasks.filter(t => taskFilter === 'all' || t.status === taskFilter).length === 0 ? (
              <div className="empty-state">暂无任务记录。</div>
            ) : (
              tasks.filter(t => taskFilter === 'all' || t.status === taskFilter).map(task => (
                <div
                  key={task.id}
                  className={`plugin-card ${task.status === 'fail' || task.status === 'cancelled' ? 'disabled' : ''}`}
                  onClick={() => setSelectedTask(task)}
                >
                  <div className="plugin-info">
                    <div className="plugin-name-row">
                      <strong className="plugin-name">{task.type}: {task.description.slice(0, 50)}</strong>
                      <StatusBadge status={task.status} />
                      <span className="plugin-version">
                        {task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : ''}
                      </span>
                    </div>
                    <div className="plugin-desc">{task.description}</div>
                    <div className="plugin-meta">
                      <span>创建: {new Date(task.createdAt).toLocaleString()}</span>
                      {task.completedAt && <span>完成: {new Date(task.completedAt).toLocaleString()}</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedTask && (
            <div className="modal-overlay" onClick={() => setSelectedTask(null)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>任务详情</h3>
                  <button className="modal-close" onClick={() => setSelectedTask(null)}>×</button>
                </div>
                <div className="modal-body">
                  <p><strong>类型:</strong> {selectedTask.type}</p>
                  <p><strong>描述:</strong> {selectedTask.description}</p>
                  <p><strong>状态:</strong> {selectedTask.status}</p>
                  <p><strong>创建:</strong> {new Date(selectedTask.createdAt).toLocaleString()}</p>
                  {selectedTask.completedAt && <p><strong>完成:</strong> {new Date(selectedTask.completedAt).toLocaleString()}</p>}
                  {selectedTask.durationMs !== undefined && <p><strong>耗时:</strong> {(selectedTask.durationMs / 1000).toFixed(1)}s</p>}
                  {selectedTask.result && (
                    <div>
                      <strong>结果:</strong>
                      <pre style={{ background: 'var(--bg-tertiary)', padding: 8, borderRadius: 4, marginTop: 4, fontSize: 12 }}>{selectedTask.result}</pre>
                    </div>
                  )}
                  {selectedTask.error && (
                    <div>
                      <strong>错误:</strong>
                      <pre style={{ background: 'var(--danger-bg)', padding: 8, borderRadius: 4, marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>{selectedTask.error}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 定时任务子标签 ── */}
      {subTab === 'cron' && (
        <div className="plugin-market" style={{ padding: '20px' }}>
          <div className="plugin-header">
            <h2>⏰ 定时任务</h2>
            <button
              className="btn btn-primary"
              onClick={() => { setEditingCron({ enabled: true }); setShowCronEditor(true) }}
            >
              + 新建
            </button>
          </div>

          <div className="plugin-list">
            {cronJobs.length === 0 ? (
              <div className="empty-state">暂无定时任务。点击"新建"创建。</div>
            ) : (
              cronJobs.map(job => (
                <div key={job.id} className={`plugin-card ${job.enabled ? '' : 'disabled'}`}>
                  <div className="plugin-info">
                    <div className="plugin-name-row">
                      <strong className="plugin-name">{job.name}</strong>
                      <span className="plugin-version">{job.cronExpr}</span>
                      <span className={`plugin-badge ${job.enabled ? 'badge-enabled' : 'badge-disabled'}`}>
                        {job.enabled ? '运行中' : '已暂停'}
                      </span>
                    </div>
                    <div className="plugin-desc">{job.description || job.command.slice(0, 80)}</div>
                    <div className="plugin-meta">
                      <span>运行 {job.runCount} 次</span>
                      {job.lastRun && <span>上次: {new Date(job.lastRun).toLocaleString()}</span>}
                      {job.nextRun && <span>下次: {new Date(job.nextRun).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="plugin-actions">
                    <button className="btn btn-sm" onClick={() => handleCronRun(job.id, loadCronJobs, addLog)}>立即执行</button>
                    <button
                      className={`btn btn-sm ${job.enabled ? 'btn-warning' : 'btn-success'}`}
                      onClick={() => handleCronToggle(job.id, !job.enabled, setCronJobs, addLog)}
                    >
                      {job.enabled ? '暂停' : '恢复'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleCronDelete(job.id, loadCronJobs, addLog)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {showCronEditor && (
            <div className="modal-overlay" onClick={() => setShowCronEditor(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{editingCron?.id ? '编辑定时任务' : '新建定时任务'}</h3>
                  <button className="modal-close" onClick={() => setShowCronEditor(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div className="install-input">
                    <label>任务名称</label>
                    <input type="text" value={editingCron?.name ?? ''}
                      onChange={e => setEditingCron(p => ({ ...p, name: e.target.value }))}
                      placeholder="任务名称" />
                  </div>
                  <div className="install-input">
                    <label>Cron 表达式</label>
                    <input type="text" value={editingCron?.cronExpr ?? ''}
                      onChange={e => setEditingCron(p => ({ ...p, cronExpr: e.target.value }))}
                      placeholder="例如: 0 0 * * *, */5 * * * *" />
                    <small style={{ color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                      格式: 分 时 日 月 周
                    </small>
                  </div>
                  <div className="install-input">
                    <label>执行命令</label>
                    <textarea value={editingCron?.command ?? ''}
                      onChange={e => setEditingCron(p => ({ ...p, command: e.target.value }))}
                      placeholder="要执行的命令" rows={3} />
                  </div>
                  <div className="install-input">
                    <label>描述（可选）</label>
                    <input type="text" value={editingCron?.description ?? ''}
                      onChange={e => setEditingCron(p => ({ ...p, description: e.target.value }))}
                      placeholder="描述" />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowCronEditor(false)}>取消</button>
                  <button className="btn btn-primary" onClick={() =>
                    handleCronSave(editingCron, setCronJobs, setShowCronEditor, setEditingCron, addLog)
                  }
                    disabled={!editingCron?.name || !editingCron?.cronExpr || !editingCron?.command}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 子组件 ──

const StatusBadge: React.FC<{ status: TaskRecord['status'] }> = ({ status }) => {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: '', label: '等待中' },
    running: { cls: 'badge-enabled', label: '运行中' },
    success: { cls: 'badge-enabled', label: '成功' },
    fail: { cls: 'badge-disabled', label: '失败' },
    cancelled: { cls: 'badge-disabled', label: '已取消' },
  }
  const m = map[status]
  return <span className={`plugin-badge ${m.cls}`}>{m.label}</span>
}

const MessageBubble: React.FC<{
  role: 'user' | 'assistant'
  content: string
  meta?: { reviewScore?: number; executionTimeMs?: number }
}> = ({ role, content, meta }) => {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`message message-${role}`}>
      <div className="message-header">
        <strong>{role === 'user' ? '你' : 'Dawn'}</strong>
        <span className="message-time">{new Date().toLocaleTimeString()}</span>
      </div>
      <div className="message-content markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      {meta && (
        <div className="msg-meta">
          {meta.executionTimeMs && <span>⏱ {meta.executionTimeMs}ms</span>}
          {meta.reviewScore !== undefined && <span>评分: {meta.reviewScore}</span>}
        </div>
      )}
      {role === 'user' && (
        <div className="msg-copy-row" style={{ textAlign: 'right' }}>
          <button className={`msg-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      {role === 'assistant' && (
        <div className="msg-copy-row">
          <button className={`msg-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  )
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code.trim()}</code></pre>`
  )
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')
  return `<p>${html}</p>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Cron helper functions ──

function handleCronRun(id: string, loadCronJobs: () => void, addLog: any) {
  ipc.invoke<{ success: boolean }>('cron/run', { id }).then(() => {
    addLog('info', '定时任务已触发')
    setTimeout(loadCronJobs, 2000)
  }).catch((err: any) => addLog('err', `触发失败: ${err.message}`))
}

function handleCronToggle(
  id: string, enabled: boolean,
  setCronJobs: React.Dispatch<React.SetStateAction<CronJob[]>>,
  addLog: any,
) {
  ipc.invoke<{ success: boolean }>('cron/toggle', { id, enabled }).then(() => {
    setCronJobs(prev => prev.map(j => j.id === id ? { ...j, enabled } : j))
    addLog('info', `${enabled ? '启用' : '暂停'}定时任务`)
  }).catch((err: any) => addLog('err', `操作失败: ${err.message}`))
}

function handleCronDelete(id: string, loadCronJobs: () => void, addLog: any) {
  ipc.invoke<{ success: boolean }>('cron/delete', { id }).then(() => {
    loadCronJobs()
    addLog('info', '定时任务已删除')
  }).catch((err: any) => addLog('err', `删除失败: ${err.message}`))
}

function handleCronSave(
  editingCron: Partial<CronJob> | null,
  setCronJobs: React.Dispatch<React.SetStateAction<CronJob[]>>,
  setShowCronEditor: React.Dispatch<React.SetStateAction<boolean>>,
  setEditingCron: React.Dispatch<React.SetStateAction<Partial<CronJob> | null>>,
  addLog: any,
) {
  if (!editingCron?.name || !editingCron?.cronExpr || !editingCron?.command) return
  ipc.invoke<{ success: boolean; job?: CronJob }>('cron/save', editingCron).then(result => {
    if (result.success && result.job) {
      setCronJobs(prev => {
        const idx = prev.findIndex(j => j.id === result.job!.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = result.job!
          return next
        }
        return [...prev, result.job!]
      })
      addLog('ok', `定时任务已保存: ${result.job.name}`)
      setShowCronEditor(false)
      setEditingCron(null)
    }
  }).catch((err: any) => addLog('err', `保存失败: ${err.message}`))
}
