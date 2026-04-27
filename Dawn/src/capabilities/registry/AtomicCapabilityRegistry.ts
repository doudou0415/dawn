/**
 * AtomicCapabilityRegistry — 新一代能力注册中心
 *
 * 与旧 CapabilityRegistry 的区别：
 * - 专为 AtomicCapability 接口设计（与 packages/core/types.ts 对齐）
 * - 支持热插拔：register/unregister 动态增减
 * - 权限管理：自动收集能力声明的 permissions
 * - 意图路由：根据 TaskCategory 快速匹配能力
 * - 兼容旧版：提供 toLegacy() 转换桥接
 */

import type { TaskCategory } from '@dawn/core';
import type { AtomicCapability, CompositeCapability, CapabilityResult } from './types.js';
import type { AtomicInput } from './types.js';
import { PermissionService } from '../../engine/permissionChain.js';
import type { PermissionRequest } from '../../engine/permissionChain.js';
import { getLogger } from '@dawn/core';

const log = getLogger('AtomicCapabilityRegistry');

export class AtomicCapabilityRegistry {
  private atomics = new Map<string, AtomicCapability>();
  private composites = new Map<string, CompositeCapability>();
  private intentIndex = new Map<TaskCategory, string[]>();
  /** 权限检查服务，未设置时跳过权限检查 */
  private permissionService: PermissionService | null = null;

  // ── 原子能力注册 ──

  /**
   * 设置权限检查服务
   * 设置后，每次 executeAtomic 前都会走权限链检查。
   */
  setPermissionService(service: PermissionService): void {
    this.permissionService = service;
  }

  register(cap: AtomicCapability): void {
    if (this.atomics.has(cap.name)) {
      log.warn(`Overwriting existing atomic: ${cap.name}`);
    }
    this.atomics.set(cap.name, cap);

    // 更新意图索引
    for (const intent of cap.intentTypes) {
      const existing = this.intentIndex.get(intent) ?? [];
      if (!existing.includes(cap.name)) {
        existing.push(cap.name);
        this.intentIndex.set(intent, existing);
      }
    }
  }

  unregister(name: string): boolean {
    const cap = this.atomics.get(name);
    if (!cap) return false;

    // 移除意图索引
    for (const intent of cap.intentTypes) {
      const list = this.intentIndex.get(intent);
      if (list) {
        const filtered = list.filter(n => n !== name);
        if (filtered.length === 0) this.intentIndex.delete(intent);
        else this.intentIndex.set(intent, filtered);
      }
    }

    return this.atomics.delete(name);
  }

  getAtomic(name: string): AtomicCapability | undefined {
    return this.atomics.get(name);
  }

  findAtomic(intentType: TaskCategory): AtomicCapability[] {
    const names = this.intentIndex.get(intentType) ?? [];
    return names.map(n => this.atomics.get(n)).filter(Boolean) as AtomicCapability[];
  }

  listAtomics(): AtomicCapability[] {
    return Array.from(this.atomics.values());
  }

  // ── 复合能力注册 ──

  registerComposite(cap: CompositeCapability): void {
    if (this.composites.has(cap.name)) {
      log.warn(`Overwriting existing composite: ${cap.name}`);
    }
    this.composites.set(cap.name, cap);
  }

  getComposite(name: string): CompositeCapability | undefined {
    return this.composites.get(name);
  }

  listComposites(): CompositeCapability[] {
    return Array.from(this.composites.values());
  }

  // ── 执行 ──

  async executeAtomic(name: string, input: AtomicInput): Promise<CapabilityResult> {
    const cap = this.atomics.get(name);
    if (!cap) {
      return { success: false, output: `Capability '${name}' not found` };
    }

    if (cap.validate && !cap.validate(input)) {
      return { success: false, output: `Input validation failed for '${name}'` };
    }

    // ── 权限检查（集成 PermissionChain） ──
    if (this.permissionService) {
      const sessionId = input.context?.sessionId ?? 'unknown';
      for (const perm of cap.permissions) {
        const req: PermissionRequest = {
          userId: sessionId,
          resourceId: name,
          action: perm,
          context: input.context ?? {},
        };
        const result = await this.permissionService.checkPermission(req);
        if (!result.allowed) {
          return {
            success: false,
            output: `Permission denied: ${result.reason ?? `需要 ${perm} 权限`}`,
            permissionsUsed: [perm],
          };
        }
      }
    }

    try {
      const start = Date.now();
      const result = await cap.execute(input);
      return { ...result, durationMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        output: `Execution error in '${name}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async executeComposite(name: string, input: AtomicInput): Promise<CapabilityResult> {
    const cap = this.composites.get(name);
    if (!cap) {
      return { success: false, output: `Composite capability '${name}' not found` };
    }

    try {
      const start = Date.now();
      const result = await cap.execute(input, this);
      return { ...result, durationMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        output: `Execution error in composite '${name}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── 批量注册 ──

  registerAll(caps: AtomicCapability[]): void {
    for (const cap of caps) this.register(cap);
  }

  // ── 统计查询 ──

  get stats() {
    return {
      atomicCount: this.atomics.size,
      compositeCount: this.composites.size,
      intentCoverage: this.intentIndex.size,
      allNames: [...this.atomics.keys(), ...this.composites.keys()],
    };
  }

  /**
   * 列出注册能力触发的所有权限
   */
  listRequiredPermissions(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [name, cap] of this.atomics) {
      result.set(name, cap.permissions);
    }
    return result;
  }

  // ── 向后兼容 ──

  /** 检查旧版 Capability 接口是否兼容 */
  toLegacy() {
    return {
      getCapability: (intent: TaskCategory) => {
        const found = this.findAtomic(intent);
        return found.length > 0 ? found[0] : undefined;
      },
      getAll: () => this.listAtomics(),
      get: (name: string) => this.getAtomic(name),
    };
  }
}
