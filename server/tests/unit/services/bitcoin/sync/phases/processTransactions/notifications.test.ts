import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueueTransactionNotification = vi.fn();
const mockNotifyNewTransactions = vi.fn().mockResolvedValue(undefined);
const mockBroadcast = vi.fn();

vi.mock('../../../../../../../src/infrastructure', () => ({
  queueTransactionNotification: (...args: any[]) => mockQueueTransactionNotification(...args),
}));

vi.mock('../../../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: (...args: any[]) => mockNotifyNewTransactions(...args),
}));

vi.mock('../../../../../../../src/websocket/notifications', () => ({
  getNotificationService: () => ({
    broadcastTransactionNotification: mockBroadcast,
  }),
}));

vi.mock('../../../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { sendNotifications } from '../../../../../../../src/services/bitcoin/sync/phases/processTransactions/notifications';

const makeTx = (overrides = {}) => ({
  txid: 'tx1',
  type: 'received',
  amount: BigInt(50000),
  confirmations: 1,
  blockHeight: 800000,
  blockTime: new Date('2024-01-01'),
  ...overrides,
});

describe('sendNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues notifications via dispatcher when available', async () => {
    mockQueueTransactionNotification.mockResolvedValue(true);

    await sendNotifications('w1', [makeTx(), makeTx({ txid: 'tx2' })]);

    expect(mockQueueTransactionNotification).toHaveBeenCalledTimes(2);
    expect(mockQueueTransactionNotification).toHaveBeenCalledWith({
      walletId: 'w1',
      txid: 'tx1',
      type: 'received',
      amount: '50000',
    });
    expect(mockNotifyNewTransactions).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledTimes(2);
  });

  it('falls back to inline when queue is unavailable', async () => {
    mockQueueTransactionNotification.mockResolvedValue(false);

    await sendNotifications('w1', [makeTx()]);

    expect(mockNotifyNewTransactions).toHaveBeenCalledWith(
      'w1',
      [expect.objectContaining({ txid: 'tx1' })],
    );
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
  });

  it('handles empty transactions gracefully', async () => {
    await sendNotifications('w1', []);

    expect(mockQueueTransactionNotification).not.toHaveBeenCalled();
    expect(mockNotifyNewTransactions).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('catches errors without throwing', async () => {
    mockQueueTransactionNotification.mockRejectedValue(new Error('kaboom'));

    await expect(sendNotifications('w1', [makeTx()])).resolves.not.toThrow();
  });

  it('always broadcasts WebSocket events regardless of queue path', async () => {
    mockQueueTransactionNotification.mockResolvedValue(true);

    const tx = makeTx();
    await sendNotifications('w1', [tx]);

    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      txid: 'tx1',
      walletId: 'w1',
      type: 'received',
      amount: 50000,
      confirmations: 1,
      blockHeight: 800000,
    }));
  });
});
