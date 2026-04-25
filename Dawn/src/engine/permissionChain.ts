// 权限检查责任链模式
export interface PermissionHandler {
  setNext(handler: PermissionHandler): PermissionHandler
  handle(request: PermissionRequest): Promise<PermissionResult>
}

export interface PermissionRequest {
  userId: string
  resourceId: string
  action: string
  context?: Record<string, any>
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
  protected async check(request: PermissionRequest): Promise<PermissionResult> {
    // 检查用户权限等级
    return { allowed: true }
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
      return ip.startsWith(range.split('/')[0].split('.').slice(0, 3).join('.'))
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

    let previous = this.handlers[0]
    for (let i = 1; i < this.handlers.length; i++) {
      previous = previous.setNext(this.handlers[i])
    }

    return this.handlers[0]
  }
}

// 默认权限链工厂
export function createDefaultPermissionChain(): PermissionHandler {
  return new PermissionChainBuilder()
    .addHandler(new SuperAdminHandler())
    .addHandler(new TimeRestrictionHandler())
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
}

// 全局权限服务实例
export const permissionService = new PermissionService()
