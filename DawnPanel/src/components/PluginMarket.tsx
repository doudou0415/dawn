/**
 * PluginMarket — 插件市场组件
 *
 * 功能：
 * - 显示已安装插件列表（本地 CapabilityRegistry 状态）
 * - 搜索可用插件
 * - 安装（本地路径 / git URL）
 * - 启用 / 禁用切换
 * - 卸载
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ipc } from '../DawnPanelApp'
import { useAppStore } from '../stores/appStore'

export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  capabilities: string[]   // 注册到 CapabilityRegistry 的能力名
  entry?: string           // .dawn-plugin 入口文件路径
}

export interface InstalledPlugin {
  manifest: PluginManifest
  enabled: boolean
  installedAt: string
  source: 'local' | 'git' | 'upload'
}

export const PluginMarket: React.FC = () => {
  const { addLog } = useAppStore()
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [installSource, setInstallSource] = useState<'local' | 'git'>('local')
  const [installPath, setInstallPath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 加载已安装插件列表
  const loadPlugins = useCallback(async () => {
    try {
      const data = await ipc.invoke<{ plugins: InstalledPlugin[] }>('plugins/list')
      setPlugins(data.plugins ?? [])
    } catch {
      // 后端可能还不支持该 API
      setPlugins([])
    }
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  // 安装插件
  const handleInstall = async () => {
    if (!installPath.trim()) return
    setInstalling(true)
    try {
      const result = await ipc.invoke<{ success: boolean; error?: string; plugin?: InstalledPlugin }>(
        'plugins/install',
        { source: installSource, path: installPath.trim() },
      )
      if (result.success && result.plugin) {
        setPlugins(prev => [...prev, result.plugin!])
        addLog('ok', `插件安装成功: ${result.plugin.manifest.name} v${result.plugin.manifest.version}`)
        setShowInstallDialog(false)
        setInstallPath('')
      } else {
        addLog('err', `安装失败: ${result.error ?? '未知错误'}`)
      }
    } catch (err: any) {
      addLog('err', `安装异常: ${err.message}`)
    } finally {
      setInstalling(false)
    }
  }

  // 切换启用/禁用
  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await ipc.invoke<{ success: boolean }>('plugins/toggle', { name, enabled })
      setPlugins(prev => prev.map(p =>
        p.manifest.name === name ? { ...p, enabled } : p,
      ))
      addLog('info', `${enabled ? '启用' : '禁用'}插件: ${name}`)
    } catch (err: any) {
      addLog('err', `切换失败: ${err.message}`)
    }
  }

  // 卸载插件
  const handleUninstall = async (name: string) => {
    try {
      await ipc.invoke<{ success: boolean }>('plugins/uninstall', { name })
      setPlugins(prev => prev.filter(p => p.manifest.name !== name))
      addLog('info', `插件已卸载: ${name}`)
    } catch (err: any) {
      addLog('err', `卸载失败: ${err.message}`)
    }
  }

  const filtered = plugins.filter(p =>
    !searchQuery || p.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="plugin-market">
      <div className="plugin-header">
        <h2>插件市场</h2>
        <button className="btn btn-primary" onClick={() => setShowInstallDialog(true)}>
          + 安装插件
        </button>
      </div>

      {/* 搜索 */}
      <div className="plugin-search">
        <input
          type="text"
          placeholder="搜索插件..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {/* 已安装列表 */}
      <div className="plugin-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {plugins.length === 0
              ? '暂无已安装的插件。点击"+ 安装插件"开始。'
              : '没有匹配的插件。'}
          </div>
        ) : (
          filtered.map(plugin => (
            <div key={plugin.manifest.name} className={`plugin-card ${plugin.enabled ? '' : 'disabled'}`}>
              <div className="plugin-info">
                <div className="plugin-name-row">
                  <strong className="plugin-name">{plugin.manifest.name}</strong>
                  <span className="plugin-version">v{plugin.manifest.version}</span>
                  <span className={`plugin-badge ${plugin.enabled ? 'badge-enabled' : 'badge-disabled'}`}>
                    {plugin.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
                <div className="plugin-desc">{plugin.manifest.description}</div>
                <div className="plugin-meta">
                  {plugin.manifest.author && <span>作者: {plugin.manifest.author}</span>}
                  <span>来源: {plugin.source}</span>
                  <span>能力: {plugin.manifest.capabilities.join(', ')}</span>
                </div>
              </div>
              <div className="plugin-actions">
                <button
                  className={`btn btn-sm ${plugin.enabled ? 'btn-warning' : 'btn-success'}`}
                  onClick={() => handleToggle(plugin.manifest.name, !plugin.enabled)}
                >
                  {plugin.enabled ? '禁用' : '启用'}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleUninstall(plugin.manifest.name)}
                >
                  卸载
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 安装对话框 */}
      {showInstallDialog && (
        <div className="modal-overlay" onClick={() => setShowInstallDialog(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>安装插件</h3>
              <button className="modal-close" onClick={() => setShowInstallDialog(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="install-tabs">
                <button
                  className={`tab ${installSource === 'local' ? 'active' : ''}`}
                  onClick={() => setInstallSource('local')}
                >
                  本地路径
                </button>
                <button
                  className={`tab ${installSource === 'git' ? 'active' : ''}`}
                  onClick={() => setInstallSource('git')}
                >
                  Git URL
                </button>
              </div>
              <div className="install-input">
                <label>{installSource === 'local' ? '.dawn-plugin 目录路径' : 'Git 仓库 URL'}</label>
                <input
                  type="text"
                  value={installPath}
                  onChange={e => setInstallPath(e.target.value)}
                  placeholder={installSource === 'local'
                    ? '例如: D:/plugins/my-plugin.dawn-plugin'
                    : '例如: https://github.com/user/dawn-plugin.git'}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowInstallDialog(false)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={handleInstall}
                disabled={installing || !installPath.trim()}
              >
                {installing ? '安装中...' : '安装'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
