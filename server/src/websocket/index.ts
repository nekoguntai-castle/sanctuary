/**
 * WebSocket Module Exports
 *
 * Central export point for WebSocket functionality.
 */

// Server exports
export {
  SanctauryWebSocketServer,
  GatewayWebSocketServer,
  initializeWebSocketServer,
  getWebSocketServer,
  initializeGatewayWebSocketServer,
  getGatewayWebSocketServer,
  type AuthenticatedWebSocket,
  type WebSocketMessage,
} from './server';

// Typed broadcast helpers (preferred)
export {
  broadcast,
  broadcastTransaction,
  broadcastBalance,
  broadcastConfirmation,
  broadcastSync,
  broadcastLog,
  broadcastBlock,
  broadcastNewBlock,
  broadcastMempool,
  hasWalletSubscribers,
  getBroadcastStats,
  type EventData,
} from './broadcast';

// Event types
export {
  // Client messages
  type ClientMessage,
  type AuthMessage,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type PingMessage,
  type PongMessage,
  // Server events
  type ServerEvent,
  type BroadcastEvent,
  type ConnectedEvent,
  type AuthenticatedEvent,
  type SubscribedEvent,
  type UnsubscribedEvent,
  type ErrorEvent,
  type TransactionEvent,
  type BalanceEvent,
  type ConfirmationEvent,
  type BlockEvent,
  type NewBlockEvent,
  type MempoolEvent,
  type SyncEvent,
  type LogEvent,
  // Type guards
  isClientMessage,
  isWalletEvent,
  isGlobalEvent,
  // Event builders
  EventBuilders,
} from './events';

// Event versioning
export {
  EventVersionManager,
  eventVersionManager,
  type VersionedEvent,
  type EventTransformer,
  type EventVersion,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  createVersionedEvent,
  negotiateVersion,
} from './eventVersioning';

// Notification service
export { notificationService } from './notifications';

// Redis bridge for cross-instance WebSocket broadcasting
export {
  redisBridge,
  initializeRedisBridge,
  shutdownRedisBridge,
} from './redisBridge';
