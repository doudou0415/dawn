import React from 'react'

export const AboutPanel: React.FC = () => {
  return (
    <div className="main-area" style={{ padding: '20px', overflowY: 'auto' }}>
      <h2 style={{ fontSize: '18px', color: '#f0f6fc', marginBottom: '16px' }}>关于 Dawn</h2>
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: '8px', padding: '20px', fontSize: '13px', lineHeight: 1.8 }}>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ color: '#8b949e' }}>版本：</span>
          <span style={{ color: '#c9d1d9' }}>2.0.0</span>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ color: '#8b949e' }}>前端框架：</span>
          <span style={{ color: '#c9d1d9' }}>React 19 + Zustand 5 + TanStack Query 5 + Vite 6</span>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ color: '#8b949e' }}>通信层：</span>
          <span style={{ color: '#c9d1d9' }}>IpcBridge（心跳 + 自动重连 + 请求队列 + 状态回执）</span>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ color: '#8b949e' }}>核心引擎：</span>
          <span style={{ color: '#c9d1d9' }}>Dawn Engine（TypeScript / Bun）</span>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <span style={{ color: '#8b949e' }}>架构：</span>
          <span style={{ color: '#c9d1d9' }}>能力热插拔 + 三层记忆 + 自进化引擎 + 只读沙箱</span>
        </div>
        <div>
          <span style={{ color: '#8b949e' }}>许可证：</span>
          <span style={{ color: '#c9d1d9' }}>MIT</span>
        </div>
      </div>
    </div>
  )
}
