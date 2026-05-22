import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionNotification } from '../../../../../src/services/notifications/channels';

const {
  mockBuildTransactionWebhookEventsForBatch,
  mockQueueWebhookEventsDeliveries,
} = vi.hoisted(() => ({
  mockBuildTransactionWebhookEventsForBatch: vi.fn(),
  mockQueueWebhookEventsDeliveries: vi.fn(),
}));

vi.mock('../../../../../src/services/webhooks/eventBuilder', () => ({
  buildTransactionWebhookEventsForBatch: mockBuildTransactionWebhookEventsForBatch,
}));

vi.mock('../../../../../src/services/webhooks/deliveryService', () => ({
  queueWebhookEventsDeliveries: mockQueueWebhookEventsDeliveries,
}));

import { webhookChannelHandler } from '../../../../../src/services/notifications/channels/webhook';

describe('webhook notification channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildTransactionWebhookEventsForBatch.mockResolvedValue([{ eventId: 'event-1' }]);
    mockQueueWebhookEventsDeliveries.mockResolvedValue({ queued: 1, errors: [] });
  });

  it('is always enabled and queues wallet webhook transaction events', async () => {
    await expect(webhookChannelHandler.isEnabled()).resolves.toBe(true);

    await expect(webhookChannelHandler.notifyTransactions('wallet-1', [makeTransaction()]))
      .resolves.toEqual({
        success: true,
        channelId: 'webhook',
        usersNotified: 1,
        errors: undefined,
      });

    expect(mockBuildTransactionWebhookEventsForBatch).toHaveBeenCalledWith('wallet-1', [makeTransaction()]);
    expect(mockQueueWebhookEventsDeliveries).toHaveBeenCalledWith([{ eventId: 'event-1' }]);
  });

  it('returns channel errors from delivery queuing', async () => {
    mockQueueWebhookEventsDeliveries.mockResolvedValueOnce({
      queued: 0,
      errors: ['Webhook endpoint returned HTTP 503'],
    });

    await expect(webhookChannelHandler.notifyTransactions('wallet-1', [makeTransaction()]))
      .resolves.toEqual({
        success: false,
        channelId: 'webhook',
        usersNotified: 0,
        errors: ['Webhook endpoint returned HTTP 503'],
      });
  });

  it('converts thrown errors into notification errors', async () => {
    mockBuildTransactionWebhookEventsForBatch.mockRejectedValueOnce(new Error('wallet unavailable'));

    await expect(webhookChannelHandler.notifyTransactions('wallet-1', [makeTransaction()]))
      .resolves.toEqual({
        success: false,
        channelId: 'webhook',
        usersNotified: 0,
        errors: ['wallet unavailable'],
      });
  });
});

function makeTransaction(): TransactionNotification {
  return {
    txid: 'tx-1',
    type: 'received',
    amount: 1n,
    feeSats: null,
  };
}
