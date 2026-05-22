/**
 * Webhook Notification Channel Handler
 *
 * Adapts generic notification events into durable wallet webhook deliveries.
 */

import { getErrorMessage } from '../../../utils/errors';
import { buildTransactionWebhookEventsForBatch } from '../../webhooks/eventBuilder';
import { queueWebhookEventsDeliveries } from '../../webhooks/deliveryService';
import type {
  NotificationChannelHandler,
  NotificationResult,
  TransactionNotification,
} from './types';

export const webhookChannelHandler: NotificationChannelHandler = {
  id: 'webhook',
  name: 'Webhook',
  description: 'Send wallet events to configured webhook endpoints',
  capabilities: {
    supportsTransactions: true,
    supportsDrafts: false,
    supportsConsolidationSuggestions: false,
    supportsAIInsights: false,
    supportsRichFormatting: false,
    supportsImages: false,
  },

  async isEnabled(): Promise<boolean> {
    return true;
  },

  async notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[],
  ): Promise<NotificationResult> {
    const errors: string[] = [];
    let usersNotified = 0;

    try {
      const events = await buildTransactionWebhookEventsForBatch(walletId, transactions);
      const result = await queueWebhookEventsDeliveries(events);
      usersNotified += result.queued;
      errors.push(...result.errors);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }

    return {
      success: errors.length === 0,
      channelId: 'webhook',
      usersNotified,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
};
