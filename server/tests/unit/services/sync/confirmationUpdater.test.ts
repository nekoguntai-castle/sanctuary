import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockFindMany,
  mockUpdateTransactionConfirmations,
  mockPopulateMissingTransactionFields,
  mockBroadcastConfirmationUpdate,
  mockEmitTransactionConfirmed,
  mockLogger,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn<(args: unknown) => Promise<Array<{ walletId: string }>>>(),
  mockUpdateTransactionConfirmations: vi.fn<(walletId: string) => Promise<Array<{ txid: string; oldConfirmations: number; newConfirmations: number }>>>(),
  mockPopulateMissingTransactionFields: vi.fn<(walletId: string) => Promise<{ updated: number; confirmationUpdates: Array<{ txid: string; oldConfirmations: number; newConfirmations: number }> }>>(),
  mockBroadcastConfirmationUpdate: vi.fn<(walletId: string, update: unknown) => void>(),
  mockEmitTransactionConfirmed: vi.fn<(payload: unknown) => void>(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {
    transaction: {
      findMany: mockFindMany,
    },
  },
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  getNotificationService: () => ({
    broadcastConfirmationUpdate: mockBroadcastConfirmationUpdate,
  }),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionConfirmed: mockEmitTransactionConfirmed,
  },
}));

import { updateAllConfirmations } from '../../../../src/services/sync/confirmationUpdater';

describe('confirmationUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when isRunning is false', async () => {
    await updateAllConfirmations(false);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('queries wallets with pending transactions', async () => {
    mockFindMany.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { confirmations: { lt: 6 } },
      select: { walletId: true },
      distinct: ['walletId'],
    });
  });

  it('processes each wallet with pending transactions', async () => {
    mockFindMany.mockResolvedValue([
      { walletId: 'w1' },
      { walletId: 'w2' },
    ]);
    mockPopulateMissingTransactionFields.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledWith('w1');
    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledWith('w2');
    expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith('w1');
    expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith('w2');
  });

  it('broadcasts confirmation updates to frontend', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'w1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 0,
      confirmationUpdates: [],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([
      { txid: 'tx1', oldConfirmations: 0, newConfirmations: 1 },
    ]);

    await updateAllConfirmations(true);

    expect(mockEmitTransactionConfirmed).toHaveBeenCalledWith({
      walletId: 'w1',
      txid: 'tx1',
      confirmations: 1,
      blockHeight: 0,
      previousConfirmations: 0,
    });

    expect(mockBroadcastConfirmationUpdate).toHaveBeenCalledWith('w1', {
      txid: 'tx1',
      confirmations: 1,
      previousConfirmations: 0,
    });
  });

  it('broadcasts populate-sourced confirmation updates', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'w1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 1,
      confirmationUpdates: [
        { txid: 'tx2', oldConfirmations: 0, newConfirmations: 3 },
      ],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockEmitTransactionConfirmed).toHaveBeenCalledWith({
      walletId: 'w1',
      txid: 'tx2',
      confirmations: 3,
      blockHeight: 0,
      previousConfirmations: 0,
    });
  });

  it('does not broadcast when no updates occurred', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'w1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockBroadcastConfirmationUpdate).not.toHaveBeenCalled();
    expect(mockEmitTransactionConfirmed).not.toHaveBeenCalled();
  });

  it('logs total updated count when updates exist', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'w1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 2,
      confirmationUpdates: [
        { txid: 'tx1', oldConfirmations: 0, newConfirmations: 1 },
      ],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([
      { txid: 'tx2', oldConfirmations: 1, newConfirmations: 2 },
    ]);

    await updateAllConfirmations(true);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Updated 3 transaction confirmations'),
    );
  });

  it('handles per-wallet errors without aborting other wallets', async () => {
    mockFindMany.mockResolvedValue([
      { walletId: 'w1' },
      { walletId: 'w2' },
    ]);
    mockPopulateMissingTransactionFields
      .mockRejectedValueOnce(new Error('w1 fail'))
      .mockResolvedValueOnce({ updated: 0, confirmationUpdates: [] });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update confirmations for wallet w1'),
      expect.any(Object),
    );
    // w2 should still be processed
    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledWith('w2');
  });

  it('handles top-level errors gracefully', async () => {
    mockFindMany.mockRejectedValue(new Error('DB down'));

    await updateAllConfirmations(true);

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[SYNC] Failed to update confirmations',
      expect.any(Object),
    );
  });

  it('logs populate count when fields are populated', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'w1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({ updated: 5, confirmationUpdates: [] });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);

    await updateAllConfirmations(true);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Populated missing fields for 5 transactions'),
    );
  });
});
