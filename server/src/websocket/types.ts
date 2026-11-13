/**
 * WebSocket Types and Constants
 *
 * Shared types, interfaces, and configuration for WebSocket servers.
 */

import { WebSocket } from 'ws';
import type { BroadcastEvent, ClientMessage } from '@sanctuary/shared/types/websocket';
import {
  GATEWAY_PUSH_EVENT_TYPES,
  type GatewayPushEventType,
} from '@sanctuary/shared/constants/gatewayEvents';
import type { WebSocketConfig } from '../config/types';
import { loadWebsocketConfig } from '../config/websocketLimits';
import type { JWTPayload } from '../utils/jwt';

// ============================================================================
// Connection Limits
// ============================================================================

/** Timeout for unauthenticated connections */
export const AUTH_TIMEOUT_MS = 30000; // 30 seconds

// One validated reader for these limits: see config/websocketLimits.ts.
const limits = loadWebsocketConfig();

/** Maximum total WebSocket connections */
export const MAX_WEBSOCKET_CONNECTIONS = limits.maxConnections;

/** Maximum WebSocket connections per user */
export const MAX_WEBSOCKET_PER_USER = limits.maxPerUser;

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/** Maximum messages per second per connection */
export const MAX_MESSAGES_PER_SECOND = limits.maxMessagesPerSecond;

/**
 * Subscription limit: 5 channels per wallet + 4 global channels
 * Default 1100 supports ~219 wallets, configurable via environment variable
 */
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = limits.maxSubscriptionsPerConnection;

/**
 * Grace period for initial connection setup (auth + subscriptions)
 * With batch subscriptions: ~3 messages (auth + global batch + wallets batch)
 * Without batch: 1 + (wallets) messages - limit 500 supports many wallets
 */
export const RATE_LIMIT_GRACE_PERIOD_MS = 5000; // 5 seconds grace period after connection
export const GRACE_PERIOD_MESSAGE_LIMIT = limits.gracePeriodMessageLimit;

/** Maximum rate limit events to buffer for admin visibility */
export const MAX_RATE_LIMIT_EVENTS = 50;

// ============================================================================
// Bounded Message Queue Configuration
// ============================================================================

/**
 * Maximum messages to queue per client before applying backpressure
 * Prevents memory exhaustion from slow consumers
 */
export const MAX_QUEUE_SIZE = limits.maxQueueSize;

/**
 * Policy for handling queue overflow
 * - 'drop_oldest': Drop oldest messages to make room (default)
 * - 'drop_newest': Reject new messages when full
 * - 'disconnect': Disconnect slow consumers
 */
export type QueueOverflowPolicy = WebSocketConfig['queueOverflowPolicy'];
export const QUEUE_OVERFLOW_POLICY: QueueOverflowPolicy = limits.queueOverflowPolicy;

// ============================================================================
// Gateway Configuration
// ============================================================================

/** Timeout for gateway authentication */
export const GATEWAY_AUTH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Largest inbound frame each server accepts. `ws` buffers a whole frame before
 * any rate limit or schema check runs (and `/ws` accepts unauthenticated
 * sockets), so the library default of 100 MiB is a memory-exhaustion vector.
 * An oversized frame closes the socket with code 1009.
 *
 * Client: the largest legitimate message is a ~1100-channel `subscribe_batch`
 * (under 100 KiB). Gateway: only `auth_response` is ever received.
 */
export const CLIENT_WS_MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB
export const GATEWAY_WS_MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KiB

/** Bound audience enrichment so one database read cannot stall every later push. */
export const GATEWAY_EVENT_PREPARATION_TIMEOUT_MS = 10000;

/** How long an undelivered push event waits for a gateway before it is recorded as lost. */
export const GATEWAY_HELD_EVENT_TTL_MS = 10 * 60 * 1000;

/** Most undelivered push events held at once; the oldest is recorded as lost beyond this. */
export const GATEWAY_HELD_EVENT_LIMIT = 200;

/**
 * Failed audience lookups after which a held push event is suspected of being
 * the cause. It is recorded as lost only if the next event's lookup then
 * works; while every lookup fails, events are kept until the hold window ends.
 */
export const GATEWAY_EVENT_MAX_PREPARATION_FAILURES = 3;

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
  authJti?: string;
  authExpiresAt?: number;
  authSessionVersion?: number;
  authClaims?: JWTPayload;
  authExpiryTimeout?: NodeJS.Timeout;
  subscriptions: Set<string>;
  subscriptionGeneration: number;
  isAlive: boolean;
  authTimeout?: NodeJS.Timeout;
  messageCount: number;
  lastMessageReset: number;
  connectionTime: number;
  totalMessageCount: number;
  closeReason?: 'normal' | 'rate_limit' | 'auth_timeout' | 'auth_expired' | 'auth_revoked' | 'error' | 'queue_overflow';
  // Bounded message queue for backpressure
  messageQueue: Array<string>;
  isProcessingQueue: boolean;
  isQueueStopped: boolean;
  droppedMessages: number;
}

export function bumpSubscriptionGeneration(client: AuthenticatedWebSocket): void {
  client.subscriptionGeneration = (client.subscriptionGeneration ?? 0) + 1;
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

/**
 * Wallet-level push events that only the push gateway consumes (event types:
 * `GATEWAY_PUSH_EVENT_TYPES` in `@sanctuary/shared/constants/gatewayEvents`).
 *
 * The payloads are server-only on purpose: they carry a private recipient list (`userIds`), so
 * they are never part of the shared, frontend-visible `BroadcastEvent` union
 * and never reach browser clients. Payloads stay minimal (decision D-4): no AI
 * summary text, amounts or UTXO counts.
 */
export interface AIInsightGatewayPushEvent {
  type: 'ai_insight';
  walletId: string;
  walletName: string;
  userIds: string[];
  data: {
    insightId: string;
    insightType: string;
    /** Human label from INSIGHT_TYPE_LABELS, so the gateway needs no copy of the map. */
    insightTypeLabel?: string;
    severity: string;
  };
}

export interface ConsolidationGatewayPushEvent {
  type: 'consolidation_suggestion';
  walletId: string;
  walletName: string;
  userIds: string[];
  data: { feeRate: number };
}

export type GatewayPushEvent = AIInsightGatewayPushEvent | ConsolidationGatewayPushEvent;

export function isGatewayPushEventType(type: string): type is GatewayPushEventType {
  return (GATEWAY_PUSH_EVENT_TYPES as readonly string[]).includes(type);
}

export function isGatewayPushEvent(event: WebSocketEvent | GatewayPushEvent): event is GatewayPushEvent {
  return isGatewayPushEventType(event.type);
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseInsightData(data: UnknownRecord): AIInsightGatewayPushEvent['data'] | null {
  const { insightId, insightType, insightTypeLabel, severity } = data;
  if (!isNonEmptyString(insightId) || !isNonEmptyString(insightType) || !isNonEmptyString(severity)) {
    return null;
  }
  if (insightTypeLabel === undefined) return { insightId, insightType, severity };
  return typeof insightTypeLabel === 'string'
    ? { insightId, insightType, insightTypeLabel, severity }
    : null;
}

function parseConsolidationData(data: UnknownRecord): ConsolidationGatewayPushEvent['data'] | null {
  return typeof data.feeRate === 'number' && Number.isFinite(data.feeRate)
    ? { feeRate: data.feeRate }
    : null;
}

/**
 * Rebuild a gateway push event from its validated fields only. Anything else
 * an envelope carries (a top-level `userId`, extra `data` keys) is dropped,
 * and a wrongly typed field rejects the whole event (null). Push events cross
 * Redis, so whoever can write there must not be able to steer the gateway.
 */
export function parseGatewayPushEvent(value: unknown): GatewayPushEvent | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const { type, walletId, walletName, userIds, data } = value;
  if (!isNonEmptyString(walletId) || typeof walletName !== 'string' ||
    !Array.isArray(userIds) || !userIds.every(isNonEmptyString)) {
    return null;
  }
  const base = { walletId, walletName, userIds: [...userIds] };
  if (type === 'ai_insight') {
    const insight = parseInsightData(data);
    return insight && { type, ...base, data: insight };
  }
  if (type === 'consolidation_suggestion') {
    const consolidation = parseConsolidationData(data);
    return consolidation && { type, ...base, data: consolidation };
  }
  return null;
}

/** Gateway WebSocket with HMAC authentication state */
export interface GatewayWebSocket extends WebSocket {
  isAuthenticated: boolean;
  /** Cleared before each heartbeat ping, set again by the gateway's pong. */
  isAlive?: boolean;
  authTimeout?: NodeJS.Timeout;
  challenge?: string;
}
