// 会话生命周期模板方法模式
import { getLogger } from '@dawn/core';
const logger = getLogger('SessionTemplate');

export abstract class SessionTemplate {
  // 模板方法 - 定义会话生命周期骨架
  public runSession(): void {
    this.start()
    try {
      this.process()
      this.execute()
    } finally {
      this.end()
      this.cleanup()
    }
  }

  // 抽象方法 - 由子类实现
  protected abstract start(): void
  protected abstract process(): void
  protected abstract execute(): void
  protected abstract end(): void
  protected abstract cleanup(): void

  // 钩子方法 - 可选重写
  protected beforeStart(): void {
    // 默认空实现
  }

  protected afterCleanup(): void {
    // 默认空实现
  }
}

// 具体会话实现示例
export class StandardSession extends SessionTemplate {
  private sessionId: string = ''
  private resources: string[] = []

  protected start(): void {
    this.sessionId = `session_${Date.now()}`
    logger.info(`开始会话: ${this.sessionId}`)
  }

  protected process(): void {
    logger.info('处理用户输入...')
    // 实际处理逻辑
  }

  protected execute(): void {
    logger.info('执行任务...')
    // 实际执行逻辑
  }

  protected end(): void {
    logger.info(`结束会话: ${this.sessionId}`)
  }

  protected cleanup(): void {
    this.resources = []
    logger.info('清理会话资源')
  }

  protected beforeStart(): void {
    logger.info('会话开始前检查...')
  }
}

// 快速会话实现（跳过某些步骤）
export class QuickSession extends SessionTemplate {
  protected start(): void {
    logger.info('快速开始会话')
  }

  protected process(): void {
    logger.info('简化处理输入')
  }

  protected execute(): void {
    logger.info('快速执行任务')
  }

  protected end(): void {
    logger.info('快速结束会话')
  }

  protected cleanup(): void {
    logger.info('快速清理')
  }
}

// 会话管理器
export class SessionManager {
  private sessions: SessionTemplate[] = []

  public createSession(type: 'standard' | 'quick'): SessionTemplate {
    let session: SessionTemplate
    if (type === 'standard') {
      session = new StandardSession()
    } else {
      session = new QuickSession()
    }
    this.sessions.push(session)
    return session
  }

  public runAllSessions(): void {
    for (const session of this.sessions) {
      session.runSession()
    }
  }

  public clearSessions(): void {
    this.sessions = []
  }
}
