import React, { useRef, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { ipc } from '../DawnPanelApp'

const PAGES: Record<string, string> = {
  skills: '⚡ 技能中心 — 浏览和管理可用技能',
  evolution: '🔄 自进化 — 查看自进化仪表盘',
  plugins: '🧩 插件市场 — 管理已安装的插件',
  rules: '📋 规则管理 — 查看和编辑规则',
  cron: '⏰ 定时任务 — 查看和管理定时任务',
  discover: '🔍 发现 — 探索新能力',
  tasks: '📌 任务 — 查看历史任务',
}

export const MainArea: React.FC = () => {
  const {
    messages, addMessage, isLoading, setLoading,
    activeNav, addLog, setSidePanel,
  } = useAppStore()
  const [input, setInput] = React.useState('')
  const msgEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    addMessage('user', text)
    addLog('info', `用户: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`)
    setLoading(true)

    try {
      const data = await ipc.invoke<{ response: string; sidePanel?: any }>('runFullTask', text)
      addMessage('assistant', data.response)
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
      addMessage('assistant', `错误: ${error.message}\n\n> 请确保后端服务正在运行 (http://localhost:3457)`)
      addLog('err', `执行错误: ${error.message}`)
    } finally {
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

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
        <div className="spacer" />
        <span className="warning-tag">✅ 权限已配置</span>
      </div>

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && activeNav === 'skills' && (
          <div className="message message-assistant">
            <div className="message-header"><strong>Dawn</strong></div>
            <div className="message-content">
              <p>{PAGES[activeNav]}</p>
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
          <button className="btn-send" onClick={handleSend} disabled={isLoading}>
            {isLoading ? '思考中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
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
      <div className="msg-copy-row">
        <button className={`msg-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text)
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code.trim()}</code></pre>`
  )
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Lists
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  // Paragraphs
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
