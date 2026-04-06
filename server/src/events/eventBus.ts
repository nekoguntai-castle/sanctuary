/**
 * Internal Event Bus
 *
 * Type-safe event emitter for decoupled service-to-service communication.
 * Enables loose coupling between services while maintaining type safety.
 *
 * ## Usage
 *
 * ```typescript
 * // Subscribe to events
 * eventBus.on('wallet:synced', ({ walletId, balance }) => {
 *   console.log(`Wallet ${walletId} synced with balance ${balance}`);
 * });
 *
 * // Emit events
 * eventBus.emit('wallet:synced', { walletId: 'abc', balance: 100000n });
 *
 * // One-time listener
 * eventBus.once('transaction:confirmed', handler);
 *
 * // Unsubscribe
 * const unsubscribe = eventBus.on('wallet:synced', handler);
 * unsubscribe();
 * ```
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { Semaphore } from './semaphore';
import type { EventTypes, EventName, EventHandler } from './types';

// Re-export all types so barrel index.ts stays unchanged
export type {
  WalletEvents,
  TransactionEvents,
  DeviceEvents,
  UserEvents,
  SystemEvents,
  BlockchainEvents,
  EventTypes,
  EventName,
  EventHandler,
} from './types';

const log = createLogger('INFRA:EVENT_BUS');

// =============================================================================
// Event Bus Implementation
// =============================================================================

/**
 * Event bus configuration
 */
export interface EventBusConfig {
  // Maximum concurrent handler executions across all events
  maxConcurrentHandlers: number;
  // Maximum listeners per event (prevents memory leaks)
  maxListeners: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: EventBusConfig = {
  maxConcurrentHandlers: 10,
  maxListeners: 100,
};

/**
 * Type-safe event bus for internal service communication
 */
class TypedEventBus {
  private emitter = new EventEmitter();
  private semaphore: Semaphore;
  private config: EventBusConfig;
  private metrics = {
    emitted: new Map<string, number>(),
    errors: new Map<string, number>(),
    throttled: 0,
  };

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.semaphore = new Semaphore(this.config.maxConcurrentHandlers);
    // Increase max listeners to handle many subscribers
    this.emitter.setMaxListeners(this.config.maxListeners);
  }

  /**
   * Subscribe to an event
   * Returns unsubscribe function
   * Handlers are executed with concurrency limits to prevent resource exhaustion
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      // Use semaphore to limit concurrent handler executions
      await this.semaphore.run(async () => {
        try {
          await handler(data);
        } catch (error) {
          log.error(`Error in event handler for ${event}`, { error: getErrorMessage(error) });
          this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
        }
      });
    };

    this.emitter.on(event, wrappedHandler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(event, wrappedHandler);
    };
  }

  /**
   * Subscribe to an event (one-time)
   * Handlers are executed with concurrency limits
   */
  once<E extends EventName>(event: E, handler: EventHandler<E>): void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      // Use semaphore to limit concurrent handler executions
      await this.semaphore.run(async () => {
        try {
          await handler(data);
        } catch (error) {
          log.error(`Error in one-time event handler for ${event}`, { error: getErrorMessage(error) });
          this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
        }
      });
    };

    this.emitter.once(event, wrappedHandler);
  }

  /**
   * Emit an event
   */
  emit<E extends EventName>(event: E, data: EventTypes[E]): void {
    log.debug(`Event emitted: ${event}`, { data });
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);
    this.emitter.emit(event, data);
  }

  /**
   * Emit an event and wait for all handlers to complete
   */
  async emitAsync<E extends EventName>(event: E, data: EventTypes[E]): Promise<void> {
    log.debug(`Async event emitted: ${event}`, { data });
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);

    const listeners = this.emitter.listeners(event) as Array<(data: EventTypes[E]) => Promise<void>>;
    const results = await Promise.allSettled(listeners.map(listener => listener(data)));
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error(`Error in async event handler for ${event}`, { error: result.reason });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<E extends EventName>(event?: E): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount<E extends EventName>(event: E): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    emitted: Record<string, number>;
    errors: Record<string, number>;
    listenerCounts: Record<string, number>;
    concurrency: {
      maxConcurrent: number;
      available: number;
      queueLength: number;
    };
  } {
    const listenerCounts: Record<string, number> = {};
    for (const event of this.emitter.eventNames()) {
      listenerCounts[event as string] = this.emitter.listenerCount(event);
    }

    return {
      emitted: Object.fromEntries(this.metrics.emitted),
      errors: Object.fromEntries(this.metrics.errors),
      listenerCounts,
      concurrency: {
        maxConcurrent: this.config.maxConcurrentHandlers,
        available: this.semaphore.available,
        queueLength: this.semaphore.queueLength,
      },
    };
  }

  /**
   * Get current concurrency status
   */
  getConcurrencyStatus(): {
    maxConcurrent: number;
    available: number;
    queueLength: number;
    utilizationPercent: number;
  } {
    const available = this.semaphore.available;
    const max = this.config.maxConcurrentHandlers;
    const inUse = max - available;
    return {
      maxConcurrent: max,
      available,
      queueLength: this.semaphore.queueLength,
      utilizationPercent: Math.round((inUse / max) * 100),
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics.emitted.clear();
    this.metrics.errors.clear();
  }
}

/**
 * Global event bus singleton
 */
export const eventBus = new TypedEventBus();

/**
 * Create a scoped event bus for testing
 */
export function createTestEventBus(): TypedEventBus {
  return new TypedEventBus();
}
