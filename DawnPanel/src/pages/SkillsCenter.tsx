/**
 * SkillsCenter — 技能中心
 *
 * 展示已注册的能力列表，支持启用/禁用、查看详情。
 * 对应早期 DawnHub 原型的 capability 注册系统。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

interface Skill {
  name: string
  description: string
  version: string
  enabled: boolean
  category: string
  usageCount: number
  lastUsed?: string
}

export const SkillsCenter: React.FC = () => {
  const { addLog } = useAppStore()
  const [skills, setSkills] = useState<Skill[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  const loadSkills = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ skills: Skill[] }>('skills/list')
      setSkills(data.skills ?? [])
    } catch {
      setSkills([])
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await ipc.invoke<{ success: boolean }>('skills/toggle', { name, enabled })
      setSkills(prev => prev.map(s =>
        s.name === name ? { ...s, enabled } : s,
      ))
      addLog('info', `${enabled ? '启用' : '禁用'}技能: ${name}`)
    } catch (err: any) {
      addLog('err', `切换失败: ${err.message}`)
    }
  }

  const filtered = skills.filter(s =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="plugin-market">
      <div className="plugin-header">
        <h2>⚡ 技能中心</h2>
        <span className="badge">{skills.length} 个技能</span>
      </div>

      <div className="plugin-search">
        <input
          type="text"
          placeholder="搜索技能..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="plugin-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {skills.length === 0 ? '暂无可用技能。' : '没有匹配的技能。'}
          </div>
        ) : (
          filtered.map(skill => (
            <div
              key={skill.name}
              className={`plugin-card ${skill.enabled ? '' : 'disabled'} ${selectedSkill?.name === skill.name ? 'selected' : ''}`}
              onClick={() => setSelectedSkill(skill)}
            >
              <div className="plugin-info">
                <div className="plugin-name-row">
                  <strong className="plugin-name">{skill.name}</strong>
                  <span className="plugin-version">{skill.category}</span>
                  <span className={`plugin-badge ${skill.enabled ? 'badge-enabled' : 'badge-disabled'}`}>
                    {skill.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
                <div className="plugin-desc">{skill.description}</div>
                <div className="plugin-meta">
                  <span>版本: {skill.version}</span>
                  <span>使用: {skill.usageCount} 次</span>
                  {skill.lastUsed && <span>最近: {new Date(skill.lastUsed).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="plugin-actions">
                <button
                  className={`btn btn-sm ${skill.enabled ? 'btn-warning' : 'btn-success'}`}
                  onClick={e => { e.stopPropagation(); handleToggle(skill.name, !skill.enabled) }}
                >
                  {skill.enabled ? '禁用' : '启用'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedSkill && (
        <div className="modal-overlay" onClick={() => setSelectedSkill(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedSkill.name}</h3>
              <button className="modal-close" onClick={() => setSelectedSkill(null)}>×</button>
            </div>
            <div className="modal-body">
              <p><strong>类别:</strong> {selectedSkill.category}</p>
              <p><strong>版本:</strong> {selectedSkill.version}</p>
              <p><strong>描述:</strong> {selectedSkill.description}</p>
              <p><strong>使用次数:</strong> {selectedSkill.usageCount}</p>
              {selectedSkill.lastUsed && <p><strong>最后使用:</strong> {new Date(selectedSkill.lastUsed).toLocaleString()}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
