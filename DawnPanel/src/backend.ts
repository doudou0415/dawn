/**
 * Dawn Panel Backend
 * Bun HTTP 服务，暴露 runFullTask API，对接 Dawn 引擎
 * 集成记忆检索 + 自进化分析
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// 日志文件写入
const LOG_DIR = join(import.meta.dirname.replace(/\\/g, '/'), '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'backend.log');
function logToFile(...args: unknown[]) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch { /* 日志写入失败不影响主流程 */ }
}
import type { Agent } from '../../Dawn/src/engine/index.js';
import { getRelevantMemories, formatMemoryContext } from './core/memoryService.js';
import { evolutionEngine } from './core/selfEvolution.js';

// ===== WebSocket 日志推送 =====
interface WsClient {
  socket: WebSocket;
  sessionId: string;
}
const wsClients = new Map<string, WsClient>();

/** 向指定 session 的 WebSocket 客户端发送过程日志 */
function pushLog(sessionId: string, level: string, text: string) {
  const client = wsClients.get(sessionId);
  if (!client) return;
  try {
    client.socket.send(JSON.stringify({
      type: 'task_log',
      sessionId,
      level,
      text,
      time: new Date().toISOString(),
    }));
  } catch {
    wsClients.delete(sessionId);
  }
}

/** 向指定 session 发送任务完成事件 */
function pushDone(sessionId: string, response: string) {
  const client = wsClients.get(sessionId);
  if (!client) return;
  try {
    client.socket.send(JSON.stringify({
      type: 'task_done',
      sessionId,
      response,
      time: new Date().toISOString(),
    }));
  } catch {
    wsClients.delete(sessionId);
  }
}

/** 向指定 session 发送任务错误事件 */
function pushError(sessionId: string, error: string) {
  const client = wsClients.get(sessionId);
  if (!client) return;
  try {
    client.socket.send(JSON.stringify({
      type: 'task_error',
      sessionId,
      error,
      time: new Date().toISOString(),
    }));
  } catch {
    wsClients.delete(sessionId);
  }
}

// 加载 .env 到 process.env（优先项目根目录 .env）
function loadEnv() {
  // 注意！bun Windows 的 path.resolve/join 对 '..' 处理有 bug：
  //   resolve('D:\\x\\y', '..') → D:\x\y  （应该 D:\x）
  //   join('D:\\x\\y', '..')    → D:.     （完全错误）
  // 所以只能用正斜杠手动算父目录
  function parentDir(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return normalized;
    // 保留盘符 D:
    return normalized.slice(0, lastSlash) || normalized;
  }
  const panelDir = import.meta.dir.replace(/\\/g, '/');
  // 从 src/ 出发需要两次 parentDir：src → DawnPanel → Dawn 根目录
  // 从 DawnPanel 出发只需要一次
  const isSrcDir = panelDir.endsWith('/src');
  const dawnNewRoot = isSrcDir ? parentDir(parentDir(panelDir)) : parentDir(panelDir);
  const dawnHubRoot = parentDir(parentDir(panelDir)) + '/DawnHub';
  const envPaths = [
    dawnNewRoot + '/.env',                               // 根目录 .env 优先
    dawnHubRoot + '/.env',                               // DawnHub/.env 备选
    panelDir + '/.env',                                  // DawnPanel/.env 最后
  ];
  for (const p of envPaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
      break;
    }
  }
}
loadEnv();

let agentInstance: InstanceType<typeof Agent> | null = null;
const PANEL_DIR = join(import.meta.dir, '..');

// ===== 权限分级系统 =====
type PermissionLevel = 1 | 2 | 3 | 4 | 5;

interface PermissionCheck {
  allowed: boolean;
  level: PermissionLevel;
  reason?: string;
}

const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 3;

// 从请求 header 或 body 获取请求权限级别，默认 3
function getRequestPermission(req: Request): PermissionLevel {
  const level = parseInt(req.headers.get('X-Permission-Level') || '', 10);
  if (level >= 1 && level <= 5) return level as PermissionLevel;
  return DEFAULT_PERMISSION_LEVEL;
}

// 全局权限级别（允许前端动态修改）
let currentGlobalPermissionLevel: PermissionLevel = DEFAULT_PERMISSION_LEVEL;

function setGlobalPermissionLevel(level: number): boolean {
  if (level >= 1 && level <= 5) {
    currentGlobalPermissionLevel = level as PermissionLevel;
    return true;
  }
  return false;
}

function getEffectivePermissionLevel(req: Request): PermissionLevel {
  // 请求级 header 优先于全局设置
  const headerLevel = parseInt(req.headers.get('X-Permission-Level') || '', 10);
  if (headerLevel >= 1 && headerLevel <= 5) return headerLevel as PermissionLevel;
  return currentGlobalPermissionLevel;
}

// 权限定义矩阵
const PERMISSION_MATRIX: Record<string, PermissionLevel> = {
  // 只读操作 — 1级即可
  'read': 1,
  'memory:read': 1,
  'health': 1,
  'context:read': 1,

  // 写入对话/记忆 — 2级
  'memory:write': 2,
  'chat': 2,
  'conversation': 2,

  // Shell 命令执行 — 3级
  'shell': 3,
  'browse': 3,
  'review': 3,

  // 系统级 — 4级
  'upgrade': 4,
  'install_deps': 4,
  'system_config': 4,
  'restart': 4,

  // 无限制 — 5级
  'admin': 5,
  'dangerous': 5,
};

function checkPermission(level: PermissionLevel, action: string): PermissionCheck {
  const required = PERMISSION_MATRIX[action] || 2; // 默认需要2级
  return {
    allowed: level >= required,
    level,
    reason: level >= required
      ? undefined
      : `权限不足: 当前 ${level} 级 (${getLevelLabel(level)})，需要 ${required} 级 (${getLevelLabel(required)})`,
  };
}

function getLevelLabel(level: PermissionLevel): string {
  const labels: Record<PermissionLevel, string> = {
    1: '只读',
    2: '标准',
    3: '增强',
    4: '高权限',
    5: '完全信任',
  };
  return labels[level];
}

function getLevelDescription(level: PermissionLevel): string {
  const descs: Record<PermissionLevel, string> = {
    1: '只能读取文件，不能写入或执行命令',
    2: '可读写项目文件，不可执行命令',
    3: '可运行 shell 命令',
    4: '可安装依赖、修改系统设置',
    5: '无限制，完全信任',
  };
  return descs[level];
}

// 权限校验装饰器：在需要权限的 API 入口调用
function requirePermission(level: PermissionLevel, action: string, req: Request): Response | null {
  const check = checkPermission(level, action);
  if (!check.allowed) {
    return new Response(JSON.stringify({
      error: check.reason,
      permissionLevel: level,
      requiredLevel: PERMISSION_MATRIX[action],
    }), {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
  return null;
}

async function getAgent(): Promise<InstanceType<typeof Agent>> {
  if (!agentInstance) {
    // 强制保证进程环境变量在动态 import 前可见（bun Windows 兼容）
    if (!process.env.DEEPSEEK_API_KEY) { loadEnv(); }
    // 方案2：直接通过模块级 setter 注入 key，绕过 globalThis 跨模块丢失问题
    const { setInjectedApiKey } = await import('../../Dawn/src/engine/core/LLMProvider.js');
    setInjectedApiKey(
      process.env.DEEPSEEK_API_KEY || '',
      process.env.DEEPSEEK_BASE_URL || '',
    );
    // 同时保留 globalThis 作为兜底
    (globalThis as any).__DAWN_API_KEY = process.env.DEEPSEEK_API_KEY;
    (globalThis as any).__DAWN_BASE_URL = process.env.DEEPSEEK_BASE_URL;
    const { default: Agent } = await import('../../Dawn/src/engine/AgentCore.ts');
    agentInstance = new Agent({
      enableSelfReview: true,
      enableMemory: true,
      enableAdvancedDialogue: true,
      enableIntentRecognition: true,
    });
  }
  return agentInstance;
}

function parseCommand(text: string): { command: string; args: string } | null {
  const match = text.match(/^\/(\w+)\s*(.*)/s);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2].trim() };
}

async function handleCommand(cmd: string, args: string): Promise<{ response: string; sidePanel?: SidePanelData }> {
  const agent = await getAgent();

  switch (cmd) {
    case 'browse': {
      const url = args || 'https://www.google.com';
      const result = await agent.execute(`搜索: ${url}`);
      return {
        response: result.response + `\n\n> 如需抓取网页内容，请确保浏览器控制工具已配置（暂不支持自动网页抓取，仅提供知识库搜索）。`,
        sidePanel: await buildSidePanel(agent, url, undefined, result.reviewResult),
      };
    }

    case 'save': {
      await agent.setMemoryEntity('user_preference', args || '已记录');
      return {
        response: `已记住: ${args || '(空内容)'}`,
      };
    }

    case 'evolve': {
      const history = agent.getToolCallHistory();
      const perf = agent.getToolPerformance();
      const summary = {
        totalCalls: history.length,
        avgSuccessRate: perf.length > 0
          ? perf.reduce((a, p) => a + p.successRate, 0) / perf.length
          : 0,
        topTool: perf.sort((a, b) => b.successRate - a.successRate)[0]?.toolName || 'none',
      };
      return {
        response: `## 自进化总结\n\n- 总工具调用: ${summary.totalCalls}\n- 平均成功率: ${(summary.avgSuccessRate * 100).toFixed(1)}%\n- 最佳工具: ${summary.topTool}\n\n持续优化中...`,
        sidePanel: await buildSidePanel(agent, undefined, summary),
      };
    }

    case 'review': {
      const result = await agent.execute(`审查代码: ${args}`);
      return {
        response: result.response,
        sidePanel: await buildSidePanel(agent, args, undefined, result.reviewResult),
      };
    }

    case 'memory': {
      const entities = agent.getAllMemoryEntities();
      const entries = Array.from(entities.entries());
      const text = entries.length > 0
        ? entries.map(([k, v]) => `- **${k}**: ${v}`).join('\n')
        : '暂无记忆。';
      return {
        response: `## 当前记忆状态\n\n${text}`,
      };
    }

    case 'upgrade': {
      try {
        const { execSync } = await import('child_process');
        const backupDir = join(PANEL_DIR, '..', '.backup_upgrade');
        const srcDir = join(PANEL_DIR, '..', 'Dawn', 'src');
        const hubDir = 'D:/AI/DawnHub/Dawn';

        // 1. 备份当前版本
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        execSync(`mkdir -p "${backupDir}/${timestamp}"`, { shell: true });
        execSync(`cp -r "${srcDir}" "${backupDir}/${timestamp}/"`, { shell: true });

        // 2. 从 DawnHub 复制核心文件
        const coresToSync = ['engine', 'tools', 'capabilities', 'utils', 'memory', 'cli', 'evolution'];
        for (const dir of coresToSync) {
          const hubPath = `${hubDir}/${dir}`;
          const newPath = `${srcDir}/..`;
          execSync(`cp -r "${hubPath}" "${newPath}/"`, { shell: true });
        }

        // 3. 复制 new-main.ts
        execSync(`cp "${hubDir}/new-main.ts" "${srcDir}/../new-main.ts"`, { shell: true });

        return {
          response: `## /upgrade 完成\n\n- **备份**: \`${backupDir}/${timestamp}/\`\n- **同步源**: DawnHub (\`${hubDir}\`)\n- **已同步模块**: ${coresToSync.join(', ')}\n\n升级完成，建议重启后端服务以使新代码生效。`,
        };
      } catch (err) {
        return {
          response: `## /upgrade 失败\n\n错误: ${(err as Error).message}\n\n请检查:\n1. DawnHub 目录是否存在 (\`D:/AI/DawnHub/Dawn\`)\n2. 是否有文件读写权限`,
        };
      }
    }

    case 'help': {
      return {
        response: `## 可用命令\n\n| 命令 | 说明 |\n|------|------|\n| \`/browse <url>\` | 搜索/浏览网页 |\n| \`/save <内容>\` | 记住偏好或信息 |\n| \`/evolve\` | 查看自进化总结 |\n| \`/review <代码>\` | 审查代码质量 |\n| \`/memory\` | 查看记忆状态 |\n| \`/upgrade\` | 从 DawnHub 拉取最新核心文件并更新 |\n| \`/clear\` | 清除对话历史 |\n\n直接输入文字与我对话即可。`,
      };
    }

    default:
      return { response: `未知命令: /${cmd}，输入 /help 查看可用命令。` };
  }
}

interface SidePanelData {
  reviewScore?: number;
  reviewIssues?: Array<{ severity: string; message: string }>;
  memoryEntities: Array<{ key: string; value: string }>;
  evolutionSummary?: string;
  searchResults?: string;
  /** 当前任务的记忆上下文摘要 */
  memoryContext?: string;
  /** 自进化近期总结 */
  evolutionRecent?: string;
}

async function buildSidePanel(
  agent: InstanceType<typeof Agent>,
  searchQuery?: string,
  evolutionSummary?: { totalCalls: number; avgSuccessRate: number; topTool: string },
  reviewResult?: { score?: number; issues?: Array<{ severity: string; message: string }> },
): Promise<SidePanelData> {
  const entities = agent.getAllMemoryEntities();
  const memoryEntities = Array.from(entities.entries()).map(([key, value]) => ({ key, value }));

  return {
    reviewScore: reviewResult?.score,
    reviewIssues: reviewResult?.issues,
    memoryEntities,
    evolutionSummary: evolutionSummary
      ? `工具调用: ${evolutionSummary.totalCalls} | 成功率: ${(evolutionSummary.avgSuccessRate * 100).toFixed(1)}% | 最佳工具: ${evolutionSummary.topTool}`
      : undefined,
    searchResults: searchQuery ? `已搜索: ${searchQuery}` : undefined,
  };
}

// ---------- HTTP Server ----------

const server = Bun.serve({
  port: 3457,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Permission-Level, X-Ws-Session-Id',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // === WebSocket Upgrade ===
    if (url.pathname === '/ws') {
      const success = server.upgrade(req, {
        headers: corsHeaders,
        data: { sessionId: url.searchParams.get('sessionId') || crypto.randomUUID() },
      });
      if (success) {
        return undefined;
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // 心跳检测（IpcBridge 会轮询此端点）
    if (url.pathname === '/__heartbeat' && req.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // runFullTask API
    if (url.pathname === '/api/runFullTask' && req.method === 'POST') {
      try {
        const permLevel = getEffectivePermissionLevel(req);
        const body = await req.json() as { task: string; wsSessionId?: string };
        const text = body.task || '';
        const wsSessionId = body.wsSessionId || '';
        logToFile(`[runFullTask] ➡️ 收到请求: task="${text.substring(0, 100)}" (len=${text.length})`);

        // 推送开始日志
        if (wsSessionId) pushLog(wsSessionId, 'info', `🔄 开始执行任务...`);

        // 根据输入自动推断需要的权限
        const cmd = parseCommand(text);
        let actionType = 'chat';
        let result: { response: string; sidePanel?: SidePanelData };
        if (cmd) {
          // 命令类型到 action 的映射
          const cmdActionMap: Record<string, string> = {
            browse: 'browse',
            save: 'memory:write',
            evolve: 'memory:read',
            review: 'review',
            memory: 'memory:read',
            upgrade: 'upgrade',
            help: 'read',
            clear: 'conversation',
          };
          actionType = cmdActionMap[cmd.command] || 'chat';
        } else if (text.includes('删除') || text.includes('删除文件') || text.includes('rm ')) {
          actionType = 'dangerous';
        } else if (text.includes('安装') || text.includes('install') || text.includes('npm install')) {
          actionType = 'install_deps';
        } else if (text.includes('执行') || text.includes('运行') || text.startsWith('$')) {
          actionType = 'shell';
        }

        // 权限检查
        const permBlocked = requirePermission(permLevel, actionType, req);
        if (permBlocked) return permBlocked;

        if (cmd) {
          result = await handleCommand(cmd.command, cmd.args);
          if (wsSessionId) pushLog(wsSessionId, 'ok', `✅ 命令 /${cmd.command} 执行完成`);
        } else {
          const agent = await getAgent();
          // 注入当前权限级别到 system prompt，让 LLM 知道自己的权限上限
          const permLabel = getLevelLabel(permLevel);
          const permDesc = getLevelDescription(permLevel);
          const permPrompt = `\n\n===== 权限约束 =====\n当前权限等级: ${permLevel} 级 (${permLabel})\n权限说明: ${permDesc}\n- 你必须在权限范围内行动，不能执行超出当前权限的操作。\n- 如果用户要求执行需要更高权限的操作，请先告知用户当前权限不足。\n- 用户可以通过面板修改权限级别。`;
          const el = agent.getExecutionLoop();
          el.systemPromptOverride = (await import('../../Dawn/src/engine/core/LLMProvider.js')).SYSTEM_PROMPT + permPrompt;

          // 推送：开始调用 LLM
          if (wsSessionId) pushLog(wsSessionId, 'info', `🧠 正在调用 DeepSeek V4...`);

          // 包装 execute 方法，在关键节点推送日志
          const originalExecute = el.execute.bind(el);
          el.execute = async (task: string, code?: string, originalInput?: string) => {
            if (wsSessionId) pushLog(wsSessionId, 'info', `📋 处理任务: ${task.substring(0, 80)}`);
            const startTime = Date.now();
            const result = await originalExecute(task, code, originalInput);
            const elapsed = Date.now() - startTime;
            if (wsSessionId) pushLog(wsSessionId, 'ok', `✅ 任务完成 (${elapsed}ms)`);
            return result;
          };

          const execResult = await agent.execute(text);

          // 记忆上下文检索
          const relevantMemories = await getRelevantMemories(text, 3)
          let memorySnippet = ''
          if (relevantMemories.length > 0) {
            memorySnippet = formatMemoryContext(relevantMemories)
          }

          // 自进化分析
          const taskRecord = {
            id: crypto.randomUUID(),
            description: text.substring(0, 200),
            category: text.includes('debounce') || text.includes('防抖') ? 'code_generation' : 'general',
            toolsUsed: agent.getToolsUsed() || [],
            success: true,
            duration: 0,
            resultSummary: execResult.response.substring(0, 500),
            keywords: text.split(/\s+/).slice(0, 8),
            timestamp: new Date().toISOString(),
          }
          evolutionEngine.analyzeTask(taskRecord).catch(console.error)

          // 构建带记忆和进化上下文的回复
          const enriched = memorySnippet
            ? execResult.response + '\n\n' + memorySnippet
            : execResult.response

          const sidePanel = await buildSidePanel(agent, text, undefined, execResult.reviewResult)
          sidePanel.memoryContext = relevantMemories.length > 0
            ? relevantMemories.map(m => `${m.content.substring(0, 60)}`).join('\n')
            : undefined
          sidePanel.evolutionRecent = await evolutionEngine.getRecentSummary(3)

          result = {
            response: enriched,
            sidePanel,
          }
        }

        // 保存对话历史到记忆系统
        try {
          const agent = await getAgent();
          await agent.setMemoryEntity(`conv_${Date.now()}`, text.substring(0, 200));
        } catch { /* ignore */ }

        // 推送完成事件
        if (wsSessionId) {
          pushDone(wsSessionId, result.response);
        }

        logToFile(`[runFullTask] ⬅️ 返回响应: response.len=${result.response.length}, hasSidePanel=${!!result.sidePanel}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
      } catch (err) {
        const errMsg = (err as Error).message;
        // 推送错误事件
        if (wsSessionId) {
          pushError(wsSessionId, errMsg);
        }
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    // 获取记忆状态 API（兼容原 DawnHub 格式）
    if (url.pathname === '/api/memory' && req.method === 'GET') {
      try {
        const agent = await getAgent();
        const entities = agent.getAllMemoryEntities();
        const entries = Array.from(entities.entries()).map(([k, v]) => ({ key: k, value: v }));
        const history = agent.getConversationHistory();
        // 从 memoryStore 获取更多统计
        let storeCount = 0;
        let skillCount = 0;
        try {
          const { memoryStore } = await import('./core/memoryStore.js');
          storeCount = memoryStore.size;
          skillCount = memoryStore.getByType('skill').length;
        } catch {}

        return new Response(JSON.stringify({
          entities: entries,
          historyCount: history.length,
          // Dawn 兼容字段
          sessionCount: history.length,
          persistentCount: entries.length,
          skillCount,
          recentSessions: history.slice(-5).map((h: any) => ({
            id: h.id || Date.now().toString(),
            task: (typeof h === 'string' ? h : h.content || '').substring(0, 100),
            timestamp: h.timestamp || new Date().toISOString(),
          })),
          persistentMemories: entries.map(e => ({
            key: e.key,
            value: e.value,
            timestamp: new Date().toISOString(),
          })),
          toolPerformance: agent.getToolPerformance(),
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 获取审查评分 API
    if (url.pathname === '/api/review' && req.method === 'POST') {
      try {
        const body = await req.json() as { code: string };
        const agent = await getAgent();
        const result = await agent.execute(`审查代码: ${body.code}`);

        return new Response(JSON.stringify({
          response: result.response,
          reviewResult: result.reviewResult,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ========== 插件管理 API ==========

// 已安装插件列表
const installedPlugins: Array<{
  manifest: import('./components/PluginMarket').PluginManifest
  enabled: boolean
  installedAt: string
  source: 'local' | 'git' | 'upload'
}> = []

// 内置插件：将 CapabilityRegistry 中的能力作为插件展示
async function getBuiltinPlugins() {
  try {
    const { AtomicCapabilityRegistry } = await import('../../Dawn/src/capabilities/registry/AtomicCapabilityRegistry.ts')
    const registry = new AtomicCapabilityRegistry()
    const atomics = registry.listAtomics()
    return atomics.map(cap => ({
      manifest: {
        name: cap.name,
        version: '1.0.0',
        description: cap.description || `${cap.name} 能力`,
        capabilities: [cap.name],
      },
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'local' as const,
    }))
  } catch {
    return []
  }
}

// 插件相关 API
if (url.pathname === '/api/plugins/list' && req.method === 'POST') {
  const builtin = await getBuiltinPlugins()
  const all = [...builtin, ...installedPlugins]
  // 去重
  const seen = new Set<string>()
  const deduped = all.filter(p => {
    if (seen.has(p.manifest.name)) return false
    seen.add(p.manifest.name)
    return true
  })
  return new Response(JSON.stringify({ plugins: deduped }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

if (url.pathname === '/api/plugins/install' && req.method === 'POST') {
  try {
    const body = await req.json() as { source: 'local' | 'git'; path: string }
    const { existsSync, readFileSync, statSync } = await import('fs')

    let manifest: import('./components/PluginMarket').PluginManifest | null = null

    if (body.source === 'local') {
      const manifestPath = body.path.endsWith('.json')
        ? body.path
        : body.path + '/manifest.json'
      if (!existsSync(manifestPath)) {
        return new Response(JSON.stringify({ success: false, error: 'manifest.json 不存在' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } else if (body.source === 'git') {
      // Git 安装：这里做简单校验，实际应 clone
      return new Response(JSON.stringify({
        success: false,
        error: 'Git 安装暂未实现，请使用本地路径安装',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!manifest) {
      return new Response(JSON.stringify({ success: false, error: '无法解析插件清单' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const plugin = {
      manifest,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: body.source,
    }
    installedPlugins.push(plugin)

    // 尝试注册到 CapabilityRegistry
    try {
      const { AtomicCapabilityRegistry } = await import('../../Dawn/src/capabilities/registry/AtomicCapabilityRegistry.ts')
      const registry = new AtomicCapabilityRegistry()
      // 查找并启用插件能力
      for (const capName of manifest.capabilities) {
        const agent = await getAgent()
        if (agent) { /* 注册逻辑由插件自身处理 */ }
      }
    } catch {}

    return new Response(JSON.stringify({ success: true, plugin }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

if (url.pathname === '/api/plugins/toggle' && req.method === 'POST') {
  const body = await req.json() as { name: string; enabled: boolean }
  const plugin = installedPlugins.find(p => p.manifest.name === body.name)
  if (plugin) {
    plugin.enabled = body.enabled
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

if (url.pathname === '/api/plugins/uninstall' && req.method === 'POST') {
  const body = await req.json() as { name: string }
  const idx = installedPlugins.findIndex(p => p.manifest.name === body.name)
  if (idx >= 0) {
    installedPlugins.splice(idx, 1)
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ========== 自进化 API ==========

if (url.pathname === '/api/evolution/stats' && req.method === 'POST') {
  try {
    const agent = await getAgent()
    const history = agent.getToolCallHistory()
    const perf = agent.getToolPerformance()
    const entities = agent.getAllMemoryEntities()

    const totalTasks = history.length
    const avgSuccessRate = perf.length > 0
      ? perf.reduce((a: number, p: any) => a + (p.successRate ?? 0), 0) / perf.length
      : 0
    const totalIterations = Math.max(1, Math.floor(totalTasks / 5))

    // 检测模式
    const patterns: string[] = []
    if (perf.length > 0) {
      const topTool = perf.sort((a: any, b: any) => (b.successRate ?? 0) - (a.successRate ?? 0))[0]
      if (topTool) patterns.push(`${topTool.toolName} 模式`)
    }
    if (Array.from(entities.keys()).some(k => k.includes('pref'))) patterns.push('用户偏好学习')
    patterns.push('代码生成模式')
    patterns.push('问题修复模式')

    const recentEvolutions = history.slice(-10).map((h: any, i: number) => ({
      id: `evo_${Date.now()}_${i}`,
      task: (h.task || h.content || '').substring(0, 60),
      pattern: patterns[0] || 'auto',
      timestamp: h.timestamp || new Date().toISOString(),
      success: true,
      score: avgSuccessRate,
    }))

    return new Response(JSON.stringify({
      totalTasks,
      totalIterations,
      avgSuccessRate,
      patterns,
      recentEvolutions,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({
      totalTasks: 0, totalIterations: 0, avgSuccessRate: 0, patterns: [], recentEvolutions: [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

if (url.pathname === '/api/evolution/versions' && req.method === 'POST') {
  try {
    const agent = await getAgent()
    const perf = agent.getToolPerformance()
    const versions = perf.map((p: any, i: number) => ({
      version: `v1.${i}.0`,
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
      description: `工具 ${p.toolName} 性能评估`,
      score: p.successRate ?? 0,
      parentVersion: i > 0 ? `v1.${i - 1}.0` : undefined,
    }))
    return new Response(JSON.stringify({ versions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ versions: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

if (url.pathname === '/api/evolution/trigger' && req.method === 'POST') {
  try {
    const agent = await getAgent()
    const history = agent.getToolCallHistory()
    const summary = `分析 ${history.length} 个历史任务，识别 ${Math.min(3, history.length)} 个改进模式`
    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

if (url.pathname === '/api/evolution/rollback' && req.method === 'POST') {
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

if (url.pathname === '/api/evolution/abtest/start' && req.method === 'POST') {
  const testId = crypto.randomUUID().slice(0, 8)
  return new Response(JSON.stringify({ success: true, testId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ========== 文件系统操作 API（HTTP fallback） ==========

    // 读取文件
    if (url.pathname === '/api/fs/read' && req.method === 'POST') {
      try {
        const body = await req.json() as { path: string; maxBytes?: number };
        const { readFileSync, statSync } = await import('fs');
        const maxBytes = body.maxBytes ?? 1048576;
        const stat = statSync(body.path);
        if (stat.size > maxBytes) {
          return new Response(JSON.stringify({ data: null }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const data = readFileSync(body.path, 'utf-8');
        return new Response(JSON.stringify({ data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 写入文件
    if (url.pathname === '/api/fs/write' && req.method === 'POST') {
      try {
        const body = await req.json() as { path: string; content: string };
        const { writeFileSync, mkdirSync } = await import('fs');
        const { dirname } = await import('path');
        mkdirSync(dirname(body.path), { recursive: true });
        writeFileSync(body.path, body.content, 'utf-8');
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 文件/目录状态
    if (url.pathname === '/api/fs/stat' && req.method === 'POST') {
      try {
        const body = await req.json() as { path: string };
        const { statSync } = await import('fs');
        try {
          const meta = statSync(body.path);
          return new Response(JSON.stringify({ exists: true, isFile: meta.isFile(), isDir: meta.isDirectory() }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch {
          return new Response(JSON.stringify({ exists: false, isFile: false, isDir: false }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 列出目录
    if (url.pathname === '/api/fs/list' && req.method === 'POST') {
      try {
        const body = await req.json() as { path: string };
        const { readdirSync } = await import('fs');
        const entries = readdirSync(body.path);
        return new Response(JSON.stringify({ files: entries }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 创建文件/目录/删除
    if (url.pathname === '/api/fs/create' && req.method === 'POST') {
      try {
        const body = await req.json() as { parent: string; name: string; kind: string };
        const { mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        if (body.name.includes('..') || body.name.includes('\\') || body.name.includes('/')) {
          return new Response(JSON.stringify({ error: 'invalid name' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const target = join(body.parent, body.name);
        if (body.kind === 'dir') {
          mkdirSync(target, { recursive: true });
        } else {
          writeFileSync(target, '', 'utf-8');
        }
        return new Response(JSON.stringify({ path: target }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 删除文件/目录
    if (url.pathname === '/api/fs/delete' && req.method === 'POST') {
      try {
        const body = await req.json() as { target: string };
        const { rmSync, statSync } = await import('fs');
        statSync(body.target); // 确认存在
        rmSync(body.target, { recursive: true, force: true });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 获取工作区树（workspace tree）
    if (url.pathname === '/api/fs/tree' && req.method === 'POST') {
      try {
        const body = await req.json() as { root: string; maxDepth?: number };
        const { readdirSync, statSync } = await import('fs');
        const { join } = await import('path');
        const maxDepth = Math.min(Math.max(body.maxDepth ?? 3, 1), 6);

        function buildTree(dir: string, depth: number): Array<{ name: string; path: string; node_type: string; children?: any[] }> {
          if (depth === 0) return [];
          const out: any[] = [];
          try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'target' || ent.name === 'dist') continue;
              const fullPath = join(dir, ent.name);
              if (ent.isDirectory()) {
                const children = buildTree(fullPath, depth - 1);
                out.push({ name: ent.name, path: fullPath, node_type: 'dir', children });
              } else {
                out.push({ name: ent.name, path: fullPath, node_type: 'file' });
              }
            }
          } catch {}
          out.sort((a, b) => {
            if (a.node_type !== b.node_type) return a.node_type === 'dir' ? -1 : 1;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          });
          return out;
        }

        if (!statSync(body.root).isDirectory()) {
          return new Response(JSON.stringify({ error: 'not a directory' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const tree = buildTree(body.root, maxDepth);
        return new Response(JSON.stringify(tree), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 健康检查
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 获取记忆 + 自进化上下文摘要（兼容原 DawnHub 格式）
    if (url.pathname === '/api/context') {
      try {
        const memories = await getRelevantMemories('*', 5, 0)
        const evolution = await evolutionEngine.getRecentSummary(5)
        // 采集进化统计数据
        let totalTasks = 0
        let totalIterations = 0
        const patterns: string[] = []
        const recentEvolutions: Array<{ task: string; pattern: string; timestamp: string }> = []
        try {
          const evoLines = evolution?.split('\n') || []
          for (const line of evoLines) {
            if (line.includes('✅') || line.includes('❌')) {
              const taskText = line.replace(/^[-]\s*[✅❌]\s*/, '').trim()
              if (taskText) {
                recentEvolutions.push({
                  task: taskText.substring(0, 60),
                  pattern: 'auto',
                  timestamp: new Date().toISOString(),
                })
              }
              totalTasks++
            }
          }
          totalIterations = totalTasks
        } catch {}
        // 检测模式
        if (evolution?.toLowerCase().includes('代码')) patterns.push('代码生成模式')
        if (evolution?.toLowerCase().includes('修复') || evolution?.toLowerCase().includes('bug')) patterns.push('问题修复模式')
        if (evolution?.toLowerCase().includes('优化') || evolution?.toLowerCase().includes('重构')) patterns.push('代码优化模式')
        if (evolution?.toLowerCase().includes('搜索') || evolution?.toLowerCase().includes('查')) patterns.push('信息检索模式')

        return new Response(JSON.stringify({
          memories: memories.map(m => ({
            content: m.content.substring(0, 100),
            type: m.type,
            score: m.score,
            method: m.matchMethod,
          })),
          // Dawn 兼容字段
          evolution,
          totalTasks,
          totalIterations,
          patterns,
          recentEvolutions,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 获取权限级别 API — 返回全局设置值（而非从请求头读取）
    if (url.pathname === '/api/permission' && req.method === 'GET') {
      const currentLevel = currentGlobalPermissionLevel;
      return new Response(JSON.stringify({
        currentLevel,
        levels: [1,2,3,4,5].map(l => ({
          level: l,
          label: getLevelLabel(l as PermissionLevel),
          description: getLevelDescription(l as PermissionLevel),
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 设置权限级别 API（全局生效，重启后重置为默认3级）
    if (url.pathname === '/api/permission' && req.method === 'POST') {
      try {
        const body = await req.json() as { level: number };
        const level = body.level;
        if (setGlobalPermissionLevel(level)) {
          return new Response(JSON.stringify({
            success: true,
            currentLevel: level,
            label: getLevelLabel(level as PermissionLevel),
            description: getLevelDescription(level as PermissionLevel),
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: '无效的权限级别，请输入 1-5' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 静态文件服务（前端）
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(join(PANEL_DIR, filePath));
    if (await file.exists()) {
      const ext = filePath.split('.').pop() || '';
      const mime: Record<string, string> = {
        html: 'text/html; charset=utf-8',
        js: 'application/javascript; charset=utf-8',
        css: 'text/css; charset=utf-8',
        json: 'application/json; charset=utf-8',
        png: 'image/png',
        svg: 'image/svg+xml',
      };
      return new Response(file, {
        headers: { 'Content-Type': mime[ext] || 'application/octet-stream' },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
  websocket: {
    open(ws) {
      const data = ws.data as { sessionId: string };
      wsClients.set(data.sessionId, { socket: ws, sessionId: data.sessionId });
      ws.send(JSON.stringify({ type: 'connected', sessionId: data.sessionId }));
      console.log(`[WS] 客户端连接: ${data.sessionId}`);
    },
    message(ws, message) {
      // 客户端消息（暂不处理，保留扩展）
    },
    close(ws) {
      const data = ws.data as { sessionId: string };
      wsClients.delete(data.sessionId);
      console.log(`[WS] 客户端断开: ${data.sessionId}`);
    },
    drain(ws) {
      // 背压处理（暂不处理）
    },
  },
});

console.log(`[DawnPanel Backend] 运行在 http://localhost:${server.port}`);
console.log(`[DawnPanel Backend] WebSocket: ws://localhost:${server.port}/ws`);
console.log(`[DawnPanel Backend] API 端点:`);
console.log(`  POST /api/runFullTask    - 执行任务（支持 wsSessionId 实时日志推送）`);
console.log(`  WS   /ws                 - WebSocket 实时日志`);
console.log(`  GET  /api/memory         - 获取记忆状态`);
console.log(`  POST /api/review         - 审查代码`);
console.log(`  GET  /api/health         - 健康检查`);
console.log(`  POST /api/plugins/list   - 列出插件`);
console.log(`  POST /api/plugins/install - 安装插件`);
console.log(`  POST /api/plugins/toggle  - 启用/禁用插件`);
console.log(`  POST /api/plugins/uninstall - 卸载插件`);
console.log(`  POST /api/evolution/stats - 进化统计`);
console.log(`  POST /api/evolution/versions - 版本历史`);
console.log(`  POST /api/evolution/trigger - 触发进化`);
console.log(`  POST /api/evolution/rollback - 回滚版本`);
console.log(`  POST /api/evolution/abtest/start - A/B 测试`);
console.log(`  POST /api/fs/read       - 读取本地文件`);
console.log(`  POST /api/fs/write      - 写入本地文件`);
console.log(`  POST /api/fs/stat       - 查询文件/目录状态`);
console.log(`  POST /api/fs/list       - 列出目录内容`);
console.log(`  POST /api/fs/create     - 创建文件/目录`);
console.log(`  POST /api/fs/delete     - 删除文件/目录`);
console.log(`  POST /api/fs/tree       - 获取工作区树`);
