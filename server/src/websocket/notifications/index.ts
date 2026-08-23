/**
 * Notification Module
 *
 * Real-time notification system for blockchain events.
 * Manages Electrum subscriptions and broadcasts updates via WebSocket.
 *
 * Structure:
 * - types.ts: Type definitions for all notification events
 * - broadcasts.ts: WebSocket broadcast methods per event type
 * - subscriptions.ts: Electrum address/wallet subscription handling
 * - notificationService.ts: Main service class (orchestrator)
 */

// Main service exports
export {
  NotificationService,
  notificationService,
  getNotificationService,
  walletLog,
} from './notificationService';

// Type exports
export type {
  TransactionNotification,
  BalanceUpdate,
  BlockNotification,
  NewBlockNotification,
  MempoolNotification,
  LogLevel,
  WalletLogEntry,
  SyncStatusUpdate,
  ConfirmationUpdate,
} from './types';
