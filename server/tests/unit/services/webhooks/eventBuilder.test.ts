import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionNotification } from '../../../../src/services/notifications/channels';
import {
  buildTransactionWebhookEvents,
  buildTransactionWebhookEventsForBatch,
} from '../../../../src/services/webhooks/eventBuilder';
import {
  WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
  WEBHOOK_EVENT_TRANSACTION_OBSERVED,
  WEBHOOK_EVENT_TRANSACTION_RECEIVED,
  WEBHOOK_EVENT_TRANSACTION_SENT,
} from '../../../../src/services/webhooks/types';

const { mockFindManyByTxids, mockFindWalletById } = vi.hoisted(() => ({
  mockFindManyByTxids: vi.fn(),
  mockFindWalletById: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  transactionRepository: {
    findManyByTxids: mockFindManyByTxids,
  },
  walletRepository: {
    findById: mockFindWalletById,
  },
}));

describe('webhook event builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindWalletById.mockResolvedValue({
      id: 'wallet-1',
      name: 'Treasury',
      network: 'mainnet',
    });
  });

  it('builds transaction events with one wallet lookup and one batch transaction lookup', async () => {
    mockFindManyByTxids.mockResolvedValue([
      makeStoredTransaction({ txid: 'tx-1', confirmations: 3, type: 'received' }),
      makeStoredTransaction({ txid: 'tx-2', confirmations: 0, type: 'sent' }),
    ]);

    const events = await buildTransactionWebhookEventsForBatch('wallet-1', [
      makeNotification({ txid: 'tx-1', type: 'received' }),
      makeNotification({ txid: 'tx-2', type: 'sent' }),
    ]);

    expect(mockFindWalletById).toHaveBeenCalledOnce();
    expect(mockFindWalletById).toHaveBeenCalledWith('wallet-1');
    expect(mockFindManyByTxids).toHaveBeenCalledOnce();
    expect(mockFindManyByTxids).toHaveBeenCalledWith(['tx-1', 'tx-2'], 'wallet-1');
    expect(events.map(event => event.eventType)).toEqual([
      WEBHOOK_EVENT_TRANSACTION_OBSERVED,
      WEBHOOK_EVENT_TRANSACTION_RECEIVED,
      WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
      WEBHOOK_EVENT_TRANSACTION_OBSERVED,
      WEBHOOK_EVENT_TRANSACTION_SENT,
    ]);
  });

  it('returns no events when the wallet cannot be found', async () => {
    mockFindWalletById.mockResolvedValueOnce(null);

    const events = await buildTransactionWebhookEventsForBatch('wallet-missing', [
      makeNotification({ txid: 'tx-1', type: 'received' }),
    ]);

    expect(events).toEqual([]);
    expect(mockFindManyByTxids).not.toHaveBeenCalled();
  });

  it('returns no events for an empty batch without hitting repositories', async () => {
    const events = await buildTransactionWebhookEventsForBatch('wallet-1', []);

    expect(events).toEqual([]);
    expect(mockFindWalletById).not.toHaveBeenCalled();
    expect(mockFindManyByTxids).not.toHaveBeenCalled();
  });

  it('builds a single observed event when direction and confirmation do not apply', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T12:00:00.000Z'));
    mockFindManyByTxids.mockResolvedValue([]);

    try {
      const events = await buildTransactionWebhookEvents('wallet-1', makeNotification({
        feeSats: undefined,
        type: 'unknown' as any,
      }));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: WEBHOOK_EVENT_TRANSACTION_OBSERVED,
        occurredAt: '2026-05-22T12:00:00.000Z',
        transaction: {
          confirmations: 0,
          feeSats: null,
          blockHeight: null,
          blockTime: null,
          memo: null,
          label: null,
          counterpartyAddress: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back from missing block time to stored creation time and stored fee', async () => {
    mockFindManyByTxids.mockResolvedValue([
      makeStoredTransaction({
        blockTime: null,
        confirmations: 1,
        fee: 12n,
      }),
    ]);

    const events = await buildTransactionWebhookEventsForBatch('wallet-1', [
      makeNotification({ feeSats: null, txid: 'tx-1', type: 'sent' }),
    ]);

    expect(events.map(event => event.eventType)).toEqual([
      WEBHOOK_EVENT_TRANSACTION_OBSERVED,
      WEBHOOK_EVENT_TRANSACTION_SENT,
      WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
    ]);
    expect(events[0]).toMatchObject({
      occurredAt: '2026-05-22T09:59:00.000Z',
      transaction: {
        feeSats: '12',
        blockTime: null,
      },
    });
  });
});

function makeNotification(overrides: Partial<TransactionNotification> = {}): TransactionNotification {
  return {
    txid: 'tx-1',
    type: 'received',
    amount: 123n,
    feeSats: 7n,
    ...overrides,
  };
}

function makeStoredTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stored-tx-1',
    txid: 'tx-1',
    walletId: 'wallet-1',
    type: 'received',
    amount: 123n,
    fee: 7n,
    confirmations: 0,
    blockHeight: 900001,
    blockTime: new Date('2026-05-22T10:00:00.000Z'),
    memo: null,
    label: null,
    counterpartyAddress: null,
    createdAt: new Date('2026-05-22T09:59:00.000Z'),
    updatedAt: new Date('2026-05-22T10:00:00.000Z'),
    ...overrides,
  };
}
