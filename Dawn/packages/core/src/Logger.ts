/**
 * @dawn/core — 统一日志系统
 *
 * 支持级别控制 + 文件输出 + 格式化。
 * 逐步替换全项目的 console.log/console.warn/console.error。
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

/** 从环境变量解析日志级别 */
function parseLogLevel(): LogLevel {
  const envLevel = (
    process.env.LOG_LEVEL ||
    process.env.DAWN_LOG_LEVEL ||
    'INFO'
  ).toUpperCase() as keyof typeof LogLevel;
  return LogLevel[envLevel] ?? LogLevel.INFO;
}

/** 日志写入目标 */
interface LogSink {
  write(level: LogLevel, name: string, message: string, data?: unknown): void;
}

/** 控制台输出（默认 sink） */
class ConsoleSink implements LogSink {
  write(level: LogLevel, name: string, message: string, data?: unknown): void {
    const prefix = `[${LOG_LEVEL_NAMES[level]}] [${name}]`;
    const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
    const full = `${prefix} ${message}${dataStr}`;

    switch (level) {
      case LogLevel.ERROR:
        console.error(full);
        break;
      case LogLevel.WARN:
        console.warn(full);
        break;
      default:
        console.log(full);
    }
  }
}

/** 文件输出 sink */
class FileSink implements LogSink {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private logDir: string;
  private currentDate: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    this.currentDate = new Date().toISOString().slice(0, 10);
    this.ensureDir();
    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  private ensureDir(): void {
    try {
      const { mkdirSync } = require('node:fs');
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // 忽略目录创建失败
    }
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    if (date !== this.currentDate) {
      this.currentDate = date;
    }
    return `${this.logDir}/dawn-${this.currentDate}.log`;
  }

  write(level: LogLevel, name: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
    this.buffer.push(`[${timestamp}] [${LOG_LEVEL_NAMES[level]}] [${name}] ${message}${dataStr}`);
  }

  private flush(): void {
    if (this.buffer.length === 0) return;

    try {
      const { appendFileSync } = require('node:fs');
      const lines = this.buffer.join('\n') + '\n';
      appendFileSync(this.getLogFilePath(), lines, 'utf-8');
      this.buffer = [];
    } catch {
      // 写入失败时保留 buffer，下次重试
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

// ── Logger 类 ──

export class Logger {
  private name: string;
  private sinks: LogSink[];

  constructor(name: string, sinks?: LogSink[]) {
    this.name = name;
    this.sinks = sinks ?? [new ConsoleSink()];

    // 如果设置了 DAWN_LOG_DIR，自动添加文件 sink
    const logDir = process.env.DAWN_LOG_DIR;
    if (logDir && sinks === undefined) {
      this.sinks.push(new FileSink(logDir));
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= loggerLevel;
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    for (const sink of this.sinks) {
      sink.write(LogLevel.DEBUG, this.name, message, data);
    }
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    for (const sink of this.sinks) {
      sink.write(LogLevel.INFO, this.name, message, data);
    }
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    for (const sink of this.sinks) {
      sink.write(LogLevel.WARN, this.name, message, data);
    }
  }

  error(message: string, data?: unknown): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    for (const sink of this.sinks) {
      sink.write(LogLevel.ERROR, this.name, message, data);
    }
  }

  /** 为当前 logger 附加一个新 sink */
  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  /** 释放资源（刷新文件 buffer 等） */
  dispose(): void {
    for (const sink of this.sinks) {
      if (sink instanceof FileSink) {
        sink.dispose();
      }
    }
  }
}

// ── 全局级别控制 ──

/** 全局日志级别（可由环境变量 LOG_LEVEL 或 DAWN_LOG_LEVEL 覆盖） */
export let loggerLevel: LogLevel = parseLogLevel();

/** 动态调整全局日志级别 */
export function setLogLevel(level: LogLevel): void {
  loggerLevel = level;
}

// ── 便捷工厂 ──

const loggerCache = new Map<string, Logger>();

/** 获取或创建命名 Logger */
export function getLogger(name: string): Logger {
  let logger = loggerCache.get(name);
  if (!logger) {
    logger = new Logger(name);
    loggerCache.set(name, logger);
  }
  return logger;
}

/** 销毁所有 Logger（进程退出时调用） */
export function disposeAllLoggers(): void {
  for (const logger of loggerCache.values()) {
    logger.dispose();
  }
  loggerCache.clear();
}

export type { LogSink };
export { ConsoleSink, FileSink };
