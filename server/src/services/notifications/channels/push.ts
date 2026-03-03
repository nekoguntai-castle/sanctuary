/**
 * Push Notification Channel Handler
 *
 * Wraps the existing Push service as a notification channel.
 */

import * as pushService from '../../push/pushService';
import { getErrorMessage } from '../../../utils/errors';
import type {
  NotificationChannelHandler,
  TransactionNotification,
  NotificationResult,
} from './types';

export const pushChannelHandler: NotificationChannelHandler = {
  id: 'push',
  name: 'Push Notifications',
  description: 'Send notifications to mobile devices (iOS/Android)',
  capabilities: {
    supportsTransactions: true,
    supportsDrafts: false,
    supportsConsolidationSuggestions: false,
    supportsRichFormatting: false,
    supportsImages: false,
  },

  async isEnabled(): Promise<boolean> {
    // Check if any push provider is configured
    return pushService.isPushConfigured();
  },

  async notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[]
  ): Promise<NotificationResult> {
    try {
      // Convert to pushService format
      const txData = transactions.map((tx) => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
      }));

      await pushService.notifyNewTransactions(walletId, txData);

      return {
        success: true,
        channelId: 'push',
        usersNotified: 1, // Push service handles user lookup internally
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: [getErrorMessage(err)],
      };
    }
  },

  // Push doesn't support draft notifications
  // notifyDraft is not implemented
};
