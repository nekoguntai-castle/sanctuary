/**
 * Telegram Notification Channel Handler
 *
 * Wraps the existing Telegram service as a notification channel.
 */

import * as telegramService from '../../telegram/telegramService';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';
import type {
  NotificationChannelHandler,
  TransactionNotification,
  DraftNotification,
  ConsolidationSuggestionNotification,
  NotificationResult,
} from './types';

const log = createLogger('NOTIFY:SVC_TELEGRAM');

export const telegramChannelHandler: NotificationChannelHandler = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Send notifications via Telegram bot',
  capabilities: {
    supportsTransactions: true,
    supportsDrafts: true,
    supportsConsolidationSuggestions: true,
    supportsAIInsights: false,
    supportsRichFormatting: true,
    supportsImages: false,
  },

  async isEnabled(): Promise<boolean> {
    // Telegram is always available - user config determines if notifications are sent
    return true;
  },

  async notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[]
  ): Promise<NotificationResult> {
    try {
      // Convert to telegramService format
      const txData = transactions.map((tx) => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
        agentId: tx.agentId,
        agentName: tx.agentName,
        agentOperationalSpend: tx.agentOperationalSpend,
        agentDestinationClassification: tx.agentDestinationClassification,
        agentUnknownDestinationHandlingMode: tx.agentUnknownDestinationHandlingMode,
      }));

      const summary = await telegramService.notifyNewTransactions(walletId, txData);

      return {
        success: summary.errors.length === 0,
        channelId: 'telegram',
        usersNotified: summary.usersNotified,
        errors: summary.errors.length > 0 ? summary.errors : undefined,
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: [getErrorMessage(err)],
      };
    }
  },

  async notifyDraft(
    walletId: string,
    draft: DraftNotification,
    createdByUserId: string | null,
    createdByLabel?: string
  ): Promise<NotificationResult> {
    try {
      await telegramService.notifyNewDraft(walletId, draft, createdByUserId, createdByLabel);

      return {
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: [getErrorMessage(err)],
      };
    }
  },

  async notifyConsolidationSuggestion(
    walletId: string,
    suggestion: ConsolidationSuggestionNotification
  ): Promise<NotificationResult> {
    try {
      const { getWalletUsers, escapeHtml } = telegramService;
      const { sendTelegramMessage } = telegramService;

      const users = await getWalletUsers(walletId);
      let notified = 0;
      const errors: string[] = [];

      for (const user of users) {
        const prefs = user.preferences as Record<string, unknown> | null;
        const telegram = prefs?.telegram as { enabled?: boolean; botToken?: string; chatId?: string } | undefined;

        if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) continue;

        const walletName = escapeHtml(suggestion.walletName);
        const message = [
          `<b>Consolidation Opportunity — ${walletName}</b>`,
          '',
          `Fees are low (<b>${suggestion.feeRate} sat/vB</b>) and you have <b>${suggestion.utxoHealth.totalUtxos}</b> UTXOs` +
            (suggestion.utxoHealth.dustCount > 0 ? ` (${suggestion.utxoHealth.dustCount} dust)` : '') + '.',
          '',
          `Consider consolidating to save on future fees.`,
          suggestion.estimatedSavings !== 'minimal savings' ? `Estimated savings: ${escapeHtml(suggestion.estimatedSavings)}` : '',
        ].filter(Boolean).join('\n');

        const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);
        if (result.success) {
          notified++;
        } else {
          const error = result.error ?? 'Unknown Telegram send failure';
          errors.push(error);
          log.warn(`Failed to send consolidation suggestion to ${user.username}`, { error });
        }
      }

      return {
        success: errors.length === 0,
        channelId: 'telegram',
        usersNotified: notified,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: [getErrorMessage(err)],
      };
    }
  },
};
