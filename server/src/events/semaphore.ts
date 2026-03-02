/**
 * Semaphore Concurrency Limiter
 *
 * Simple semaphore for limiting concurrent async operations.
 * Used by the event bus to prevent resource exhaustion.
 */

export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Queue the request
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      // Give permit to next waiter
      next();
    } else {
      // Return permit to pool
      this.permits++;
    }
  }

  /**
   * Execute a function with the semaphore
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current number of available permits
   */
  get available(): number {
    return this.permits;
  }

  /**
   * Get number of waiting requests
   */
  get queueLength(): number {
    return this.waiting.length;
  }
}
