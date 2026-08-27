/**
 * Notification Service
 *
 * Manages real-time notifications for blockchain events.
 * Integrates with Electrum for transaction/block updates
 * and broadcasts events via WebSocket.
 *
 * Delegates to focused modules:
 * - broadcasts.ts: WebSocket broadcast methods per event type
 * - subscriptions.ts: Electrum address/wallet subscription handling
 */

import { createLogger } from '../../utils/logger';
import {
  broadcastTransactionNotification,
  broadcastBalanceUpdate,
  broadcastBlockNotification,
  broadcastNewBlock,
  broadcastMempoolNotification,
  broadcastConfirmationUpdate,
  broadcastSyncStatus,
  broadcastWalletLog,
} from './broadcasts';
import type {
  TransactionNotification,
  BalanceUpdate,
  BlockNotification,
  NewBlockNotification,
  MempoolNotification,
  WalletLogEntry,
  SyncStatusUpdate,
  ConfirmationUpdate,
  LogLevel,
} from './types';

const log = createLogger('WS:NOTIFY_SVC');

export class NotificationService {
  private isRunning: boolean = false;

  /**
   * Start the notification service
   */
  async start() {
    if (this.isRunning) {
      log.debug('Notification service already running');
      return;
    }

    this.isRunning = true;
    log.debug('Starting notification service...');

    log.debug('Notification service started');
  }

  /**
   * Stop the notification service
   */
  stop() {
    this.isRunning = false;
    log.debug('Notification service stopped');
  }

  /**
   * Broadcast transaction notification
   */
  public broadcastTransactionNotification(notification: TransactionNotification) {
    broadcastTransactionNotification(notification);
  }

  /**
   * Broadcast balance update
   */
  public broadcastBalanceUpdate(update: BalanceUpdate) {
    broadcastBalanceUpdate(update);
  }

  /**
   * Broadcast new block notification (full details)
   */
  public broadcastBlockNotification(notification: BlockNotification) {
    broadcastBlockNotification(notification);
  }

  /**
   * Broadcast new block notification (minimal - just height)
   * Used by real-time Electrum subscription
   */
  public broadcastNewBlock(block: NewBlockNotification) {
    broadcastNewBlock(block);
  }

  /**
   * Broadcast mempool notification
   */
  public broadcastMempoolNotification(notification: MempoolNotification) {
    broadcastMempoolNotification(notification);
  }

  /**
   * Broadcast confirmation update for a transaction
   * Includes previousConfirmations so frontend can detect milestone transitions (e.g., 0->1)
   */
  public broadcastConfirmationUpdate(walletId: string, update: ConfirmationUpdate) {
    broadcastConfirmationUpdate(walletId, update);
  }

  /**
   * Broadcast sync status update for a wallet
   */
  public broadcastSyncStatus(walletId: string, status: SyncStatusUpdate) {
    broadcastSyncStatus(walletId, status);
  }

  /**
   * Broadcast wallet log entry for real-time sync logging
   * Also stores the entry in the log buffer for later retrieval
   */
  public broadcastWalletLog(
    walletId: string,
    entry: Omit<WalletLogEntry, 'id' | 'sequence' | 'timestamp'>,
  ) {
    broadcastWalletLog(walletId, entry);
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export getter function for use in other services
export const getNotificationService = (): NotificationService => notificationService;

/**
 * Helper function to send a log entry to the frontend via WebSocket for a specific wallet
 * Convenience wrapper around notificationService.broadcastWalletLog
 */
export function walletLog(
  walletId: string,
  level: LogLevel,
  module: string,
  message: string,
  details?: Record<string, unknown>
): void {
  notificationService.broadcastWalletLog(walletId, {
    level,
    module,
    message,
    details,
  });
}
