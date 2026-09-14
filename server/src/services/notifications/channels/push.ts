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
    supportsAIInsights: false,
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

      const result = await pushService.notifyNewTransactions(walletId, txData);

      if (!result.success) {
        return {
          success: false,
          channelId: 'push',
          usersNotified: result.usersNotified,
          errors: result.error ? [result.error] : undefined,
          outcome: 'ambiguous',
          failureClass: 'internal',
          recorded: result.recorded ?? false,
        };
      }

      return {
        success: true,
        channelId: 'push',
        usersNotified: result.usersNotified,
        // The legacy push service does not return recipient/provider acceptance.
        outcome: 'ambiguous',
        failureClass: 'unknown',
      };
    } catch (err) {
      // pushService.notifyNewTransactions itself catches and reports both
      // the lookup phase and the per-user send loop, so it is not expected
      // to reject; this is a safety net for a genuinely unexpected error
      // (e.g. isConfigured()/ensureInitialized() throwing before either of
      // those phases runs). It is intentionally not marked `recorded`, so
      // it still reaches the job-level dead letter queue.
      return {
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: [getErrorMessage(err)],
        outcome: 'ambiguous',
        failureClass: 'internal',
        recorded: false,
      };
    }
  },

  // Push doesn't support draft notifications
  // notifyDraft is not implemented
};
