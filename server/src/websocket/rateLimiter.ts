/**
 * WebSocket Rate Limiter
 *
 * Provides rate limiting for WebSocket messages with:
 * - Grace period after connection for initial setup burst (auth + subscriptions)
 * - Per-second rate limiting after grace period
 * - Rate limit event tracking for admin visibility
 */

import { createLogger } from '../utils/logger';
import {
  websocketMessagesTotal,
  websocketRateLimitHits,
} from '../observability/metrics';
import {
  MAX_MESSAGES_PER_SECOND,
  RATE_LIMIT_GRACE_PERIOD_MS,
  GRACE_PERIOD_MESSAGE_LIMIT,
  MAX_RATE_LIMIT_EVENTS,
  RateLimitEvent,
  AuthenticatedWebSocket,
} from './types';

const log = createLogger('WS_RATE_LIMIT');

// ============================================================================
// Rate Limit Event Tracking
// ============================================================================

/** Buffer of recent rate limit events for admin visibility */
const rateLimitEvents: RateLimitEvent[] = [];

/** Track dropped messages for observability */
let droppedMessagesTotal = 0;

/**
 * Record a rate limit event for admin visibility
 */
export function recordRateLimitEvent(
  userId: string | null,
  reason: RateLimitEvent['reason'],
  details: string
): void {
  rateLimitEvents.unshift({
    timestamp: new Date().toISOString(),
    userId,
    reason,
    details,
  });
  // Keep only the most recent events
  if (rateLimitEvents.length > MAX_RATE_LIMIT_EVENTS) {
    rateLimitEvents.pop();
  }
}

/**
 * Get recent rate limit events (used by admin API)
 */
export function getRateLimitEvents(): RateLimitEvent[] {
  return [...rateLimitEvents];
}

/**
 * Get the total number of dropped messages across all clients
 */
export function getDroppedMessagesTotal(): number {
  return droppedMessagesTotal;
}

/**
 * Increment the global dropped messages counter
 */
export function incrementDroppedMessages(): void {
  droppedMessagesTotal++;
}

/**
 * Callback interface for rate limiter operations that need to interact with the server
 */
export interface RateLimiterCallbacks {
  /** Send a message to the client */
  sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean;
}

/**
 * Check rate limits for an incoming message.
 *
 * @returns true if the message should be processed, false if rate limited
 */
export function checkRateLimit(
  client: AuthenticatedWebSocket,
  callbacks: RateLimiterCallbacks
): boolean {
  // Track incoming WebSocket message metric
  websocketMessagesTotal.inc({ type: 'main', direction: 'in' });

  const now = Date.now();
  client.totalMessageCount++;

  // Check if we're still in the grace period (allows initial auth + subscription burst)
  const inGracePeriod = (now - client.connectionTime) < RATE_LIMIT_GRACE_PERIOD_MS;

  if (inGracePeriod) {
    // During grace period, only check total message limit (more lenient)
    if (client.totalMessageCount > GRACE_PERIOD_MESSAGE_LIMIT) {
      log.warn('Grace period message limit exceeded, closing connection', {
        userId: client.userId,
        totalMessageCount: client.totalMessageCount,
      });
      // Record metric and event
      websocketRateLimitHits.inc({ reason: 'grace_period_exceeded' });
      recordRateLimitEvent(
        client.userId || null,
        'grace_period_exceeded',
        `${client.totalMessageCount}/${GRACE_PERIOD_MESSAGE_LIMIT} messages during setup`
      );
      // Notify user before disconnecting
      callbacks.sendToClient(client, {
        type: 'error',
        data: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Message limit exceeded during connection setup (${client.totalMessageCount}/${GRACE_PERIOD_MESSAGE_LIMIT})`,
          hint: 'Consider using batch subscriptions or increase WS_GRACE_PERIOD_LIMIT',
        },
      });
      client.closeReason = 'rate_limit';
      client.close(1008, 'Rate limit exceeded');
      return false;
    }
  } else {
    // After grace period, enforce strict per-second rate limiting
    if (now - client.lastMessageReset >= 1000) {
      // Reset counter every second
      client.messageCount = 0;
      client.lastMessageReset = now;
    }

    client.messageCount++;
    if (client.messageCount > MAX_MESSAGES_PER_SECOND) {
      log.warn('Rate limit exceeded, closing connection', {
        userId: client.userId,
        messageCount: client.messageCount,
      });
      // Record metric and event
      websocketRateLimitHits.inc({ reason: 'per_second_exceeded' });
      recordRateLimitEvent(
        client.userId || null,
        'per_second_exceeded',
        `${client.messageCount}/${MAX_MESSAGES_PER_SECOND} messages/sec`
      );
      // Notify user before disconnecting
      callbacks.sendToClient(client, {
        type: 'error',
        data: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Message rate limit exceeded (${client.messageCount}/${MAX_MESSAGES_PER_SECOND} per second)`,
          hint: 'Reduce message frequency or increase MAX_WS_MESSAGES_PER_SECOND',
        },
      });
      client.closeReason = 'rate_limit';
      client.close(1008, 'Rate limit exceeded');
      return false;
    }
  }

  return true;
}
