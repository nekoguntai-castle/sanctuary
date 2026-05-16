/**
 * WebSocket Event Types (Server)
 *
 * Re-exports shared WebSocket types and adds server-specific EventBuilders.
 */

// Import and re-export all shared types and type guards
export {
  // Client messages
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  SubscribeBatchMessage,
  UnsubscribeBatchMessage,
  PingMessage,
  PongMessage,
  ClientMessage,
  WebSocketClientMessageType,
  // Server events
  ConnectedEvent,
  AuthenticatedEvent,
  SubscribedEvent,
  UnsubscribedEvent,
  SubscribedBatchEvent,
  UnsubscribedBatchEvent,
  ErrorEvent,
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  BlockEvent,
  NewBlockEvent,
  MempoolEvent,
  SyncEvent,
  LogEvent,
  ServerEvent,
  WalletEvent,
  GlobalEvent,
  BroadcastEvent,
  WebSocketWalletEventType,
  WebSocketGlobalEventType,
  WebSocketBroadcastEventType,
  WebSocketControlEventType,
  WebSocketServerEventType,
  WebSocketGlobalChannel,
  // Constants and channel helpers
  WEBSOCKET_CLIENT_MESSAGE_TYPES,
  WEBSOCKET_WALLET_EVENT_TYPES,
  WEBSOCKET_GLOBAL_EVENT_TYPES,
  WEBSOCKET_BROADCAST_EVENT_TYPES,
  WEBSOCKET_CONTROL_EVENT_TYPES,
  WEBSOCKET_SERVER_EVENT_TYPES,
  WEBSOCKET_GLOBAL_CHANNELS,
  WEBSOCKET_WALLET_CHANNEL_PATTERN,
  WebSocketChannels,
  // Type guards
  isServerEvent,
  isClientMessage,
  isWalletEvent,
  isGlobalEvent,
  isWebSocketWalletChannel,
  getWalletIdFromWebSocketChannel,
  isWebSocketWalletEventType,
  isWebSocketGlobalEventType,
} from '@sanctuary/shared/types/websocket';

import type {
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  BlockEvent,
  NewBlockEvent,
  MempoolEvent,
  SyncEvent,
  LogEvent,
  ErrorEvent,
} from '@sanctuary/shared/types/websocket';

// =============================================================================
// Event Builders (type-safe factory functions)
// =============================================================================

export const EventBuilders = {
  transaction(
    walletId: string,
    data: TransactionEvent['data']
  ): TransactionEvent {
    return { type: 'transaction', walletId, data };
  },

  balance(walletId: string, data: BalanceEvent['data']): BalanceEvent {
    return { type: 'balance', walletId, data };
  },

  confirmation(
    walletId: string,
    data: ConfirmationEvent['data']
  ): ConfirmationEvent {
    return { type: 'confirmation', walletId, data };
  },

  block(data: BlockEvent['data']): BlockEvent {
    return { type: 'block', data };
  },

  newBlock(data: NewBlockEvent['data']): NewBlockEvent {
    return { type: 'newBlock', data };
  },

  mempool(data: MempoolEvent['data']): MempoolEvent {
    return { type: 'mempool', data };
  },

  sync(walletId: string, data: SyncEvent['data']): SyncEvent {
    return { type: 'sync', walletId, data };
  },

  log(walletId: string, data: LogEvent['data']): LogEvent {
    return { type: 'log', walletId, data };
  },

  error(message: string, code?: string): ErrorEvent {
    return { type: 'error', data: { message, code } };
  },
};
