/**
 * Redis WebSocket Bridge
 *
 * Enables WebSocket broadcasts to propagate across multiple server instances
 * via Redis pub/sub. This is essential for horizontal scaling.
 *
 * ## Architecture
 *
 * When a broadcast occurs on Instance A:
 * 1. Event is published to Redis channel
 * 2. Instance B receives event via subscription
 * 3. Instance B broadcasts to its local WebSocket clients
 * 4. Instance A also broadcasts locally (instance ID prevents loops)
 *
 * ## Graceful Degradation
 *
 * If Redis is unavailable, broadcasts are local-only (single instance mode).
 */

import { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { safeJsonParseUntyped } from '../utils/safeJson';
import { getRedisClient, isRedisConnected } from '../infrastructure/redis';
import type { WebSocketEvent } from './types';
import type { WebSocketAuthorizationControl } from './authorizationControl';

const log = createLogger('WS:REDIS_BRIDGE');

// Channel for WebSocket broadcasts
const WS_BROADCAST_CHANNEL = 'sanctuary:ws:broadcast';
const WS_AUTHORIZATION_CONTROL_CHANNEL = 'sanctuary:ws:authorization-control';

/**
 * Unique instance identifier for deduplication
 * Prevents processing our own published events
 */
const instanceId = `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;

/**
 * Envelope for WebSocket events sent via Redis
 */
interface WebSocketEnvelope {
  event: WebSocketEvent;
  instanceId: string;
  timestamp: number;
}

interface AuthorizationControlEnvelope {
  control: WebSocketAuthorizationControl;
  instanceId: string;
  timestamp: number;
}

/**
 * Bridge initialization options
 */
export interface RedisWebSocketBridgeOptions {
  /**
   * Publish without subscribing.
   *
   * The worker process has no WebSocket clients of its own, so it only ever
   * needs the publisher half. Skipping the subscriber avoids a second Redis
   * connection that would parse every fleet-wide broadcast and discard it.
   */
  publishOnly?: boolean;
}

/**
 * Callback type for handling remote broadcasts
 */
type BroadcastHandler = (event: WebSocketEvent) => void;
type ControlHandler = (control: WebSocketAuthorizationControl) => Promise<void> | void;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAuthorizationControl(value: unknown): value is WebSocketAuthorizationControl {
  if (!value || typeof value !== 'object') return false;
  const control = value as Record<string, unknown>;
  if (control.version !== 1 || typeof control.type !== 'string') return false;
  if (control.type === 'wallet-access-changed') return isNonEmptyString(control.walletId);
  if (control.type === 'access-token-revoked') return isNonEmptyString(control.jti);
  if (control.type === 'user-access-revoked') return isNonEmptyString(control.userId);
  return false;
}

function isControlEnvelope(value: unknown): value is AuthorizationControlEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  return isNonEmptyString(envelope.instanceId) &&
    typeof envelope.timestamp === 'number' &&
    isAuthorizationControl(envelope.control);
}

/**
 * Redis WebSocket Bridge for cross-instance broadcasting
 */
class RedisWebSocketBridge {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private isInitialized = false;
  private publishOnly = false;
  private broadcastHandler: BroadcastHandler | null = null;
  private controlHandler: ControlHandler | null = null;

  // Metrics
  private metrics = {
    published: 0,
    received: 0,
    errors: 0,
    skippedSelf: 0,
  };

  /**
   * Initialize the bridge with Redis pub/sub connections
   * Must be called after Redis is connected
   */
  async initialize(options: RedisWebSocketBridgeOptions = {}): Promise<void> {
    if (this.isInitialized) {
      log.warn('Redis WebSocket bridge already initialized');
      return;
    }

    if (!isRedisConnected()) {
      log.warn('Redis not connected, WebSocket bridge running in local-only mode');
      return;
    }

    try {
      const redisClient = getRedisClient();
      if (!redisClient) {
        log.warn('Redis client not available, WebSocket bridge running in local-only mode');
        return;
      }

      this.publishOnly = options.publishOnly === true;

      // Create dedicated pub/sub connections (required by Redis)
      // Subscriber connection enters pub/sub mode and can't be used for other commands
      this.publisher = redisClient.duplicate();
      this.subscriber = this.publishOnly ? null : redisClient.duplicate();

      // Wait for connections to be command-ready. Duplicate clients can reach
      // ready before listeners are attached, so handle already-ready clients.
      await Promise.all([
        this.waitForReady(this.publisher, 'Publisher'),
        ...(this.subscriber ? [this.waitForReady(this.subscriber, 'Subscriber')] : []),
      ]);

      if (this.subscriber) {
        // Subscribe to broadcast channel
        await this.subscriber.subscribe(WS_BROADCAST_CHANNEL, WS_AUTHORIZATION_CONTROL_CHANNEL);

        // Handle incoming messages
        this.subscriber.on('message', (channel: string, message: string) => {
          if (channel === WS_BROADCAST_CHANNEL) {
            this.handleBroadcastMessage(message);
          } else if (channel === WS_AUTHORIZATION_CONTROL_CHANNEL) {
            void this.handleControlMessage(message);
          }
        });

        this.subscriber.on('error', (err) => {
          log.error('Redis WebSocket bridge subscriber error', { error: err.message });
          this.metrics.errors++;
        });
      }

      // Handle connection errors
      this.publisher.on('error', (err) => {
        log.error('Redis WebSocket bridge publisher error', { error: err.message });
        this.metrics.errors++;
      });

      this.isInitialized = true;
      log.info('Redis WebSocket bridge initialized', { instanceId, publishOnly: this.publishOnly });
    } catch (error) {
      log.error('Failed to initialize Redis WebSocket bridge', {
        error: getErrorMessage(error),
      });
      // Clean up partial initialization
      await this.cleanup();
    }
  }

  /**
   * Set the handler for remote broadcasts
   * This should be called by the WebSocket server to receive events from other instances
   */
  setBroadcastHandler(handler: BroadcastHandler): void {
    this.broadcastHandler = handler;
  }

  setControlHandler(handler: ControlHandler): void {
    this.controlHandler = handler;
  }

  private waitForReady(client: Redis | null, label: string): Promise<void> {
    /* v8 ignore next -- constructor wiring guarantees Redis clients before readiness waits */
    if (!client) {
      return Promise.reject(new Error(`${label} client is not available`));
    }

    if (client.status === 'ready') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`${label} connection timeout`));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      /* v8 ignore next 3 -- Redis readiness error race is exercised in connected-bridge integration tests */
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      client.once('ready', onReady);
      client.once('error', onError);
    });
  }

  /**
   * Publish a WebSocket event to Redis for other instances
   */
  publishBroadcast(event: WebSocketEvent): void {
    if (!this.isInitialized || !this.publisher) {
      // Local-only mode - no Redis publishing
      return;
    }

    try {
      const envelope: WebSocketEnvelope = {
        event,
        instanceId,
        timestamp: Date.now(),
      };

      const published = this.publisher.publish(WS_BROADCAST_CHANNEL, JSON.stringify(envelope));
      void Promise.resolve(published).catch((error) => {
        log.error('Failed to publish WebSocket broadcast', {
          error: getErrorMessage(error), eventType: event.type,
        });
        this.metrics.errors++;
      });
      this.metrics.published++;
    } catch (error) {
      log.error('Failed to publish WebSocket broadcast', {
        error: getErrorMessage(error),
        eventType: event.type,
      });
      this.metrics.errors++;
    }
  }

  publishControl(control: WebSocketAuthorizationControl): void {
    if (!this.isInitialized || !this.publisher) return;
    const envelope: AuthorizationControlEnvelope = {
      control,
      instanceId,
      timestamp: Date.now(),
    };
    try {
      const published = this.publisher.publish(
        WS_AUTHORIZATION_CONTROL_CHANNEL,
        JSON.stringify(envelope),
      );
      void Promise.resolve(published).catch((error) => {
        log.error('Failed to publish WebSocket authorization control', {
          error: getErrorMessage(error), controlType: control.type,
        });
        this.metrics.errors++;
      });
      this.metrics.published++;
    } catch (error) {
      log.error('Failed to publish WebSocket authorization control', {
        error: getErrorMessage(error), controlType: control.type,
      });
      this.metrics.errors++;
    }
  }

  /**
   * Handle incoming message from Redis
   */
  private handleBroadcastMessage(message: string): void {
    try {
      const envelope = safeJsonParseUntyped<WebSocketEnvelope | null>(message, null, 'websocket broadcast');
      if (!envelope) {
        this.metrics.errors++;
        return;
      }

      // Skip our own messages (deduplication)
      if (envelope.instanceId === instanceId) {
        this.metrics.skippedSelf++;
        return;
      }

      // Invoke the broadcast handler
      if (this.broadcastHandler) {
        this.broadcastHandler(envelope.event);
        this.metrics.received++;
        log.debug('Received remote broadcast', {
          type: envelope.event.type,
          fromInstance: envelope.instanceId.substring(0, 8),
        });
      }
    } catch (error) {
      log.error('Failed to handle WebSocket broadcast message', {
        error: getErrorMessage(error),
      });
      this.metrics.errors++;
    }
  }

  private async handleControlMessage(message: string): Promise<void> {
    try {
      const parsed = safeJsonParseUntyped<unknown>(message, null, 'websocket authorization control');
      if (!isControlEnvelope(parsed)) {
        log.warn('Rejected malformed WebSocket authorization control');
        this.metrics.errors++;
        return;
      }
      if (parsed.instanceId === instanceId) {
        this.metrics.skippedSelf++;
        return;
      }
      if (!this.controlHandler) return;
      await this.controlHandler(parsed.control);
      this.metrics.received++;
    } catch (error) {
      log.error('Failed to handle WebSocket authorization control', {
        error: getErrorMessage(error),
      });
      this.metrics.errors++;
    }
  }

  /**
   * Clean up Redis connections
   */
  private async cleanup(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(WS_BROADCAST_CHANNEL, WS_AUTHORIZATION_CONTROL_CHANNEL);
        await this.subscriber.quit();
      } catch (error) {
        log.debug('Redis WebSocket subscriber cleanup failed', { error: getErrorMessage(error) });
        // Ignore cleanup errors
      }
      this.subscriber = null;
    }

    if (this.publisher) {
      try {
        await this.publisher.quit();
      } catch (error) {
        log.debug('Redis WebSocket publisher cleanup failed', { error: getErrorMessage(error) });
        // Ignore cleanup errors
      }
      this.publisher = null;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    log.info('Shutting down Redis WebSocket bridge', {
      metrics: this.getMetrics(),
    });

    await this.cleanup();
    this.isInitialized = false;
    this.publishOnly = false;
    this.broadcastHandler = null;
    this.controlHandler = null;
  }

  /**
   * Check if bridge is active (Redis connected and initialized)
   */
  isActive(): boolean {
    if (!this.isInitialized || this.publisher === null) return false;
    return this.publishOnly || this.subscriber !== null;
  }

  /**
   * Get bridge metrics for monitoring
   */
  getMetrics(): {
    published: number;
    received: number;
    errors: number;
    skippedSelf: number;
    isActive: boolean;
    instanceId: string;
  } {
    return {
      ...this.metrics,
      isActive: this.isActive(),
      instanceId,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      published: 0,
      received: 0,
      errors: 0,
      skippedSelf: 0,
    };
  }

  /**
   * Get instance ID (for testing/debugging)
   */
  getInstanceId(): string {
    return instanceId;
  }
}

/**
 * Singleton bridge instance
 */
export const redisBridge = new RedisWebSocketBridge();

/**
 * Initialize the Redis WebSocket bridge
 * Call after Redis is connected
 */
export async function initializeRedisBridge(
  options: RedisWebSocketBridgeOptions = {},
): Promise<void> {
  await redisBridge.initialize(options);
}

/**
 * Shutdown the Redis WebSocket bridge
 * Call during graceful shutdown
 */
export async function shutdownRedisBridge(): Promise<void> {
  await redisBridge.shutdown();
}
