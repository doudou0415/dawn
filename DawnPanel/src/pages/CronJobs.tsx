/**
 * CronJobs — 定时任务管理
 *
 * 展示和管理定时任务，支持创建、编辑、暂停、删除。
 * 对应早期 DawnHub 原型的定时任务/调度系统。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

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

export const CronJobs: React.FC = () => {
  const { addLog } = useAppStore()
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [showEditor, setShowEditor] = useState(false)
  const [editingJob, setEditingJob] = useState<Partial<CronJob> | null>(null)

  const loadJobs = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ jobs: CronJob[] }>('cron/list')
      setJobs(data.jobs ?? [])
    } catch {
      setJobs([])
    }
  }, [])

  useEffect(() => {
    loadJobs()
    const interval = setInterval(loadJobs, 15000)
    return () => clearInterval(interval)
  }, [loadJobs])

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await ipc.invoke<{ success: boolean }>('cron/toggle', { id, enabled })
      setJobs(prev => prev.map(j => j.id === id ? { ...j, enabled } : j))
      addLog('info', `${enabled ? '启用' : '暂停'}定时任务: ${jobs.find(j => j.id === id)?.name}`)
    } catch (err: any) {
      addLog('err', `操作失败: ${err.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await ipc.invoke<{ success: boolean }>('cron/delete', { id })
      setJobs(prev => prev.filter(j => j.id !== id))
      addLog('info', '定时任务已删除')
    } catch (err: any) {
      addLog('err', `删除失败: ${err.message}`)
    }
  }

  const handleRunNow = async (id: string) => {
    try {
      await ipc.invoke<{ success: boolean }>('cron/run', { id })
      addLog('info', '定时任务已触发')
      setTimeout(loadJobs, 2000)
    } catch (err: any) {
      addLog('err', `触发失败: ${err.message}`)
    }
  }

  const handleSave = async () => {
    if (!editingJob?.name || !editingJob?.cronExpr || !editingJob?.command) return
    try {
      const result = await ipc.invoke<{ success: boolean; job?: CronJob }>('cron/save', editingJob)
      if (result.success && result.job) {
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === result.job!.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = result.job!
            return next
          }
          return [...prev, result.job!]
        })
        addLog('ok', `定时任务已保存: ${result.job.name}`)
        setShowEditor(false)
        setEditingJob(null)
      }
    } catch (err: any) {
      addLog('err', `保存失败: ${err.message}`)
    }
  }

  const getStatusIcon = (job: CronJob) => {
    if (job.lastStatus === 'running') return '🔄'
    if (job.lastStatus === 'fail') return '❌'
    if (job.lastStatus === 'success') return '✅'
    return '⏳'
  }

  return (
    <div className="plugin-market">
      <div className="plugin-header">
        <h2>⏰ 定时任务</h2>
        <button className="btn btn-primary" onClick={() => { setEditingJob({ enabled: true }); setShowEditor(true) }}>
          + 新建任务
        </button>
      </div>

      <div className="plugin-list">
        {jobs.length === 0 ? (
          <div className="empty-state">暂无定时任务。点击"新建任务"创建。</div>
        ) : (
          jobs.map(job => (
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
                  <span>{getStatusIcon(job)} 运行 {job.runCount} 次</span>
                  {job.lastRun && <span>上次: {new Date(job.lastRun).toLocaleString()}</span>}
                  {job.nextRun && <span>下次: {new Date(job.nextRun).toLocaleString()}</span>}
                </div>
              </div>
              <div className="plugin-actions">
                <button className="btn btn-sm" onClick={() => handleRunNow(job.id)}>立即执行</button>
                <button
                  className={`btn btn-sm ${job.enabled ? 'btn-warning' : 'btn-success'}`}
                  onClick={() => handleToggle(job.id, !job.enabled)}
                >
                  {job.enabled ? '暂停' : '恢复'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(job.id)}>删除</button>
              </div>
            </div>
          ))
        )}
      </div>

      {showEditor && (
        <div className="modal-overlay" onClick={() => setShowEditor(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingJob?.id ? '编辑定时任务' : '新建定时任务'}</h3>
              <button className="modal-close" onClick={() => setShowEditor(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="install-input">
                <label>任务名称</label>
                <input type="text" value={editingJob?.name ?? ''}
                  onChange={e => setEditingJob(p => ({ ...p, name: e.target.value }))}
                  placeholder="任务名称" />
              </div>
              <div className="install-input">
                <label>Cron 表达式</label>
                <input type="text" value={editingJob?.cronExpr ?? ''}
                  onChange={e => setEditingJob(p => ({ ...p, cronExpr: e.target.value }))}
                  placeholder="例如: 0 0 * * *, */5 * * * *" />
                <small style={{ color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                  格式: 分 时 日 月 周
                </small>
              </div>
              <div className="install-input">
                <label>执行命令</label>
                <textarea value={editingJob?.command ?? ''}
                  onChange={e => setEditingJob(p => ({ ...p, command: e.target.value }))}
                  placeholder="要执行的命令" rows={3} />
              </div>
              <div className="install-input">
                <label>描述（可选）</label>
                <input type="text" value={editingJob?.description ?? ''}
                  onChange={e => setEditingJob(p => ({ ...p, description: e.target.value }))}
                  placeholder="描述" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowEditor(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSave}
                disabled={!editingJob?.name || !editingJob?.cronExpr || !editingJob?.command}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
