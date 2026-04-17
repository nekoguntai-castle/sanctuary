/**
 * AI Insights Notification Channel Handler
 *
 * Handles notifications for Treasury Intelligence AI insights.
 * Sends via Telegram with distinct formatting (separate from transaction notifications).
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { walletSharingRepository } from '../../../repositories';
import * as telegramApi from '../../telegram/api';
import type {
  NotificationChannelHandler,
  TransactionNotification,
  AIInsightNotification,
  NotificationResult,
} from './types';

const log = createLogger('NOTIFY:SVC_AI_INSIGHTS');

const SEVERITY_ICONS: Record<string, string> = {
  info: '\u2139\uFE0F',      // info icon
  warning: '\u26A0\uFE0F',   // warning icon
  critical: '\uD83D\uDED1',  // stop sign
};

const TYPE_LABELS: Record<string, string> = {
  utxo_health: 'UTXO Health',
  fee_timing: 'Fee Timing',
  anomaly: 'Anomaly Detection',
  tax: 'Tax Intelligence',
  consolidation: 'Consolidation Strategy',
};

export const aiInsightsChannelHandler: NotificationChannelHandler = {
  id: 'ai-insights',
  name: 'AI Insights',
  description: 'Proactive treasury intelligence notifications',
  capabilities: {
    supportsTransactions: false,
    supportsDrafts: false,
    supportsConsolidationSuggestions: false,
    supportsAIInsights: true,
    supportsRichFormatting: true,
    supportsImages: false,
  },

  async isEnabled(): Promise<boolean> {
    // AI insights channel is always enabled when registered;
    // per-user filtering happens in notifyAIInsight
    return true;
  },

  // Not used - this channel only handles AI insights
  async notifyTransactions(
    _walletId: string,
    _transactions: TransactionNotification[]
  ): Promise<NotificationResult> {
    return { success: true, channelId: 'ai-insights', usersNotified: 0 };
  },

  async notifyAIInsight(
    walletId: string,
    insight: AIInsightNotification
  ): Promise<NotificationResult> {
    let usersNotified = 0;

    try {
      // Get all users with access to this wallet
      const walletUsers = await walletSharingRepository.findWalletUsersWithPreferences(walletId);

      for (const wu of walletUsers) {
        const prefs = wu.user.preferences as Record<string, any> | null;
        const intelligence = prefs?.intelligence;
        const walletSettings = intelligence?.wallets?.[walletId];

        // Skip if intelligence not enabled for this wallet
        if (!walletSettings?.enabled) continue;

        // Check severity filter
        const severityOrder = ['info', 'warning', 'critical'];
        /* v8 ignore next -- missing severity filter intentionally defaults to info */
        const filterLevel = severityOrder.indexOf(walletSettings.severityFilter || 'info');
        const insightLevel = severityOrder.indexOf(insight.severity);
        if (insightLevel < filterLevel) continue;

        // Check type filter
        if (walletSettings.typeFilter && !walletSettings.typeFilter.includes(insight.type)) continue;

        // Send via Telegram if configured
        /* v8 ignore next -- legacy preferences default Telegram insight notifications on */
        if (walletSettings.notifyTelegram !== false) {
          const telegram = prefs?.telegram;
          if (telegram?.enabled && telegram?.botToken && telegram?.chatId) {
            try {
              const message = formatInsightMessage(insight);
              await telegramApi.sendTelegramMessage(telegram.botToken, telegram.chatId, message);
              usersNotified++;
            } catch (error) {
              log.error('Failed to send AI insight via Telegram', {
                userId: wu.user.id,
                error: getErrorMessage(error),
              });
            }
          }
        }
      }

      return {
        success: true,
        channelId: 'ai-insights',
        usersNotified,
      };
    } catch (error) {
      log.error('AI insight notification failed', {
        walletId,
        insightId: insight.id,
        error: getErrorMessage(error),
      });
      return {
        success: false,
        channelId: 'ai-insights',
        usersNotified,
        errors: [getErrorMessage(error)],
      };
    }
  },
};

/**
 * Format an AI insight as a Telegram message.
 * Uses distinct formatting from transaction notifications.
 */
function formatInsightMessage(insight: AIInsightNotification): string {
  /* v8 ignore start -- severity/type enums are constrained before formatting */
  const severityIcon = SEVERITY_ICONS[insight.severity] || '\u2139\uFE0F';
  const typeLabel = TYPE_LABELS[insight.type] || insight.type;
  /* v8 ignore stop */

  return [
    `\uD83E\uDDE0 <b>Treasury Intelligence</b> \u2014 ${insight.walletName}`,
    '',
    `<b>${insight.title}</b>`,
    '',
    insight.summary,
    '',
    `${severityIcon} Severity: ${insight.severity}`,
    `Type: ${typeLabel}`,
    '',
    '\u2014 Sanctuary AI',
  ].join('\n');
}
