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
  queueTransactionNotification,
  shutdownNotificationDispatcher,
} from '../../../src/infrastructure/notificationDispatcher';
import { getRedisClient, isRedisConnected } from '../../../src/infrastructure/redis';

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
