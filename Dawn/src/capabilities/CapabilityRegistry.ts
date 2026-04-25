/**
 * CapabilityRegistry — 能力注册中心
 * 所有能力（CodeReview、FileOps、WebSearch、Browser 等）统一注册、发现、调用。
 */

import type { IntentType, IntentResult } from '../engine/IntentEngine';

export interface CapabilityInput {
  intent: IntentResult;
  memory?: Record<string, unknown>;
  rawInput: string;
}

export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly intentTypes: IntentType[];
  execute(input: CapabilityInput): Promise<unknown>;
  validate?(input: CapabilityInput): boolean;
}

export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();
  private intentMap: Map<IntentType, string[]> = new Map();

  /**
   * 注册一个能力
   */
  public register(capability: Capability): void {
    if (this.capabilities.has(capability.name)) {
      throw new Error(`Capability '${capability.name}' is already registered`);
    }

    this.capabilities.set(capability.name, capability);

    for (const intentType of capability.intentTypes) {
      const existing = this.intentMap.get(intentType) || [];
      existing.push(capability.name);
      this.intentMap.set(intentType, existing);
    }
  }

  /**
   * 取消注册
   */
  public unregister(name: string): boolean {
    const cap = this.capabilities.get(name);
    if (!cap) return false;

    for (const intentType of cap.intentTypes) {
      const list = this.intentMap.get(intentType);
      if (list) {
        const filtered = list.filter(n => n !== name);
        if (filtered.length === 0) {
          this.intentMap.delete(intentType);
        } else {
          this.intentMap.set(intentType, filtered);
        }
      }
    }

    return this.capabilities.delete(name);
  }

  /**
   * 根据意图类型获取最匹配的能力
   */
  public getCapability(intentType: IntentType): Capability | undefined {
    const names = this.intentMap.get(intentType);
    if (!names || names.length === 0) return undefined;
    return this.capabilities.get(names[0]);
  }

  /**
   * 获取所有能力
   */
  public getAll(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * 根据名称获取能力
   */
  public get(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * 检查能力是否已注册
   */
  public has(name: string): boolean {
    return this.capabilities.has(name);
  }

  /**
   * 获取注册数量
   */
  public get size(): number {
    return this.capabilities.size;
  }
}
