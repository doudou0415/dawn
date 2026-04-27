/**
 * RulesManager — 规则管理
 *
 * 展示和管理 Dawn 运行规则，包括自定义规则、约束条件。
 * 对应早期 DawnHub 原型的规则/约束系统。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

interface Rule {
  id: string
  name: string
  description: string
  pattern: string
  action: 'allow' | 'deny' | 'warn'
  enabled: boolean
  priority: number
  createdAt: string
}

export const RulesManager: React.FC = () => {
  const { addLog } = useAppStore()
  const [rules, setRules] = useState<Rule[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<Partial<Rule> | null>(null)

  const loadRules = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ rules: Rule[] }>('rules/list')
      setRules(data.rules ?? [])
    } catch {
      setRules([])
    }
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await ipc.invoke<{ success: boolean }>('rules/toggle', { id, enabled })
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r))
      addLog('info', `${enabled ? '启用' : '禁用'}规则: ${rules.find(r => r.id === id)?.name}`)
    } catch (err: any) {
      addLog('err', `操作失败: ${err.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await ipc.invoke<{ success: boolean }>('rules/delete', { id })
      setRules(prev => prev.filter(r => r.id !== id))
      addLog('info', `规则已删除`)
    } catch (err: any) {
      addLog('err', `删除失败: ${err.message}`)
    }
  }

  const handleSave = async () => {
    if (!editingRule?.name) return
    try {
      const result = await ipc.invoke<{ success: boolean; rule?: Rule }>('rules/save', editingRule)
      if (result.success && result.rule) {
        setRules(prev => {
          const idx = prev.findIndex(r => r.id === result.rule!.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = result.rule!
            return next
          }
          return [...prev, result.rule!]
        })
        addLog('ok', `规则已保存: ${result.rule.name}`)
        setShowEditor(false)
        setEditingRule(null)
      }
    } catch (err: any) {
      addLog('err', `保存失败: ${err.message}`)
    }
  }

  const filtered = rules.filter(r =>
    !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="plugin-market">
      <div className="plugin-header">
        <h2>📋 规则管理</h2>
        <button className="btn btn-primary" onClick={() => { setEditingRule({ enabled: true, priority: 0, action: 'allow' }); setShowEditor(true) }}>
          + 新建规则
        </button>
      </div>

      <div className="plugin-search">
        <input
          type="text"
          placeholder="搜索规则..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="plugin-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {rules.length === 0 ? '暂无规则。点击"新建规则"添加。' : '没有匹配的规则。'}
          </div>
        ) : (
          filtered.map(rule => (
            <div key={rule.id} className={`plugin-card ${rule.enabled ? '' : 'disabled'}`}>
              <div className="plugin-info">
                <div className="plugin-name-row">
                  <strong className="plugin-name">{rule.name}</strong>
                  <span className={`plugin-badge ${rule.action === 'allow' ? 'badge-enabled' : rule.action === 'deny' ? 'badge-disabled' : ''}`}>
                    {rule.action === 'allow' ? '允许' : rule.action === 'deny' ? '拒绝' : '警告'}
                  </span>
                  <span className="plugin-version">优先级 {rule.priority}</span>
                </div>
                <div className="plugin-desc">{rule.description}</div>
                <div className="plugin-meta">
                  <span>匹配: <code>{rule.pattern}</code></span>
                  <span>创建: {new Date(rule.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="plugin-actions">
                <button
                  className={`btn btn-sm ${rule.enabled ? 'btn-warning' : 'btn-success'}`}
                  onClick={() => handleToggle(rule.id, !rule.enabled)}
                >
                  {rule.enabled ? '禁用' : '启用'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(rule.id)}>
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showEditor && (
        <div className="modal-overlay" onClick={() => setShowEditor(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingRule?.id ? '编辑规则' : '新建规则'}</h3>
              <button className="modal-close" onClick={() => setShowEditor(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="install-input">
                <label>规则名称</label>
                <input type="text" value={editingRule?.name ?? ''}
                  onChange={e => setEditingRule(p => ({ ...p, name: e.target.value }))}
                  placeholder="规则名称" />
              </div>
              <div className="install-input">
                <label>描述</label>
                <textarea value={editingRule?.description ?? ''}
                  onChange={e => setEditingRule(p => ({ ...p, description: e.target.value }))}
                  placeholder="规则描述" rows={2} />
              </div>
              <div className="install-input">
                <label>匹配模式</label>
                <input type="text" value={editingRule?.pattern ?? ''}
                  onChange={e => setEditingRule(p => ({ ...p, pattern: e.target.value }))}
                  placeholder="例如: *.exe, /tmp/*" />
              </div>
              <div className="install-input">
                <label>动作</label>
                <select value={editingRule?.action ?? 'allow'}
                  onChange={e => setEditingRule(p => ({ ...p, action: e.target.value as Rule['action'] }))}>
                  <option value="allow">允许</option>
                  <option value="deny">拒绝</option>
                  <option value="warn">警告</option>
                </select>
              </div>
              <div className="install-input">
                <label>优先级（数字越大优先级越高）</label>
                <input type="number" value={editingRule?.priority ?? 0}
                  onChange={e => setEditingRule(p => ({ ...p, priority: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowEditor(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!editingRule?.name}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
