/**
 * WebSocket Types and Constants
 *
 * Shared types, interfaces, and configuration for WebSocket servers.
 */

import { WebSocket } from 'ws';
import type { BroadcastEvent, ClientMessage } from '@sanctuary/shared/types/websocket';

// ============================================================================
// Connection Limits
// ============================================================================

/** Timeout for unauthenticated connections */
export const AUTH_TIMEOUT_MS = 30000; // 30 seconds

/** Maximum total WebSocket connections */
export const MAX_WEBSOCKET_CONNECTIONS = parseInt(process.env.MAX_WEBSOCKET_CONNECTIONS || '10000', 10);

/** Maximum WebSocket connections per user */
export const MAX_WEBSOCKET_PER_USER = parseInt(process.env.MAX_WEBSOCKET_PER_USER || '10', 10);

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/** Maximum messages per second per connection */
export const MAX_MESSAGES_PER_SECOND = parseInt(process.env.MAX_WS_MESSAGES_PER_SECOND || '30', 10);

/**
 * Subscription limit: 5 channels per wallet + 4 global channels
 * Default 1100 supports ~219 wallets, configurable via environment variable
 */
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = parseInt(process.env.MAX_WS_SUBSCRIPTIONS || '1100', 10);

/**
 * Grace period for initial connection setup (auth + subscriptions)
 * With batch subscriptions: ~3 messages (auth + global batch + wallets batch)
 * Without batch: 1 + (wallets) messages - limit 500 supports many wallets
 */
export const RATE_LIMIT_GRACE_PERIOD_MS = 5000; // 5 seconds grace period after connection
export const GRACE_PERIOD_MESSAGE_LIMIT = parseInt(process.env.WS_GRACE_PERIOD_LIMIT || '500', 10);

/** Maximum rate limit events to buffer for admin visibility */
export const MAX_RATE_LIMIT_EVENTS = 50;

// ============================================================================
// Bounded Message Queue Configuration
// ============================================================================

/**
 * Maximum messages to queue per client before applying backpressure
 * Prevents memory exhaustion from slow consumers
 */
export const MAX_QUEUE_SIZE = parseInt(process.env.WS_MAX_QUEUE_SIZE || '100', 10);

/**
 * Policy for handling queue overflow
 * - 'drop_oldest': Drop oldest messages to make room (default)
 * - 'drop_newest': Reject new messages when full
 * - 'disconnect': Disconnect slow consumers
 */
export type QueueOverflowPolicy = 'drop_oldest' | 'drop_newest' | 'disconnect';
export const QUEUE_OVERFLOW_POLICY: QueueOverflowPolicy =
  (process.env.WS_QUEUE_OVERFLOW_POLICY as QueueOverflowPolicy) || 'drop_oldest';

// ============================================================================
// Gateway Configuration
// ============================================================================

/** Timeout for gateway authentication */
export const GATEWAY_AUTH_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Types and Interfaces
// ============================================================================

/** Rate limit event for admin visibility */
export interface RateLimitEvent {
  timestamp: string;
  userId: string | null;
  reason: 'grace_period_exceeded' | 'per_second_exceeded' | 'subscription_limit' | 'queue_overflow';
  details: string;
}

/** Extended WebSocket with authentication and subscription state */
export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  authTimeout?: NodeJS.Timeout;
  messageCount: number;
  lastMessageReset: number;
  connectionTime: number;
  totalMessageCount: number;
  closeReason?: 'normal' | 'rate_limit' | 'auth_timeout' | 'error' | 'queue_overflow';
  // Bounded message queue for backpressure
  messageQueue: Array<string>;
  isProcessingQueue: boolean;
  droppedMessages: number;
}

/** WebSocket message types from client */
export type WebSocketMessage = ClientMessage;

/**
 * WebSocket event for broadcasting
 * @deprecated Use typed events from './events' instead
 */
export interface WebSocketEvent {
  type: BroadcastEvent['type'];
  data: unknown;
  walletId?: string;
  addressId?: string;
}

/** Gateway WebSocket with HMAC authentication state */
export interface GatewayWebSocket extends WebSocket {
  isAuthenticated: boolean;
  authTimeout?: NodeJS.Timeout;
  challenge?: string;
}
