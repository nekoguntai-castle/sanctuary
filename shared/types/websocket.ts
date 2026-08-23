/**
 * Shared WebSocket Event Types
 *
 * Typed event definitions using discriminated unions for type-safe
 * WebSocket communication between server and clients.
 *
 * This is the single source of truth for WebSocket message types.
 * Both frontend and backend import from this file.
 */

import type {
  SyncExecutionOwner,
  SyncLifecycleTransitionKind,
  WalletSyncFailureClass,
} from '../constants/sync';

// =============================================================================
// Client-to-Server Messages
// =============================================================================

export const WEBSOCKET_CLIENT_MESSAGE_TYPES = [
  'auth',
  'subscribe',
  'unsubscribe',
  'subscribe_batch',
  'unsubscribe_batch',
  'ping',
  'pong',
] as const;

export type WebSocketClientMessageType = typeof WEBSOCKET_CLIENT_MESSAGE_TYPES[number];

export interface AuthMessage {
  type: 'auth';
  data: {
    token: string;
  };
}

export interface SubscribeMessage {
  type: 'subscribe';
  data: {
    channel: string; // e.g., 'wallet:uuid', 'global'
  };
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  data: {
    channel: string;
  };
}

export interface SubscribeBatchMessage {
  type: 'subscribe_batch';
  data: {
    channels: string[];
  };
}

export interface UnsubscribeBatchMessage {
  type: 'unsubscribe_batch';
  data: {
    channels: string[];
  };
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

/**
 * All possible client-to-server messages
 */
export type ClientMessage =
  | AuthMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | SubscribeBatchMessage
  | UnsubscribeBatchMessage
  | PingMessage
  | PongMessage;

// =============================================================================
// Server-to-Client Events
// =============================================================================

export const WEBSOCKET_WALLET_EVENT_TYPES = [
  'transaction',
  'balance',
  'confirmation',
  'sync',
  'log',
] as const;

export type WebSocketWalletEventType = typeof WEBSOCKET_WALLET_EVENT_TYPES[number];

export const WEBSOCKET_GLOBAL_EVENT_TYPES = [
  'block',
  'newBlock',
  'mempool',
] as const;

export type WebSocketGlobalEventType = typeof WEBSOCKET_GLOBAL_EVENT_TYPES[number];

export const WEBSOCKET_BROADCAST_EVENT_TYPES = [
  ...WEBSOCKET_WALLET_EVENT_TYPES,
  ...WEBSOCKET_GLOBAL_EVENT_TYPES,
] as const;

export type WebSocketBroadcastEventType = typeof WEBSOCKET_BROADCAST_EVENT_TYPES[number];

export const WEBSOCKET_CONTROL_EVENT_TYPES = [
  'connected',
  'authenticated',
  'subscribed',
  'unsubscribed',
  'subscribed_batch',
  'unsubscribed_batch',
  'error',
] as const;

export type WebSocketControlEventType = typeof WEBSOCKET_CONTROL_EVENT_TYPES[number];

export const WEBSOCKET_SERVER_EVENT_TYPES = [
  ...WEBSOCKET_CONTROL_EVENT_TYPES,
  ...WEBSOCKET_BROADCAST_EVENT_TYPES,
] as const;

export type WebSocketServerEventType = typeof WEBSOCKET_SERVER_EVENT_TYPES[number];

/**
 * Connection established
 */
export interface ConnectedEvent {
  type: 'connected';
  data: {
    message: string;
  };
}

/**
 * Authentication successful
 */
export interface AuthenticatedEvent {
  type: 'authenticated';
  data: {
    userId: string;
    message: string;
  };
}

/**
 * Subscription confirmed
 */
export interface SubscribedEvent {
  type: 'subscribed';
  data: {
    channel: string;
  };
}

/**
 * Unsubscription confirmed
 */
export interface UnsubscribedEvent {
  type: 'unsubscribed';
  data: {
    channel: string;
  };
}

/**
 * Batch subscription confirmed
 */
export interface SubscribedBatchEvent {
  type: 'subscribed_batch';
  data: {
    subscribed: string[];
    errors?: Array<{ channel: string; reason: string }>;
  };
}

/**
 * Batch unsubscription confirmed
 */
export interface UnsubscribedBatchEvent {
  type: 'unsubscribed_batch';
  data: {
    unsubscribed: string[];
  };
}

/**
 * Error occurred
 */
export interface ErrorEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

/**
 * New transaction received or sent
 */
export interface TransactionEvent {
  type: 'transaction';
  walletId: string;
  data: {
    txid: string;
    type: 'received' | 'sent' | 'consolidation';
    amount: number; // satoshis
    confirmations: number;
    blockHeight?: number;
    timestamp: Date | string;
  };
}

/**
 * Wallet balance updated
 */
export interface BalanceEvent {
  type: 'balance';
  walletId: string;
  data: {
    balance: number; // satoshis (confirmed)
    unconfirmed: number; // satoshis
    change: number; // difference from previous
    timestamp: Date | string;
  };
}

/**
 * Transaction confirmation count changed
 */
export interface ConfirmationEvent {
  type: 'confirmation';
  walletId: string;
  data: {
    txid: string;
    confirmations: number;
    previousConfirmations?: number;
    timestamp: Date | string;
  };
}

/**
 * New block received (full details)
 */
export interface BlockEvent {
  type: 'block';
  data: {
    height: number;
    hash: string;
    timestamp: Date | string;
    transactionCount: number;
  };
}

/**
 * New block received (minimal - just height)
 */
export interface NewBlockEvent {
  type: 'newBlock';
  data: {
    height: number;
    timestamp: Date | string;
  };
}

/**
 * Mempool transaction update
 */
export interface MempoolEvent {
  type: 'mempool';
  data: {
    txid: string;
    fee: number; // satoshis
    size: number; // bytes
    feeRate: number; // sat/vB
  };
}

/**
 * Wallet sync status update
 */
export interface SyncEvent {
  type: 'sync';
  walletId: string;
  data: {
    inProgress: boolean;
    transition?: SyncLifecycleTransitionKind;
    status?: string;
    syncStatus?: string | null;
    error?: string | null;
    failureClass?: WalletSyncFailureClass | null;
    lastSyncedAt?: Date | string | null;
    executionOwner?: SyncExecutionOwner | null;
    retryCount?: number;
    nextRetryAt?: Date | string | null;
    startedAt?: Date | string | null;
    stateVersion?: number;
    requestedIncrementalSyncGeneration?: number;
    claimedIncrementalSyncGeneration?: number;
    processedIncrementalSyncGeneration?: number;
    incrementalSyncClaimedAt?: Date | string | null;
    incrementalSyncLeaseExpiresAt?: Date | string | null;
    syncActionRequiredAt?: Date | string | null;
    requestedFullResyncGeneration?: number;
    preparedFullResyncGeneration?: number;
    processedFullResyncGeneration?: number;
    maxRetries?: number;
    retryingIn?: number;
    retriesExhausted?: boolean;
    timestamp: Date | string;
  };
}

/**
 * Real-time wallet log entry
 */
export interface LogEvent {
  type: 'log';
  walletId: string;
  data: {
    id: string;
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    module: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * All possible server-to-client events
 */
export type ServerEvent =
  | ConnectedEvent
  | AuthenticatedEvent
  | SubscribedEvent
  | UnsubscribedEvent
  | SubscribedBatchEvent
  | UnsubscribedBatchEvent
  | ErrorEvent
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | BlockEvent
  | NewBlockEvent
  | MempoolEvent
  | SyncEvent
  | LogEvent;

/**
 * Events that are wallet-specific (have walletId)
 */
export type WalletEvent =
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | SyncEvent
  | LogEvent;

/**
 * Events that are global (no walletId)
 */
export type GlobalEvent = BlockEvent | NewBlockEvent | MempoolEvent;

/**
 * Broadcast events (sent to subscribed clients)
 */
export type BroadcastEvent =
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | BlockEvent
  | NewBlockEvent
  | MempoolEvent
  | SyncEvent
  | LogEvent;

// =============================================================================
// Shared Channel Helpers
// =============================================================================

export const WEBSOCKET_GLOBAL_CHANNELS = {
  blocks: 'blocks',
  mempool: 'mempool',
  syncAll: 'sync:all',
  transactionsAll: 'transactions:all',
  logsAll: 'logs:all',
} as const;

export type WebSocketGlobalChannel =
  typeof WEBSOCKET_GLOBAL_CHANNELS[keyof typeof WEBSOCKET_GLOBAL_CHANNELS];

export const WEBSOCKET_WALLET_CHANNEL_PATTERN = /^wallet:([a-f0-9-]+)/;

export function isWebSocketWalletChannel(channel: string): channel is `wallet:${string}` {
  return channel.startsWith('wallet:');
}

export function getWalletIdFromWebSocketChannel(channel: string): string | null {
  const match = channel.match(WEBSOCKET_WALLET_CHANNEL_PATTERN);
  return match?.[1] ?? null;
}

export const WebSocketChannels = {
  blocks: (): WebSocketGlobalChannel => WEBSOCKET_GLOBAL_CHANNELS.blocks,
  mempool: (): WebSocketGlobalChannel => WEBSOCKET_GLOBAL_CHANNELS.mempool,
  syncAll: (): WebSocketGlobalChannel => WEBSOCKET_GLOBAL_CHANNELS.syncAll,
  transactionsAll: (): WebSocketGlobalChannel => WEBSOCKET_GLOBAL_CHANNELS.transactionsAll,
  logsAll: (): WebSocketGlobalChannel => WEBSOCKET_GLOBAL_CHANNELS.logsAll,
  allGlobal: (): WebSocketGlobalChannel[] => [
    WEBSOCKET_GLOBAL_CHANNELS.blocks,
    WEBSOCKET_GLOBAL_CHANNELS.syncAll,
    WEBSOCKET_GLOBAL_CHANNELS.transactionsAll,
    WEBSOCKET_GLOBAL_CHANNELS.logsAll,
  ],
  wallet: (walletId: string): `wallet:${string}` => `wallet:${walletId}`,
  walletEvent: (
    walletId: string,
    eventType: WebSocketWalletEventType
  ): `wallet:${string}:${WebSocketWalletEventType}` => `wallet:${walletId}:${eventType}`,
  address: (addressId: string): `address:${string}` => `address:${addressId}`,
  listener: (channel: string): `channel:${string}` => `channel:${channel}`,
} as const;

export function isWebSocketWalletEventType(type: string): type is WebSocketWalletEventType {
  return (WEBSOCKET_WALLET_EVENT_TYPES as readonly string[]).includes(type);
}

export function isWebSocketGlobalEventType(type: string): type is WebSocketGlobalEventType {
  return (WEBSOCKET_GLOBAL_EVENT_TYPES as readonly string[]).includes(type);
}

// =============================================================================
// Shared Type Guards
// =============================================================================

/**
 * Check if a value is a valid server event
 */
export function isServerEvent(event: unknown): event is ServerEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.type === 'string' &&
    (WEBSOCKET_SERVER_EVENT_TYPES as readonly string[]).includes(e.type)
  );
}

/**
 * Check if a message is a valid client message
 */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    (WEBSOCKET_CLIENT_MESSAGE_TYPES as readonly string[]).includes(m.type)
  );
}

/**
 * Check if an event is wallet-specific (requires walletId)
 */
export function isWalletEvent(
  event: ServerEvent
): event is TransactionEvent | BalanceEvent | ConfirmationEvent | SyncEvent | LogEvent {
  return isWebSocketWalletEventType(event.type);
}

/**
 * Check if an event is global (no walletId)
 */
export function isGlobalEvent(
  event: ServerEvent
): event is BlockEvent | NewBlockEvent | MempoolEvent {
  return isWebSocketGlobalEventType(event.type);
}
