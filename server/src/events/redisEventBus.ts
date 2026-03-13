/**
 * Redis-Backed Event Bus
 *
 * Distributed event bus using Redis pub/sub for cross-instance communication.
 * Extends the local TypedEventBus to broadcast events to all server instances.
 *
 * ## Architecture
 *
 * ```
 * Instance A                    Instance B
 * ┌─────────────┐              ┌─────────────┐
 * │  emit()     │─────────────►│ handlers    │
 * │  handlers   │◄─────────────│  emit()     │
 * └──────┬──────┘              └──────┬──────┘
 *        │                            │
 *        └────────┬──────────────────┘
 *                 │
 *          ┌──────▼──────┐
 *          │   Redis     │
 *          │  Pub/Sub    │
 *          └─────────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const redisEventBus = await createRedisEventBus('redis://localhost:6379');
 *
 * // Subscribe (receives events from all instances)
 * redisEventBus.on('wallet:synced', (data) => {
 *   console.log('Wallet synced:', data);
 * });
 *
 * // Emit (broadcasts to all instances)
 * redisEventBus.emit('wallet:synced', { walletId: '123', ... });
 * ```
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import type { EventName, EventTypes, EventHandler } from './eventBus';

const log = createLogger('RedisEventBus');

const CHANNEL_PREFIX = 'sanctuary:events:';

/**
 * Serializable event envelope for Redis transport
 */
interface EventEnvelope {
  event: string;
  data: unknown;
  instanceId: string;
  timestamp: number;
}

/**
 * Redis-backed distributed event bus
 */
export class RedisEventBus {
  private publisher: Redis;
  private subscriber: Redis;
  private localEmitter = new EventEmitter();
  private instanceId: string;
  private metrics = {
    emitted: new Map<string, number>(),
    received: new Map<string, number>(),
    errors: new Map<string, number>(),
  };

  constructor(publisher: Redis, subscriber: Redis) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.localEmitter.setMaxListeners(100);
    this.setupSubscriber();
  }

  /**
   * Set up Redis subscriber to receive events from other instances
   */
  private setupSubscriber(): void {
    this.subscriber.psubscribe(`${CHANNEL_PREFIX}*`, (err) => {
      if (err) {
        log.error('Failed to subscribe to event channels', { error: err.message });
      } else {
        log.info('Subscribed to distributed event channels', { instanceId: this.instanceId });
      }
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        const envelope: EventEnvelope = JSON.parse(message);

        // Skip events from this instance (already handled locally)
        if (envelope.instanceId === this.instanceId) {
          return;
        }

        const eventName = channel.replace(CHANNEL_PREFIX, '');
        this.metrics.received.set(eventName, (this.metrics.received.get(eventName) || 0) + 1);

        log.debug('Received distributed event', {
          event: eventName,
          fromInstance: envelope.instanceId,
        });

        // Emit to local handlers
        this.localEmitter.emit(eventName, envelope.data);
      } catch (error) {
        log.error('Failed to process distributed event', { error, message });
      }
    });

    this.subscriber.on('error', (err) => {
      log.error('Redis subscriber error', { error: err.message });
    });
  }

  /**
   * Subscribe to an event (receives from all instances)
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      try {
        await handler(data);
      } catch (error) {
        log.error(`Error in event handler for ${event}`, { error });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    };

    this.localEmitter.on(event, wrappedHandler);

    return () => {
      this.localEmitter.off(event, wrappedHandler);
    };
  }

  /**
   * Subscribe to an event (one-time)
   */
  once<E extends EventName>(event: E, handler: EventHandler<E>): void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      try {
        await handler(data);
      } catch (error) {
        log.error(`Error in one-time event handler for ${event}`, { error });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    };

    this.localEmitter.once(event, wrappedHandler);
  }

  /**
   * Emit an event (broadcasts to all instances)
   */
  emit<E extends EventName>(event: E, data: EventTypes[E]): void {
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);

    // Emit locally first
    this.localEmitter.emit(event, data);

    // Broadcast to other instances via Redis
    const envelope: EventEnvelope = {
      event,
      data: this.serializeData(data),
      instanceId: this.instanceId,
      timestamp: Date.now(),
    };

    const channel = `${CHANNEL_PREFIX}${event}`;
    this.publisher.publish(channel, JSON.stringify(envelope)).catch((error) => {
      log.error('Failed to publish event to Redis', { event, error });
    });

    log.debug(`Event emitted: ${event}`, { data });
  }

  /**
   * Emit an event and wait for all local handlers to complete
   */
  async emitAsync<E extends EventName>(event: E, data: EventTypes[E]): Promise<void> {
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);

    // Execute local handlers
    const listeners = this.localEmitter.listeners(event) as Array<(data: EventTypes[E]) => Promise<void>>;
    const results = await Promise.allSettled(listeners.map((listener) => listener(data)));
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error(`Error in async event handler for ${event}`, { error: result.reason });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    }

    // Broadcast to other instances
    const envelope: EventEnvelope = {
      event,
      data: this.serializeData(data),
      instanceId: this.instanceId,
      timestamp: Date.now(),
    };

    const channel = `${CHANNEL_PREFIX}${event}`;
    await this.publisher.publish(channel, JSON.stringify(envelope));

    log.debug(`Async event emitted: ${event}`, { data });
  }

  /**
   * Serialize data for Redis transport (handle BigInt)
   */
  private serializeData(data: unknown): unknown {
    return JSON.parse(
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? { __bigint: value.toString() } : value
      )
    );
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<E extends EventName>(event?: E): void {
    if (event) {
      this.localEmitter.removeAllListeners(event);
    } else {
      this.localEmitter.removeAllListeners();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount<E extends EventName>(event: E): number {
    return this.localEmitter.listenerCount(event);
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    emitted: Record<string, number>;
    received: Record<string, number>;
    errors: Record<string, number>;
    listenerCounts: Record<string, number>;
    instanceId: string;
  } {
    const listenerCounts: Record<string, number> = {};
    for (const event of this.localEmitter.eventNames()) {
      listenerCounts[event as string] = this.localEmitter.listenerCount(event);
    }

    return {
      emitted: Object.fromEntries(this.metrics.emitted),
      received: Object.fromEntries(this.metrics.received),
      errors: Object.fromEntries(this.metrics.errors),
      listenerCounts,
      instanceId: this.instanceId,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics.emitted.clear();
    this.metrics.received.clear();
    this.metrics.errors.clear();
  }

  /**
   * Shutdown the event bus
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Redis event bus', { instanceId: this.instanceId });

    await this.subscriber.punsubscribe();
    await this.subscriber.quit();
    await this.publisher.quit();

    this.localEmitter.removeAllListeners();
  }
}

/**
 * Create a Redis-backed event bus
 */
export async function createRedisEventBus(url: string): Promise<RedisEventBus> {
  const publisher = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  const subscriber = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  // Wait for both connections
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      publisher.once('connect', resolve);
      publisher.once('error', reject);
    }),
    new Promise<void>((resolve, reject) => {
      subscriber.once('connect', resolve);
      subscriber.once('error', reject);
    }),
  ]);

  log.info('Redis event bus connected', { url: url.replace(/\/\/.*@/, '//<credentials>@') });

  return new RedisEventBus(publisher, subscriber);
}
