// 移植自 Dawn 本体 src/types/permissions.ts 的核心权限类型
// ============================================================================
// Permission Modes（移植自 Dawn 本体）
// ============================================================================

/** 外部可设置的权限模式 */
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const

export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number]
export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
export type PermissionMode = InternalPermissionMode

export const INTERNAL_PERMISSION_MODES = [
  ...EXTERNAL_PERMISSION_MODES,
  'auto',
  'bubble',
] as const satisfies readonly PermissionMode[]

/** 权限行为类型 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

/** 权限规则来源 */
export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'default'

/** 权限规则 */
export interface PermissionRule {
  id: string
  mode: PermissionMode
  behavior: PermissionBehavior
  source: PermissionRuleSource
  /** 可选的操作白名单，不设置则应用到所有 */
  allowedActions?: string[]
  /** 可选白名单路径前缀 */
  allowedPaths?: string[]
  /** 优先级（值越大优先级越高）*/
  priority: number
  createdAt: string
}

// ============================================================================
// 权限等级系统（移植增强）
// ============================================================================

/** 用户权限等级 */
export type PermissionLevel = 0 | 1 | 2 | 3 | 4 | 5

/** 权限等级描述 */
export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  0: '无权限',
  1: '只读',
  2: '基础执行',
  3: '标准操作',
  4: '高级操作',
  5: '完全控制',
}

// ============================================================================
// 权限检查责任链模式
// ============================================================================
export interface PermissionHandler {
  setNext(handler: PermissionHandler): PermissionHandler
  handle(request: PermissionRequest): Promise<PermissionResult>
}

export interface PermissionRequest {
  userId: string
  resourceId: string
  action: string
  context?: Record<string, any>
  /** @dawn 移植来自 Dawn 本体的权限等级支持 */
  requiredLevel?: PermissionLevel
  /** @dawn 权限模式 */
  mode?: PermissionMode
}

export interface PermissionResult {
  allowed: boolean
  reason?: string
  nextHandler?: PermissionHandler
}

// 基础处理器抽象类
export abstract class BasePermissionHandler implements PermissionHandler {
  private next: PermissionHandler | null = null

  setNext(handler: PermissionHandler): PermissionHandler {
    this.next = handler
    return handler
  }

  async handle(request: PermissionRequest): Promise<PermissionResult> {
    const ownResult = await this.check(request)
    if (!ownResult.allowed && this.next) {
      return this.next.handle(request)
    }
    return ownResult
  }

  protected async check(
    request: PermissionRequest,
  ): Promise<PermissionResult> {
    return { allowed: true }
  }
}

// 白名单检查处理器
export class WhitelistHandler extends BasePermissionHandler {
  protected async check(request: PermissionRequest): Promise<PermissionResult> {
    // 检查路径是否在白名单内
    return { allowed: true }
  }
}

// 权限等级检查处理器
export class PermissionLevelHandler extends BasePermissionHandler {
  /** 当前用户等级 */
  private userLevel: PermissionLevel

  constructor(userLevel: PermissionLevel = 3) {
    super()
    this.userLevel = userLevel
  }

  /** 更新用户等级（例如从配置加载） */
  setLevel(level: PermissionLevel): void {
    this.userLevel = level
  }

  protected async check(request: PermissionRequest): Promise<PermissionResult> {
    const required = request.requiredLevel ?? 0

    if (this.userLevel >= required) {
      return {
        allowed: true,
        reason: `用户等级 ${this.userLevel} >= 所需等级 ${required}`,
      }
    }

    // 不满足等级时，交给下一个处理器判定（例如超级管理员）
    return {
      allowed: false,
      reason: `权限不足：当前等级 ${this.userLevel}，需要 ${required}`,
    }
  }
}

// 具体处理器：超级管理员检查
export class SuperAdminHandler extends BasePermissionHandler {
  private superAdminIds = ['admin', 'root', 'super']

  async handle(request: PermissionRequest): Promise<PermissionResult> {
    if (this.superAdminIds.includes(request.userId)) {
      return { allowed: true, reason: '超级管理员拥有所有权限' }
    }
    return super.handle(request)
  }
}

// 具体处理器：角色权限检查
export class RolePermissionHandler extends BasePermissionHandler {
  private rolePermissions: Record<string, string[]> = {
    editor: ['read', 'write', 'edit'],
    viewer: ['read'],
    admin: ['read', 'write', 'edit', 'delete', 'manage'],
  }

  async handle(request: PermissionRequest): Promise<PermissionResult> {
    // 这里应该从用户服务获取用户角色，简化示例
    const userRole = request.context?.role || 'viewer'
    const allowedActions = this.rolePermissions[userRole] || []

    if (allowedActions.includes(request.action)) {
      return {
        allowed: true,
        reason: `角色 ${userRole} 拥有 ${request.action} 权限`,
      }
    }
    return super.handle(request)
  }
}

// 具体处理器：资源所有者检查
export class ResourceOwnerHandler extends BasePermissionHandler {
  async handle(request: PermissionRequest): Promise<PermissionResult> {
    // 这里应该从资源服务获取资源所有者，简化示例
    const resourceOwner = request.context?.resourceOwner

    if (resourceOwner && resourceOwner === request.userId) {
      return { allowed: true, reason: '资源所有者拥有所有权限' }
    }
    return super.handle(request)
  }
}

// 具体处理器：IP白名单检查
export class IPWhitelistHandler extends BasePermissionHandler {
  private whitelist = ['127.0.0.1', '192.168.1.0/24']

  async handle(request: PermissionRequest): Promise<PermissionResult> {
    const clientIP = request.context?.clientIP

    if (clientIP && this.whitelist.some(ip => this.isIPInRange(clientIP, ip))) {
      return { allowed: true, reason: 'IP在白名单内' }
    }
    return super.handle(request)
  }

  private isIPInRange(ip: string, range: string): boolean {
    // 简化实现，实际应该使用IP地址库
    if (range.includes('/')) {
      // CIDR表示法
      const parts = range.split('/')[0]?.split('.').slice(0, 3).join('.')
      return parts ? ip.startsWith(parts) : false
    }
    return ip === range
  }
}

// 具体处理器：时间限制检查
export class TimeRestrictionHandler extends BasePermissionHandler {
  private allowedHours = { start: 8, end: 20 } // 8:00-20:00

  async handle(request: PermissionRequest): Promise<PermissionResult> {
    const now = new Date()
    const currentHour = now.getHours()

    if (
      currentHour >= this.allowedHours.start &&
      currentHour < this.allowedHours.end
    ) {
      return super.handle(request)
    }
    return { allowed: false, reason: '非工作时间禁止操作' }
  }
}

// 权限链构建器
export class PermissionChainBuilder {
  private handlers: PermissionHandler[] = []

  addHandler(handler: PermissionHandler): PermissionChainBuilder {
    this.handlers.push(handler)
    return this
  }

  build(): PermissionHandler {
    if (this.handlers.length === 0) {
      throw new Error('至少需要一个处理器')
    }

    let previous: PermissionHandler = this.handlers[0]!
    for (let i = 1; i < this.handlers.length; i++) {
      const handler = this.handlers[i]
      if (handler) {
        previous = previous.setNext(handler)
      }
    }

    return this.handlers[0]!
  }
}

// 默认权限链工厂
export function createDefaultPermissionChain(
  userLevel?: PermissionLevel,
): PermissionHandler {
  return new PermissionChainBuilder()
    .addHandler(new SuperAdminHandler())
    .addHandler(new TimeRestrictionHandler())
    .addHandler(new PermissionLevelHandler(userLevel))
    .addHandler(new IPWhitelistHandler())
    .addHandler(new RolePermissionHandler())
    .addHandler(new ResourceOwnerHandler())
    .build()
}

// 权限检查服务
export class PermissionService {
  private chain: PermissionHandler

  constructor(chain?: PermissionHandler) {
    this.chain = chain || createDefaultPermissionChain()
  }

  async checkPermission(request: PermissionRequest): Promise<PermissionResult> {
    return this.chain.handle(request)
  }

  // 快捷方法
  async can(
    userId: string,
    resourceId: string,
    action: string,
    context?: Record<string, any>,
  ): Promise<boolean> {
    const result = await this.checkPermission({
      userId,
      resourceId,
      action,
      context,
    })
    return result.allowed
  }

  /** 基于等级检查（从 Dawn 权限系统移植） */
  async checkLevel(
    userId: string,
    resourceId: string,
    action: string,
    requiredLevel: PermissionLevel,
    context?: Record<string, any>,
  ): Promise<PermissionResult> {
    return this.checkPermission({
      userId,
      resourceId,
      action,
      requiredLevel,
      context,
    })
  }
}

// 全局权限服务实例
export const permissionService = new PermissionService()
