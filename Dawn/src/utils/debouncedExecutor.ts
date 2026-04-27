/** 防抖执行器 */

export class DebouncedExecutor<T extends (...args: any[]) => any> {
  private fn: T;
  private delay: number;
  private leading: boolean;
  private trailing: boolean;
  private maxWait: number | null;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastArgs: Parameters<T> | null = null;
  private lastCallTime: number | null = null;
  private callCount = 0;
  private resolvedCount = 0;

  constructor(fn: T, delay: number, options?: { leading?: boolean; trailing?: boolean; maxWait?: number }) {
    this.fn = fn;
    this.delay = delay;
    this.leading = options?.leading ?? false;
    this.trailing = options?.trailing ?? true;
    this.maxWait = options?.maxWait ?? null;
  }

  execute(...args: Parameters<T>): void {
    this.lastArgs = args;
    this.callCount++;
    const now = Date.now();

    if (this.leading && this.lastCallTime === null) {
      this.lastCallTime = now;
      this.invoke();
      return;
    }

    if (this.maxWait !== null && this.lastCallTime !== null && this.shouldForce(now)) {
      this.clearTimer();
      this.invoke();
      return;
    }

    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.trailing && this.lastArgs) {
        this.invoke();
      }
    }, this.delay);
  }

  private shouldForce(elapsed: number): boolean {
    const timeSinceLastCall = elapsed - (this.lastCallTime ?? 0);
    return this.maxWait !== null && timeSinceLastCall >= this.maxWait;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private invoke(): void {
    if (this.lastArgs) {
      this.fn(...this.lastArgs);
      this.resolvedCount++;
      this.lastArgs = null;
    }
    this.lastCallTime = Date.now();
  }

  cancel(): void {
    this.clearTimer();
    this.lastArgs = null;
  }

  getStats() {
    return { callCount: this.callCount, resolvedCount: this.resolvedCount };
  }
}
