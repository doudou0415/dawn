/**
 * Dawn 通用工具函数
 */

/**
 * 延迟指定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix = 'dwn'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 安全解析 JSON，失败返回默认值
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * 截断字符串到指定长度
 */
export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ── 日志系统 ──

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: unknown;
}

const MAX_LOG_ENTRIES = 1000;
let logBuffer: LogEntry[] = [];

function formatLogEntry(entry: LogEntry): string {
  const details = entry.details !== undefined
    ? ' ' + (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details))
    : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${details}`;
}

/** 写入日志（控制台 + 内存缓冲区） */
function writeLog(level: LogLevel, message: string, details?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    details,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }

  // 控制台输出
  const formatted = formatLogEntry(entry);
  switch (level) {
    case 'error': console.error(formatted); break;
    case 'warn':  console.warn(formatted);  break;
    default:      console.log(formatted);   break;
  }
}

export const logger = {
  debug: (msg: string, details?: unknown) => writeLog('debug', msg, details),
  info: (msg: string, details?: unknown) => writeLog('info', msg, details),
  warn: (msg: string, details?: unknown) => writeLog('warn', msg, details),
  error: (msg: string, details?: unknown) => writeLog('error', msg, details),

  /** 将所有未刷新的日志写入文件 */
  async flushToFile(filePath?: string): Promise<void> {
    if (logBuffer.length === 0) return;
    try {
      const { mkdir, appendFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const path = filePath || 'logs/dawn.log';
      await mkdir(dirname(path), { recursive: true });
      const lines = logBuffer.map(formatLogEntry).join('\n') + '\n';
      await appendFile(path, lines, 'utf-8');
      logBuffer = [];
    } catch (e) {
      console.error('[logger] 写入日志文件失败:', (e as Error).message);
    }
  },

  /** 获取最近日志 */
  getRecent(n = 50): LogEntry[] {
    return logBuffer.slice(-n);
  },
};

/** 设置全局未捕获异常处理 */
export function setupGlobalErrorHandling(): void {
  process.on('uncaughtException', (err) => {
    logger.error('未捕获的异常', { message: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') });
    logger.flushToFile().catch(() => {});
    console.error('\n⚠️ 发生未预期的错误，日志已保存。可查看 logs/dawn.log\n');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.warn('未处理的 Promise 拒绝', { reason: String(reason) });
  });
}
