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
  PingMessage,
  PongMessage,
  ClientMessage,
  // Server events
  ConnectedEvent,
  AuthenticatedEvent,
  SubscribedEvent,
  UnsubscribedEvent,
  ErrorEvent,
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  BlockEvent,
  NewBlockEvent,
  MempoolEvent,
  SyncEvent,
  LogEvent,
  ModelDownloadEvent,
  ServerEvent,
  WalletEvent,
  GlobalEvent,
  BroadcastEvent,
  // Type guards
  isServerEvent,
  isClientMessage,
  isWalletEvent,
  isGlobalEvent,
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
  ModelDownloadEvent,
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

  modelDownload(data: ModelDownloadEvent['data']): ModelDownloadEvent {
    return { type: 'modelDownload', data };
  },

  error(message: string, code?: string): ErrorEvent {
    return { type: 'error', data: { message, code } };
  },
};
