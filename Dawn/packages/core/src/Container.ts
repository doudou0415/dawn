/**
 * Container — 轻量级 DI / Service Locator
 *
 * 服务注册周期：
 * 1. register(name, factory, singleton?): 注册工厂
 * 2. get<T>(name): 获取实例（单例复用）
 * 3. has(name): 检查是否已注册
 * 4. clear(): 重置（主要用于测试）
 */

type Factory<T> = () => T;

export class Container {
  private static factories = new Map<string, Factory<any>>();
  private static singletons = new Map<string, any>();
  private static singletonFlags = new Map<string, boolean>();

  static register<T>(name: string, factory: Factory<T>, singleton = true): void {
    this.factories.set(name, factory);
    this.singletonFlags.set(name, singleton);
    if (!singleton) {
      this.singletons.delete(name);
    }
  }

  static get<T>(name: string): T {
    if (this.singletons.has(name)) {
      return this.singletons.get(name) as T;
    }

    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`[Container] Service not registered: ${name}`);
    }

    const instance = factory();
    if (this.singletonFlags.get(name) !== false) {
      this.singletons.set(name, instance);
    }
    return instance;
  }

  static has(name: string): boolean {
    return this.factories.has(name);
  }

  static clear(): void {
    this.factories.clear();
    this.singletons.clear();
    this.singletonFlags.clear();
  }
}
