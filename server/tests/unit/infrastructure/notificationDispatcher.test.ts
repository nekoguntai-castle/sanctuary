import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mockQueueAdd,
      close: mockQueueClose,
    };
  }),
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: vi.fn(() => ({
    options: { host: 'localhost', port: 6379 },
  })),
  isRedisConnected: vi.fn(() => true),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  queueConsolidationSuggestionNotification,
  queueTransactionNotification,
  shutdownNotificationDispatcher,
} from '../../../src/infrastructure/notificationDispatcher';
import { getRedisClient, isRedisConnected } from '../../../src/infrastructure/redis';

function createConsolidationSuggestionPayload() {
  return {
    walletId: 'w1',
    walletName: 'Treasury',
    feeRate: 5,
    utxoHealth: {
      totalUtxos: 20,
      dustCount: 3,
      dustValue: '15000',
      totalValue: '500000',
      avgUtxoSize: '25000',
      smallestUtxo: '500',
      largestUtxo: '100000',
      consolidationCandidates: 20,
    },
    estimatedSavings: '~20,400 sats',
    reason: 'Fees are low.',
    notifyTelegram: true,
    notifyPush: false,
    queuedAt: '2026-04-25T00:00:00.000Z',
  };
}

describe('notificationDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level queue by shutting down between tests
    return shutdownNotificationDispatcher();
  });

  it('queues a transaction notification and returns true', async () => {
    const result = await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx1',
      type: 'received',
      amount: '100000',
    });

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'transaction-notify',
      { walletId: 'w1', txid: 'tx1', type: 'received', amount: '100000' },
      { jobId: 'txnotify:w1:tx1' },
    );
  });

  it('queues a consolidation suggestion notification and returns true', async () => {
    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload()
    );

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'consolidation-suggestion-notify',
      expect.objectContaining({
        walletId: 'w1',
        walletName: 'Treasury',
        notifyTelegram: true,
        notifyPush: false,
      }),
      { jobId: 'consolidation-suggestion:w1:2026-04-25T00:00:00.000Z' },
    );
  });

  it('returns false for consolidation suggestions when Redis is not connected', async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload()
    );

    expect(result).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('returns false when Redis is not connected', async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx1',
      type: 'received',
      amount: '100000',
    });

    expect(result).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('returns false when Redis client is null', async () => {
    vi.mocked(getRedisClient).mockReturnValueOnce(null as any);

    const result = await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx1',
      type: 'received',
      amount: '100000',
    });

    expect(result).toBe(false);
  });

  it('returns false when consolidation suggestion queue add fails', async () => {
    await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx-ok',
      type: 'received',
      amount: '100',
    });
    mockQueueAdd.mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload()
    );

    expect(result).toBe(false);
  });

  it('returns false and logs warning when queue add fails', async () => {
    // First call succeeds to create the queue
    await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx-ok',
      type: 'received',
      amount: '100',
    });

    // Now make add fail
    mockQueueAdd.mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx-fail',
      type: 'received',
      amount: '200',
    });

    expect(result).toBe(false);
  });

  it('shutdownNotificationDispatcher closes the queue', async () => {
    // Create the queue by queueing something
    await queueTransactionNotification({
      walletId: 'w1',
      txid: 'tx1',
      type: 'received',
      amount: '100',
    });

    await shutdownNotificationDispatcher();
    expect(mockQueueClose).toHaveBeenCalled();

    // Calling again is a no-op
    mockQueueClose.mockClear();
    await shutdownNotificationDispatcher();
    expect(mockQueueClose).not.toHaveBeenCalled();
  });
});
