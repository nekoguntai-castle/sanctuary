/**
 * Push Notification Channel Handler
 *
 * Wraps the existing Push service as a notification channel.
 */

import * as pushService from '../../push/pushService';
import { getErrorMessage } from '../../../utils/errors';
import { walletAutopilotSettingsFromPreferences } from '../../autopilot/settings';
import { eligibleInsightWalletSettings, INSIGHT_TYPE_LABELS } from './insightEligibility';
import type {
  AIInsightNotification,
  ConsolidationSuggestionNotification,
  NotificationChannelHandler,
  TransactionNotification,
  NotificationResult,
} from './types';

/**
 * Map a push service result to a channel result. The push service does not
 * report recipient/provider acceptance, so outcomes stay ambiguous.
 */
function toPushResult(result: pushService.NotifyTransactionsResult): NotificationResult {
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
    outcome: 'ambiguous',
    failureClass: 'unknown',
  };
}

/**
 * The push service catches and reports both its lookup phase and its per-user
 * send loop, so it is not expected to reject; this is a safety net for a
 * genuinely unexpected error (e.g. isConfigured()/ensureInitialized() throwing
 * first). It is intentionally not marked `recorded`, so it still reaches the
 * job-level dead letter queue.
 */
function toPushFailure(err: unknown): NotificationResult {
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

export const pushChannelHandler: NotificationChannelHandler = {
  id: 'push',
  name: 'Push Notifications',
  description: 'Send notifications to mobile devices (iOS/Android)',
  capabilities: {
    supportsTransactions: true,
    supportsDrafts: false,
    supportsConsolidationSuggestions: true,
    supportsAIInsights: true,
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

      return toPushResult(await pushService.notifyNewTransactions(walletId, txData));
    } catch (err) {
      return toPushFailure(err);
    }
  },

  // Decision D-4: wallet-level pushes are deliberately minimal -- a generic
  // title plus the wallet name and severity/type or fee rate. Never AI summary
  // text, amounts or UTXO counts.
  async notifyConsolidationSuggestion(
    walletId: string,
    suggestion: ConsolidationSuggestionNotification
  ): Promise<NotificationResult> {
    try {
      // Autopilot settings are per user, so each recipient must have it enabled
      // with push left on for this wallet, not just the user whose settings
      // triggered the suggestion.
      return toPushResult(
        await pushService.notifyWalletUsers(
          walletId,
          {
            title: 'Consolidation opportunity',
            body: `${suggestion.walletName}: fees are low (${suggestion.feeRate} sat/vB)`,
            data: { walletId, kind: 'consolidation_suggestion' },
          },
          (user) => {
            const settings = walletAutopilotSettingsFromPreferences(user.preferences, walletId);
            return settings?.enabled === true && settings.notifyPush !== false;
          }
        )
      );
    } catch (err) {
      return toPushFailure(err);
    }
  },

  async notifyAIInsight(
    walletId: string,
    insight: AIInsightNotification
  ): Promise<NotificationResult> {
    try {
      const typeLabel = INSIGHT_TYPE_LABELS[insight.type] || insight.type;
      return toPushResult(
        await pushService.notifyWalletUsers(
          walletId,
          {
            title: 'Treasury Intelligence',
            body: `${insight.walletName}: ${insight.severity} ${typeLabel} insight`,
            data: { walletId, insightId: insight.id, kind: 'ai_insight' },
          },
          (user) => {
            const settings = eligibleInsightWalletSettings(user.preferences, walletId, insight);
            return settings !== null && settings.notifyPush !== false;
          }
        )
      );
    } catch (err) {
      return toPushFailure(err);
    }
  },

  // Push doesn't support draft notifications
  // notifyDraft is not implemented
};
