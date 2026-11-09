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
import { getErrorMessage } from '../utils/errors';
import { safeJsonParseUntyped } from '../utils/safeJson';
import type { EventName, EventTypes, EventHandler } from './eventBus';
import type { ResyncHandler } from './types';

export type { ResyncHandler };

const log = createLogger('INFRA:REDIS_EVENT_BUS');

const CHANNEL_PREFIX = 'sanctuary:events:';
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*`;

/**
 * Redis pub/sub is at-most-once: a message published while a subscriber is
 * disconnected, or one whose publish failed, is gone. A process that may have
 * missed messages runs its resync handlers instead (see `onResync`). This
 * channel carries a peer's "I failed to publish" announcement.
 */
const RESYNC_CHANNEL = `${CHANNEL_PREFIX}__resync`;
const RESYNC_ANNOUNCE_RETRY_MS = 5_000;
const RESUBSCRIBE_RETRY_MS = 1_000;

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
  /** Only events received from other instances (see `onRemote`). */
  private remoteEmitter = new EventEmitter();
  private instanceId: string;
  private resyncHandlers = new Set<ResyncHandler>();
  private resyncRunning = false;
  private resyncRequested = false;
  /** When the most recent resync run started (0 = never). */
  private lastResyncStartedAt = 0;
  private subscriberDropped = false;
  /** Earliest failed publish not yet covered by a sent announcement. */
  private unannouncedFailureAt: number | null = null;
  private resyncAnnounceTimer: ReturnType<typeof setTimeout> | null = null;
  private resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
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
    this.remoteEmitter.setMaxListeners(100);
    this.setupSubscriber();
  }

  /**
   * Set up Redis subscriber to receive events from other instances
   */
  private setupSubscriber(): void {
    this.subscriber.psubscribe(CHANNEL_PATTERN, (err) => {
      if (err) {
        log.error('Failed to subscribe to event channels', { error: err.message });
      } else {
        log.info('Subscribed to distributed event channels', { instanceId: this.instanceId });
      }
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        const envelope = safeJsonParseUntyped<EventEnvelope | null>(message, null, 'distributed event');
        if (!envelope) {
          return;
        }

        // Skip events from this instance (already handled locally)
        if (envelope.instanceId === this.instanceId) {
          return;
        }

        if (channel === RESYNC_CHANNEL) {
          // After an outage every peer that failed a publish announces; a
          // resync that started after the peer's first failure already covers it.
          const failedAt = (envelope.data as { failedAt?: unknown } | null)?.failedAt;
          if (typeof failedAt === 'number' && this.lastResyncStartedAt >= failedAt) return;
          log.warn('Peer could not publish an event; resyncing', { fromInstance: envelope.instanceId });
          void this.runResync();
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
        this.remoteEmitter.emit(eventName, envelope.data);
      } catch (error) {
        log.error('Failed to process distributed event', { error: getErrorMessage(error), message });
      }
    });

    this.subscriber.on('error', (err) => {
      log.error('Redis subscriber error', { error: err.message });
    });

    // Anything published while disconnected was missed. Resync only once the
    // pattern subscription is confirmed again, so nothing published between the
    // resync and the resubscribe is missed too.
    this.subscriber.on('close', () => {
      this.subscriberDropped = true;
    });
    this.subscriber.on('ready', () => {
      if (!this.subscriberDropped) return;
      this.subscriberDropped = false;
      this.resubscribeThenResync();
    });
  }

  /**
   * ioredis already re-subscribes on reconnect; this repeat (a no-op for
   * Redis) is queued behind it, so its ack confirms the subscription is back.
   */
  private resubscribeThenResync(): void {
    this.subscriber.psubscribe(CHANNEL_PATTERN, (err) => {
      if (err) {
        log.error('Failed to resubscribe to event channels; retrying', { error: err.message });
        if (this.shuttingDown || this.resubscribeTimer) return;
        this.resubscribeTimer = setTimeout(() => {
          this.resubscribeTimer = null;
          this.resubscribeThenResync();
        }, RESUBSCRIBE_RETRY_MS);
        this.resubscribeTimer.unref?.();
        return;
      }
      log.warn('Event subscriber reconnected; resyncing', { instanceId: this.instanceId });
      void this.runResync();
    });
  }

  /**
   * Register a handler to run when this process may have missed events from
   * other instances (its subscriber reconnected, or a peer reported a failed
   * publish). It should rebuild whatever those events would have kept fresh.
   */
  onResync(handler: ResyncHandler): () => void {
    this.resyncHandlers.add(handler);
    return () => {
      this.resyncHandlers.delete(handler);
    };
  }

  /** Runs every handler; overlapping triggers coalesce into one more run. */
  private async runResync(): Promise<void> {
    if (this.resyncRunning) {
      this.resyncRequested = true;
      return;
    }
    this.resyncRunning = true;
    try {
      do {
        this.resyncRequested = false;
        this.lastResyncStartedAt = Date.now();
        await Promise.all([...this.resyncHandlers].map(async (handler) => {
          try {
            await handler();
          } catch (error) {
            log.error('Error in event resync handler', { error: getErrorMessage(error) });
          }
        }));
      } while (this.resyncRequested);
    } finally {
      this.resyncRunning = false;
    }
  }

  /**
   * Tell other instances to resync, retrying until the announcement is sent.
   * One announcement covers every failure up to the moment it is sent; a later
   * failure schedules another.
   */
  private announceResyncAfterPublishFailure(): void {
    if (this.shuttingDown) return;
    this.unannouncedFailureAt ??= Date.now();
    this.scheduleResyncAnnouncement();
  }

  /** Call only with `unannouncedFailureAt` set. */
  private scheduleResyncAnnouncement(): void {
    if (this.resyncAnnounceTimer || this.shuttingDown) return;
    this.resyncAnnounceTimer = setTimeout(() => {
      const failedAt = this.unannouncedFailureAt as number;
      this.unannouncedFailureAt = null;
      const envelope: EventEnvelope = {
        event: '__resync',
        data: { failedAt },
        instanceId: this.instanceId,
        timestamp: Date.now(),
      };
      this.publisher.publish(RESYNC_CHANNEL, JSON.stringify(envelope)).then(
        () => {
          this.resyncAnnounceTimer = null;
          if (this.unannouncedFailureAt !== null) this.scheduleResyncAnnouncement();
        },
        (error: unknown) => {
          log.warn('Could not announce a resync; retrying', { error: getErrorMessage(error) });
          this.resyncAnnounceTimer = null;
          this.unannouncedFailureAt = Math.min(failedAt, this.unannouncedFailureAt ?? failedAt);
          this.scheduleResyncAnnouncement();
        },
      );
    }, RESYNC_ANNOUNCE_RETRY_MS);
    this.resyncAnnounceTimer.unref?.();
  }

  /**
   * Subscribe to an event (receives from all instances)
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const wrappedHandler = this.isolateHandler(event, handler, 'event handler');

    this.localEmitter.on(event, wrappedHandler);

    return () => {
      this.localEmitter.off(event, wrappedHandler);
    };
  }

  /**
   * Subscribe only to events published by other instances. Use it when this
   * process already applied its own change before publishing, so reacting to
   * the local echo would apply it twice.
   */
  onRemote<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const wrappedHandler = this.isolateHandler(event, handler, 'remote event handler');

    this.remoteEmitter.on(event, wrappedHandler);

    return () => {
      this.remoteEmitter.off(event, wrappedHandler);
    };
  }

  /**
   * Subscribe to an event (one-time)
   */
  once<E extends EventName>(event: E, handler: EventHandler<E>): void {
    this.localEmitter.once(event, this.isolateHandler(event, handler, 'one-time event handler'));
  }

  /** A handler failure is logged and counted, never thrown into the emitter. */
  private isolateHandler<E extends EventName>(
    event: E,
    handler: EventHandler<E>,
    kind: string,
  ): (data: EventTypes[E]) => Promise<void> {
    return async (data: EventTypes[E]) => {
      try {
        await handler(data);
      } catch (error) {
        log.error(`Error in ${kind} for ${event}`, { error: getErrorMessage(error) });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    };
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
      log.error('Failed to publish event to Redis', { event, error: getErrorMessage(error) });
      this.announceResyncAfterPublishFailure();
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
    try {
      await this.publisher.publish(channel, JSON.stringify(envelope));
    } catch (error) {
      this.announceResyncAfterPublishFailure();
      throw error;
    }

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
      this.remoteEmitter.removeAllListeners(event);
    } else {
      this.localEmitter.removeAllListeners();
      this.remoteEmitter.removeAllListeners();
      this.resyncHandlers.clear();
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

    this.shuttingDown = true;
    if (this.resyncAnnounceTimer) clearTimeout(this.resyncAnnounceTimer);
    if (this.resubscribeTimer) clearTimeout(this.resubscribeTimer);
    this.resyncAnnounceTimer = null;
    this.resubscribeTimer = null;
    this.resyncHandlers.clear();

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
