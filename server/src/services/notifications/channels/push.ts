/**
 * Push Notification Channel Handler
 *
 * Wraps the existing Push service as a notification channel.
 *
 * Delivery paths:
 * - Transactions: direct send only when this process holds APNs/FCM
 *   credentials (`isTransactionDeliveryEnabled`). Without them, transaction
 *   pushes already reach the gateway through the broadcast path, so they are
 *   never sent twice.
 * - AI insights and consolidation suggestions: the audience is resolved here,
 *   then either handed to the push gateway (when gateway delivery is
 *   available) or sent directly -- never both. The worker, which runs these
 *   jobs, has no credentials and always uses the gateway.
 */

import * as pushService from '../../push/pushService';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { isAutopilotChannelEnabled } from '../../autopilot/settings';
import { eligibleInsightWalletSettings, INSIGHT_TYPE_LABELS } from './insightEligibility';
import {
  dispatchGatewayPushEvent,
  isGatewayPushDeliveryAvailable,
} from '../../../websocket/gatewayPush';
import type { GatewayPushEvent } from '../../../websocket/types';
import type { PushMessage } from '../../push/types';
import {
  noRecipientsResult,
  type AIInsightNotification,
  type ConsolidationSuggestionNotification,
  type NotificationChannelHandler,
  type TransactionNotification,
  type NotificationResult,
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

const log = createLogger('NOTIFY:SVC_PUSH');

type UserEligibility = (user: pushService.WalletNotificationUser) => boolean;

/**
 * Map a gateway dispatch to a channel result. Delivered counts the users the
 * event was handed to a gateway path for (dispatch, not provider acceptance,
 * as for direct sends). Not delivered means no gateway path took it.
 */
async function dispatchToGateway(event: GatewayPushEvent): Promise<NotificationResult> {
  const { delivered, error } = await dispatchGatewayPushEvent(event);
  if (error !== undefined) {
    return toPushResult({ success: false, usersNotified: 0, error, recorded: false });
  }
  if (!delivered) return noRecipientsResult('push');
  return toPushResult({ success: true, usersNotified: event.userIds.length });
}

/**
 * Send a wallet-level push through the gateway when gateway delivery is
 * available, otherwise directly with this process's credentials.
 */
async function notifyWalletAudience(
  walletId: string,
  directMessage: PushMessage,
  buildGatewayEvent: (userIds: string[]) => GatewayPushEvent,
  isUserEligible: UserEligibility,
): Promise<NotificationResult> {
  if (!isGatewayPushDeliveryAvailable()) {
    return toPushResult(await pushService.notifyWalletUsers(walletId, directMessage, isUserEligible));
  }

  let userIds: string[];
  try {
    userIds = await pushService.resolveWalletPushAudience(walletId, isUserEligible);
  } catch (err) {
    const error = getErrorMessage(err);
    log.error('Error resolving wallet push audience', { walletId, error });
    return toPushResult({ success: false, usersNotified: 0, error, recorded: false });
  }
  if (userIds.length === 0) return noRecipientsResult('push');
  return dispatchToGateway(buildGatewayEvent(userIds));
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
    // Enabled with local provider credentials, or when wallet-level pushes can
    // be handed to the gateway (the worker has no credentials of its own).
    return pushService.isPushConfigured() || isGatewayPushDeliveryAvailable();
  },

  async isTransactionDeliveryEnabled(): Promise<boolean> {
    // Transactions are sent directly only with local credentials; otherwise
    // they reach the gateway through the broadcast path.
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
      return await notifyWalletAudience(
        walletId,
        {
          title: 'Consolidation opportunity',
          body: `${suggestion.walletName}: fees are low (${suggestion.feeRate} sat/vB)`,
          data: { walletId, kind: 'consolidation_suggestion' },
        },
        (userIds) => ({
          type: 'consolidation_suggestion',
          walletId,
          walletName: suggestion.walletName,
          userIds,
          data: { feeRate: suggestion.feeRate },
        }),
        (user) => isAutopilotChannelEnabled(user.preferences, walletId, 'notifyPush')
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
      return await notifyWalletAudience(
        walletId,
        {
          title: 'Treasury Intelligence',
          body: `${insight.walletName}: ${insight.severity} ${typeLabel} insight`,
          data: { walletId, insightId: insight.id, kind: 'ai_insight' },
        },
        (userIds) => ({
          type: 'ai_insight',
          walletId,
          walletName: insight.walletName,
          userIds,
          data: {
            insightId: insight.id,
            insightType: insight.type,
            insightTypeLabel: typeLabel,
            severity: insight.severity,
          },
        }),
        (user) => {
          const settings = eligibleInsightWalletSettings(user.preferences, walletId, insight);
          return settings !== null && settings.notifyPush !== false;
        }
      );
    } catch (err) {
      return toPushFailure(err);
    }
  },

  // Push doesn't support draft notifications
  // notifyDraft is not implemented
};
