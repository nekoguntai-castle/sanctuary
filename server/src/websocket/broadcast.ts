/**
 * Typed WebSocket Broadcast Helpers
 *
 * Type-safe broadcast functions that wrap the WebSocket server.
 * Use these instead of direct broadcast() calls for compile-time type checking.
 *
 * @example
 * // Instead of:
 * wsServer.broadcast({ type: 'balance', data: { ... }, walletId: '...' });
 *
 * // Use:
 * broadcastBalance(walletId, { balance: 10000, unconfirmed: 0, change: 100 });
 */

import { getWebSocketServer, getGatewayWebSocketServer } from './server';
import type {
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  BlockEvent,
  NewBlockEvent,
  MempoolEvent,
  SyncEvent,
  LogEvent,
  ModelDownloadEvent,
  BroadcastEvent,
} from './events';
import { EventBuilders } from './events';
import type { WebSocketEvent } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('WS:BROADCAST');

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert typed event to legacy format for existing broadcast implementation
 * This provides backward compatibility during migration
 */
function toLegacyEvent(event: BroadcastEvent): WebSocketEvent {
  if ('walletId' in event) {
    return {
      type: event.type,
      data: event.data,
      walletId: event.walletId,
    };
  }
  return {
    type: event.type,
    data: event.data,
  };
}

/**
 * Internal broadcast implementation
 */
function broadcastEvent(event: BroadcastEvent): void {
  try {
    const legacyEvent = toLegacyEvent(event);
    const wsServer = getWebSocketServer();
    wsServer.broadcast(legacyEvent);

    // Also send to gateway if connected
    const gatewayServer = getGatewayWebSocketServer();
    if (gatewayServer?.isGatewayConnected()) {
      gatewayServer.sendEvent(legacyEvent);
    }
  } catch (error) {
    // WebSocket server might not be initialized during startup
    log.debug('Broadcast skipped (server not ready)', { type: event.type });
  }
}

// =============================================================================
// Wallet-Specific Broadcasts
// =============================================================================

/**
 * Broadcast a transaction event to wallet subscribers
 */
export function broadcastTransaction(
  walletId: string,
  data: TransactionEvent['data']
): void {
  const event = EventBuilders.transaction(walletId, {
    ...data,
    timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp,
  });
  broadcastEvent(event);
  log.debug(`Transaction broadcast to wallet:${walletId}`, { txid: data.txid });
}

/**
 * Broadcast a balance update to wallet subscribers
 */
export function broadcastBalance(
  walletId: string,
  data: Omit<BalanceEvent['data'], 'timestamp'> & { timestamp?: Date | string }
): void {
  const event = EventBuilders.balance(walletId, {
    ...data,
    timestamp: data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : data.timestamp || new Date().toISOString(),
  });
  broadcastEvent(event);
  log.debug(`Balance broadcast to wallet:${walletId}`, {
    balance: data.balance,
    change: data.change,
  });
}

/**
 * Broadcast a confirmation update to wallet subscribers
 */
export function broadcastConfirmation(
  walletId: string,
  data: Omit<ConfirmationEvent['data'], 'timestamp'> & { timestamp?: Date | string }
): void {
  const event = EventBuilders.confirmation(walletId, {
    ...data,
    timestamp: data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : data.timestamp || new Date().toISOString(),
  });
  broadcastEvent(event);
  log.debug(`Confirmation broadcast to wallet:${walletId}`, {
    txid: data.txid,
    confirmations: data.confirmations,
  });
}

/**
 * Broadcast a sync status update to wallet subscribers
 */
export function broadcastSync(
  walletId: string,
  data: Omit<SyncEvent['data'], 'timestamp'> & { timestamp?: Date | string }
): void {
  const event = EventBuilders.sync(walletId, {
    ...data,
    timestamp: data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : data.timestamp || new Date().toISOString(),
  });
  broadcastEvent(event);
  log.debug(`Sync status broadcast to wallet:${walletId}`, {
    inProgress: data.inProgress,
    status: data.status,
  });
}

/**
 * Broadcast a log entry to wallet subscribers
 */
export function broadcastLog(walletId: string, data: LogEvent['data']): void {
  const event = EventBuilders.log(walletId, data);
  broadcastEvent(event);
  // Don't log broadcast of logs to prevent recursion
}

// =============================================================================
// Global Broadcasts
// =============================================================================

/**
 * Broadcast a new block (full details) to block subscribers
 */
export function broadcastBlock(
  data: Omit<BlockEvent['data'], 'timestamp'> & { timestamp?: Date | string }
): void {
  const event = EventBuilders.block({
    ...data,
    timestamp: data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : data.timestamp || new Date().toISOString(),
  });
  broadcastEvent(event);
  log.debug(`Block broadcast`, { height: data.height, hash: data.hash });
}

/**
 * Broadcast a new block (minimal) to block subscribers
 */
export function broadcastNewBlock(
  data: Omit<NewBlockEvent['data'], 'timestamp'> & { timestamp?: Date | string }
): void {
  const event = EventBuilders.newBlock({
    ...data,
    timestamp: data.timestamp instanceof Date
      ? data.timestamp.toISOString()
      : data.timestamp || new Date().toISOString(),
  });
  broadcastEvent(event);
  log.debug(`New block broadcast`, { height: data.height });
}

/**
 * Broadcast a mempool update to mempool subscribers
 */
export function broadcastMempool(data: MempoolEvent['data']): void {
  const event = EventBuilders.mempool(data);
  broadcastEvent(event);
  // Don't log mempool broadcasts as they're high-frequency
}

/**
 * Broadcast a model download progress update
 */
export function broadcastModelDownload(data: ModelDownloadEvent['data']): void {
  const event = EventBuilders.modelDownload(data);
  broadcastEvent(event);
  log.debug(`Model download broadcast`, {
    model: data.model,
    status: data.status,
    percent: data.percent,
  });
}

// =============================================================================
// Generic Typed Broadcast
// =============================================================================

/**
 * Broadcast any typed event
 * Use this for events that don't have a specific helper
 */
export function broadcast(event: BroadcastEvent): void {
  broadcastEvent(event);
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Extract event data type from event type
 */
export type EventData<T extends BroadcastEvent['type']> = Extract<
  BroadcastEvent,
  { type: T }
>['data'];

/**
 * Check if a wallet is subscribed to events
 */
export function hasWalletSubscribers(walletId: string): boolean {
  try {
    const wsServer = getWebSocketServer();
    const stats = wsServer.getStats();
    return stats.channelList.some((ch) => ch.startsWith(`wallet:${walletId}`));
  } catch {
    return false;
  }
}

/**
 * Get current broadcast statistics
 */
export function getBroadcastStats(): {
  connected: boolean;
  clients: number;
  channels: string[];
  gatewayConnected: boolean;
} {
  try {
    const wsServer = getWebSocketServer();
    const stats = wsServer.getStats();
    const gatewayServer = getGatewayWebSocketServer();

    return {
      connected: true,
      clients: stats.clients,
      channels: stats.channelList,
      gatewayConnected: gatewayServer?.isGatewayConnected() ?? false,
    };
  } catch {
    return {
      connected: false,
      clients: 0,
      channels: [],
      gatewayConnected: false,
    };
  }
}
