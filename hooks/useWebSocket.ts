/**
 * WebSocket Hooks
 *
 * Re-export shim — all hooks have been split into focused modules under ./websocket/
 */

export {
  useWebSocket,
  useWebSocketEvent,
  useWalletEvents,
  useWalletLogs,
  useModelDownloadProgress,
  useWebSocketQueryInvalidation,
} from './websocket';

export type {
  UseWebSocketReturn,
  WalletLogEntry,
  LogLevel,
  ModelDownloadProgress,
} from './websocket';
