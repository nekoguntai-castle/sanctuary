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

import {
  filterNotifiableTransactions,
  selectAnnounceableTransactions,
  sendNotifications,
} from '../../../../../../../src/services/bitcoin/sync/phases/processTransactions/notifications';
import { createTestContext } from '../../../../../../../src/services/bitcoin/sync/context';
import type { RawTransaction, TransactionCreateData } from '../../../../../../../src/services/bitcoin/sync/types';

const makeTx = (overrides: Partial<TransactionCreateData> = {}): TransactionCreateData => ({
  txid: 'tx1',
  walletId: 'w1',
  addressId: 'address-1',
  type: 'received',
  classificationInputsComplete: true,
  classificationVersion: 2,
  classificationAddressCount: 1,
  amount: BigInt(50000),
  confirmations: 1,
  blockHeight: 800000,
  blockTime: new Date('2024-01-01'),
  rbfStatus: 'confirmed',
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
      feeSats: null,
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


describe('filterNotifiableTransactions', () => {
  const confirmed = { txid: 'a', confirmations: 3 } as any;
  const pending = { txid: 'b', confirmations: 0 } as any;
  const unknown = { txid: 'c' } as any;

  it('keeps every transaction on incremental syncs', () => {
    expect(filterNotifiableTransactions([confirmed, pending], false)).toEqual([confirmed, pending]);
  });

  it('keeps only unconfirmed transactions on baseline syncs', () => {
    expect(filterNotifiableTransactions([confirmed, pending, unknown], true)).toEqual([pending, unknown]);
  });

  it('returns an empty list for empty input', () => {
    expect(filterNotifiableTransactions([], true)).toEqual([]);
  });
});

describe('selectAnnounceableTransactions', () => {
  const incompleteReceive = makeTx({ txid: 'held', classificationInputsComplete: false });
  const contextWithDetails = (vin: unknown) => createTestContext({
    txDetailsCache: new Map([['held', { txid: 'held', vin } as unknown as RawTransaction]]),
  });

  it('holds an incomplete receive whose transaction details are missing', () => {
    expect(selectAnnounceableTransactions(createTestContext({}), [incompleteReceive], [])).toEqual([]);
  });

  it('announces an incomplete receive whose details carry no inputs', () => {
    expect(selectAnnounceableTransactions(contextWithDetails(undefined), [incompleteReceive], []))
      .toEqual([incompleteReceive]);
  });

  it('skips coinbase inputs when looking for repairable incomplete inputs', () => {
    expect(selectAnnounceableTransactions(contextWithDetails([{ coinbase: 'ff' }]), [incompleteReceive], []))
      .toEqual([incompleteReceive]);
  });

  it('holds an incomplete receive whose input has an address but no value yet', () => {
    const vin = [{ txid: 'parent', vout: 0, prevout: { scriptPubKey: { address: 'bc1q_payer' } } }];
    expect(selectAnnounceableTransactions(contextWithDetails(vin), [incompleteReceive], [])).toEqual([]);
  });

  it('holds an incomplete receive whose standard input script has not been decoded yet', () => {
    const vin = [{ txid: 'parent', vout: 0, prevout: { value: 0.001, scriptPubKey: { hex: `0014${'a'.repeat(40)}` } } }];
    expect(selectAnnounceableTransactions(contextWithDetails(vin), [incompleteReceive], [])).toEqual([]);
  });

  it('announces an incomplete receive whose only gap is a non-standard input', () => {
    const vin = [{ txid: 'parent', vout: 0, prevout: { value: 0.001, scriptPubKey: { hex: '51' } } }];
    expect(selectAnnounceableTransactions(contextWithDetails(vin), [incompleteReceive], []))
      .toEqual([incompleteReceive]);
  });
});
