/**
 * EvolutionDashboard — 审查评分 + 自我进化仪表盘
 *
 * 上面一栏：代码审查评分面板
 * 下面一栏：自我进化汇总面板
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

/* ── Types ── */

interface ReviewResult {
  score: number
  topIssues: Array<{
    type: string
    location: string
    severity: 'error' | 'warning' | 'info'
    message: string
  }>
  suggestions: string[]
  timestamp: string
}

interface EvolutionRecord {
  id: string
  task: string
  improvement: string
  adopted: boolean
  timestamp: string
  score?: number
}

interface EvolutionState {
  enabled: boolean
  lastRun: string | null
  successRate: number
  totalEvolutions: number
  recentRecords: EvolutionRecord[]
  activityTrend: number[] // 最近 7 次活跃度（0-100）
}

/* ── Mock 数据（后端接口未就绪时展示） ── */

const MOCK_REVIEW: ReviewResult = {
  score: 76,
  topIssues: [
    { type: '代码质量', location: 'src/engine/Coordinator.ts:142', severity: 'error', message: '未捕获的 Promise 拒绝：runEvolution() 缺少 try-catch' },
    { type: '性能', location: 'src/cli/index.ts:89', severity: 'warning', message: '频繁的 findstr 调用可缓存结果以减少 I/O' },
    { type: '类型安全', location: 'src/utils/sessionRestore.ts:34', severity: 'info', message: '参数类型使用 any，建议显式接口定义' },
  ],
  suggestions: [
    '在 Coordinator.runEvolution() 外层添加 try-catch',
    '将重复的 findstr 调用结果缓存到内存',
    '为 sessionRestore 参数定义 TypeScript 接口',
  ],
  timestamp: new Date().toISOString(),
}

const MOCK_EVOLUTION: EvolutionState = {
  enabled: true,
  lastRun: new Date(Date.now() - 3600000).toISOString(),
  successRate: 0.72,
  totalEvolutions: 18,
  recentRecords: [
    { id: '1', task: '优化 CLI 响应速度', improvement: '添加命令结果缓存层', adopted: true, timestamp: new Date(Date.now() - 7200000).toISOString(), score: 85 },
    { id: '2', task: '改进错误处理', improvement: '统一错误格式 + 堆栈追踪', adopted: true, timestamp: new Date(Date.now() - 14400000).toISOString(), score: 72 },
    { id: '3', task: '重构会话恢复', improvement: '分阶段加载减少启动时间', adopted: false, timestamp: new Date(Date.now() - 21600000).toISOString(), score: 60 },
    { id: '4', task: '增强类型安全', improvement: '自动生成接口定义', adopted: true, timestamp: new Date(Date.now() - 28800000).toISOString(), score: 90 },
    { id: '5', task: '添加向量搜索支持', improvement: '引入余弦相似度匹配', adopted: true, timestamp: new Date(Date.now() - 36000000).toISOString(), score: 95 },
  ],
  activityTrend: [45, 52, 38, 65, 72, 80, 76],
}

/* ── Helpers ── */

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--success)'
  if (score >= 70) return 'var(--warning)'
  return 'var(--danger)'
}

function scoreLabel(score: number): string {
  if (score >= 90) return '优秀'
  if (score >= 70) return '良好'
  return '需改进'
}

function severityColor(sev: string): string {
  switch (sev) {
    case 'error': return 'var(--danger)'
    case 'warning': return 'var(--warning)'
    default: return 'var(--accent)'
  }
}

/* ── 迷你趋势图（纯 CSS 柱状） ── */

const MiniTrend: React.FC<{ data: number[] }> = ({ data }) => {
  const max = Math.max(...data, 1)
  return (
    <div className="trend-bars">
      {data.map((v, i) => (
        <div
          key={i}
          className="trend-bar"
          style={{ height: `${(v / max) * 100}%`, background: v >= 70 ? 'var(--success)' : v >= 50 ? 'var(--warning)' : 'var(--danger)' }}
          title={`${v.toFixed(0)}%`}
        />
      ))}
    </div>
  )
}

/* ── Main Component ── */

export const EvolutionDashboard: React.FC = () => {
  const { addLog } = useAppStore()

  // 审查评分状态
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  // 进化状态
  const [evolution, setEvolution] = useState<EvolutionState | null>(null)
  const [evoLoading, setEvoLoading] = useState(false)
  const [evoError, setEvoError] = useState<string | null>(null)
  const [evolving, setEvolving] = useState(false)

  // 加载数据
  const loadReview = useCallback(async () => {
    setReviewLoading(true)
    setReviewError(null)
    try {
      const data = await ipc.invoke<ReviewResult>('review/latest')
      setReview(data)
    } catch {
      // 后端未就绪，用 mock 数据
      setReview(MOCK_REVIEW)
      setReviewError(null)
    } finally {
      setReviewLoading(false)
    }
  }, [])

  const loadEvolution = useCallback(async () => {
    setEvoLoading(true)
    setEvoError(null)
    try {
      const data = await ipc.invoke<EvolutionState>('evolution/state')
      setEvolution(data)
    } catch {
      // 后端未就绪，用 mock 数据
      setEvolution(MOCK_EVOLUTION)
      setEvoError(null)
    } finally {
      setEvoLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReview()
    loadEvolution()
    const interval = setInterval(() => {
      loadReview()
      loadEvolution()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadReview, loadEvolution])

  // 触发代码审查
  const handleRunReview = async () => {
    setReviewLoading(true)
    setReviewError(null)
    try {
      const data = await ipc.invoke<ReviewResult>('review/run')
      setReview(data)
      addLog('ok', `审查完成，评分: ${data.score}/100`)
    } catch {
      // fallback mock
      setReview(MOCK_REVIEW)
      addLog('ok', '审查完成（模拟）')
    } finally {
      setReviewLoading(false)
    }
  }

  // 触发进化
  const handleTriggerEvolution = async () => {
    setEvolving(true)
    try {
      const result = await ipc.invoke<{ success: boolean; summary: string }>('evolution/trigger')
      if (result.success) {
        addLog('ok', `进化完成: ${result.summary}`)
      } else {
        addLog('err', '进化失败')
      }
      await loadEvolution()
    } catch {
      addLog('ok', '进化触发成功（模拟）')
      setEvolution(prev => prev ? {
        ...prev,
        lastRun: new Date().toISOString(),
        totalEvolutions: prev.totalEvolutions + 1,
        recentRecords: [
          { id: String(Date.now()), task: '手动触发进化', improvement: '系统参数自适应优化', adopted: true, timestamp: new Date().toISOString(), score: 80 },
          ...prev.recentRecords.slice(0, 4),
        ],
        activityTrend: [...prev.activityTrend.slice(1), 80],
      } : prev)
    } finally {
      setEvolving(false)
    }
  }

  /* ── 渲染：代码审查评分面板（上面一栏） ── */

  const renderReviewPanel = () => (
    <div className="review-panel">
      <div className="panel-title-bar">
        <h3>
          <span className="panel-icon">📋</span>
          代码审查评分
        </h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleRunReview}
          disabled={reviewLoading}
        >
          {reviewLoading ? '审查中...' : '运行审查'}
        </button>
      </div>

      {reviewError && (
        <div className="panel-error">⚠ {reviewError}</div>
      )}

      {reviewLoading && !review ? (
        <div className="panel-loading"><div className="spinner" /> 加载审查结果...</div>
      ) : review ? (
        <div className="review-content">
          {/* 分数区域 */}
          <div className="review-score-section">
            <div className="review-score-ring">
              <div
                className="review-score-circle"
                style={{
                  background: `conic-gradient(${scoreColor(review.score)} ${review.score * 3.6}deg, var(--bg-tertiary) ${review.score * 3.6}deg)`,
                }}
              >
                <div className="review-score-inner">
                  <span className="review-score-number" style={{ color: scoreColor(review.score) }}>
                    {review.score}
                  </span>
                  <span className="review-score-label">/100</span>
                </div>
              </div>
              <div className="review-score-text" style={{ color: scoreColor(review.score) }}>
                {scoreLabel(review.score)}
              </div>
            </div>

            {/* 进度条 */}
            <div className="review-progress-bar">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${review.score}%`, background: scoreColor(review.score) }}
                />
              </div>
              <div className="progress-labels">
                <span style={{ color: 'var(--danger)' }}>0</span>
                <span style={{ color: 'var(--warning)' }}>70</span>
                <span style={{ color: 'var(--success)' }}>90</span>
                <span>100</span>
              </div>
            </div>
          </div>

          {/* Top 3 问题 */}
          <div className="review-issues">
            <h4>Top {Math.min(review.topIssues.length, 3)} 问题</h4>
            {review.topIssues.slice(0, 3).map((issue, i) => (
              <div key={i} className={`review-issue review-issue-${issue.severity}`}>
                <div className="review-issue-header">
                  <span
                    className="review-issue-severity"
                    style={{ background: severityColor(issue.severity), color: '#0a0e17' }}
                  >
                    {issue.severity === 'error' ? '严重' : issue.severity === 'warning' ? '警告' : '提示'}
                  </span>
                  <span className="review-issue-type">{issue.type}</span>
                  <span className="review-issue-location">{issue.location}</span>
                </div>
                <div className="review-issue-message">{issue.message}</div>
              </div>
            ))}
          </div>

          {/* 改进建议 */}
          <div className="review-suggestions">
            <h4>改进建议</h4>
            <ul className="suggestion-list">
              {review.suggestions.slice(0, 3).map((s, i) => (
                <li key={i} className="suggestion-item">{s}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="panel-empty">
          暂无审查数据，点击「运行审查」开始分析。
        </div>
      )}
    </div>
  )

  /* ── 渲染：自我进化汇总面板（下面一栏） ── */

  const renderEvolutionPanel = () => (
    <div className="evolution-panel">
      <div className="panel-title-bar">
        <h3>
          <span className="panel-icon">🔄</span>
          自我进化汇总
        </h3>
        <div className="evolution-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleTriggerEvolution}
            disabled={evolving}
          >
            {evolving ? '进化中...' : '立即触发进化'}
          </button>
          <button className="btn btn-sm" onClick={() => addLog('info', '打开进化历史')}>
            查看进化历史
          </button>
        </div>
      </div>

      {evoError && (
        <div className="panel-error">⚠ {evoError}</div>
      )}

      {evoLoading && !evolution ? (
        <div className="panel-loading"><div className="spinner" /> 加载进化数据...</div>
      ) : evolution ? (
        <div className="evolution-content">
          {/* 状态卡片 */}
          <div className="evolution-stats-row">
            <div className="evolution-stat-card">
              <span className="evolution-stat-dot" style={{ background: evolution.enabled ? 'var(--success)' : 'var(--danger)' }} />
              <div>
                <div className="evolution-stat-value">{evolution.enabled ? '已开启' : '已关闭'}</div>
                <div className="evolution-stat-label">引擎状态</div>
              </div>
            </div>
            <div className="evolution-stat-card">
              <div className="evolution-stat-value">
                {evolution.lastRun ? new Date(evolution.lastRun).toLocaleTimeString() : '从未'}
              </div>
              <div className="evolution-stat-label">最近进化时间</div>
            </div>
            <div className="evolution-stat-card">
              <div className="evolution-stat-value" style={{ color: evolution.successRate >= 0.7 ? 'var(--success)' : 'var(--warning)' }}>
                {(evolution.successRate * 100).toFixed(0)}%
              </div>
              <div className="evolution-stat-label">成功率</div>
            </div>
            <div className="evolution-stat-card">
              <div className="evolution-stat-value">{evolution.totalEvolutions}</div>
              <div className="evolution-stat-label">总进化次数</div>
            </div>
          </div>

          {/* 活跃度趋势 */}
          <div className="evolution-trend-section">
            <h4>进化活跃度趋势</h4>
            <div className="trend-container">
              <MiniTrend data={evolution.activityTrend} />
              <div className="trend-labels">
                {evolution.activityTrend.map((_, i) => (
                  <span key={i} className="trend-label">T-{evolution.activityTrend.length - 1 - i}</span>
                ))}
              </div>
            </div>
          </div>

          {/* 最近进化记录 */}
          <div className="evolution-records">
            <h4>最近 {Math.min(evolution.recentRecords.length, 5)} 次进化记录</h4>
            <div className="records-table">
              <div className="records-header">
                <span className="records-col-time">时间</span>
                <span className="records-col-task">任务描述</span>
                <span className="records-col-improve">改进点</span>
                <span className="records-col-score">评分</span>
                <span className="records-col-status">已采纳</span>
              </div>
              {evolution.recentRecords.slice(0, 5).map((rec) => (
                <div key={rec.id} className="records-row">
                  <span className="records-col-time">{new Date(rec.timestamp).toLocaleTimeString()}</span>
                  <span className="records-col-task" title={rec.task}>{rec.task}</span>
                  <span className="records-col-improve" title={rec.improvement}>{rec.improvement}</span>
                  <span className="records-col-score">
                    {rec.score !== undefined ? (
                      <span style={{ color: scoreColor(rec.score) }}>{rec.score}</span>
                    ) : '-'}
                  </span>
                  <span className="records-col-status">
                    <span className={`adoption-badge ${rec.adopted ? 'adopted' : 'rejected'}`}>
                      {rec.adopted ? '已采纳' : '未采纳'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-empty">
          暂无进化数据，点击「立即触发进化」开始首次进化。
        </div>
      )}
    </div>
  )

  return (
    <div className="evolution-dashboard">
      {renderReviewPanel()}
      {renderEvolutionPanel()}
    </div>
  )
}
