/**
 * DiscoverPage — 发现页面
 *
 * 探索新能力、推荐插件、系统建议。
 * 对应早期 DawnHub 原型的探索/推荐系统。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

interface Suggestion {
  id: string
  type: 'plugin' | 'capability' | 'optimization'
  title: string
  description: string
  confidence: number
  source: string
}

export const DiscoverPage: React.FC = () => {
  const { addLog } = useAppStore()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  const loadSuggestions = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ipc.invoke<{ suggestions: Suggestion[] }>('discover/suggestions')
      setSuggestions(data.suggestions ?? [])
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSuggestions()
  }, [loadSuggestions])

  const handleApply = async (suggestion: Suggestion) => {
    try {
      const result = await ipc.invoke<{ success: boolean; message: string }>('discover/apply', {
        id: suggestion.id,
        type: suggestion.type,
      })
      if (result.success) {
        addLog('ok', `已应用: ${suggestion.title}`)
        setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
      } else {
        addLog('warn', result.message || '应用失败')
      }
    } catch (err: any) {
      addLog('err', `应用失败: ${err.message}`)
    }
  }

  return (
    <div className="plugin-market">
      <div className="plugin-header">
        <h2>🔍 发现</h2>
        <button className="btn" onClick={loadSuggestions} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      <div className="plugin-list">
        {suggestions.length === 0 && !loading ? (
          <div className="empty-state">
            <p>暂无新发现。系统会基于你的使用习惯推荐插件和能力。</p>
            <button className="btn btn-primary" onClick={loadSuggestions} style={{ marginTop: 12 }}>
              立即扫描
            </button>
          </div>
        ) : loading ? (
          <div className="empty-state">分析中...</div>
        ) : (
          suggestions.map(s => (
            <div key={s.id} className="plugin-card">
              <div className="plugin-info">
                <div className="plugin-name-row">
                  <strong className="plugin-name">{s.title}</strong>
                  <span className={`plugin-badge ${s.type === 'plugin' ? 'badge-enabled' : s.type === 'capability' ? '' : ''}`}>
                    {s.type === 'plugin' ? '插件' : s.type === 'capability' ? '能力' : '优化'}
                  </span>
                </div>
                <div className="plugin-desc">{s.description}</div>
                <div className="plugin-meta">
                  <span>可信度: {(s.confidence * 100).toFixed(0)}%</span>
                  <span>来源: {s.source}</span>
                </div>
              </div>
              <div className="plugin-actions">
                <button className="btn btn-sm btn-primary" onClick={() => handleApply(s)}>
                  应用
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
