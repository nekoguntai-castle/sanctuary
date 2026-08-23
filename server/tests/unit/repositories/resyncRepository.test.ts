import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

import {
  completeFencedWalletFullResync,
  completeWalletFullResync,
  isExactFullResyncPending,
  isFullResyncGenerationProcessed,
  requestFullResyncGeneration,
  reserveFullResyncGeneration,
  resetWalletForFullResync,
} from '../../../src/repositories/resyncRepository';
import { FULL_RESYNC_GENERATION_MAX } from '../../../src/constants/fullResync';

describe('resyncRepository', () => {
  const fence = {
    walletId: 'wallet-1',
    generation: 6,
    leaseToken: '10000000-0000-4000-8000-000000000001',
  } as const;
  beforeEach(() => {
    resetPrismaMocks();
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 0,
      processedFullResyncGeneration: 0,
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncInProgress: false,
    }]);
    mockPrismaClient.transaction.deleteMany.mockResolvedValue({ count: 4 });
  });

  it('atomically reserves the next durable generation', async () => {
    mockPrismaClient.wallet.update.mockResolvedValue({
      requestedFullResyncGeneration: 4,
    });

    await expect(reserveFullResyncGeneration('wallet-1')).resolves.toBe(4);
    expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { requestedFullResyncGeneration: { increment: 1 } },
      select: { requestedFullResyncGeneration: true },
    });
  });

  it('atomically requests a new full-resync generation and merges outstanding work', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{
        id: 'wallet-1',
        requestedFullResyncGeneration: 4,
        requestedIncrementalSyncGeneration: 6,
        previousRequestedGeneration: 3,
        syncStateVersion: 8,
      }])
      .mockResolvedValueOnce([{
        id: 'wallet-1',
        requestedFullResyncGeneration: 4,
        requestedIncrementalSyncGeneration: 6,
        previousRequestedGeneration: 4,
        syncStateVersion: 9,
      }]);

    await expect(requestFullResyncGeneration('wallet-1')).resolves.toEqual({
      status: 'requested',
      generation: 4,
      incrementalGeneration: 6,
      state: expect.objectContaining({ id: 'wallet-1', syncStateVersion: 8 }),
    });
    await expect(requestFullResyncGeneration('wallet-1')).resolves.toEqual({
      status: 'merged',
      generation: 4,
      incrementalGeneration: 6,
      state: expect.objectContaining({ id: 'wallet-1', syncStateVersion: 9 }),
    });

    const sql = mockPrismaClient.$queryRaw.mock.calls[0]?.[0];
    expect(sql.strings.join(' ')).toContain('FOR UPDATE');
    expect(sql.strings.join(' ')).toContain('"requestedFullResyncGeneration" + 1');
    expect(sql.strings.join(' ')).toContain('"processedFullResyncGeneration"');
    expect(sql.strings.join(' ')).toContain('"claimedIncrementalSyncGeneration"');
    expect(sql.strings.join(' ')).toContain('"syncActionRequiredAt" = NULL');
    expect(sql.strings.join(' ')).toContain('"syncNextRetryAt" = NULL');
    expect(sql.strings.join(' ')).toContain('"syncRetryCount" = 0');
    expect(sql.strings.join(' ')).toContain(
      '"syncStateVersion" = wallet."syncStateVersion" + CASE',
    );
  });

  it('accepts terminal full-resync reopen by clearing claim blockers', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{
      id: 'wallet-1',
      requestedFullResyncGeneration: 4,
      requestedIncrementalSyncGeneration: 6,
      previousRequestedGeneration: 4,
      syncStateVersion: 10,
    }]);

    await expect(requestFullResyncGeneration('wallet-1')).resolves.toMatchObject({
      status: 'merged', generation: 4, incrementalGeneration: 6,
    });
    const sql = mockPrismaClient.$queryRaw.mock.calls[0]?.[0].strings.join(' ');
    expect(sql).toContain('"syncActionRequiredAt" = NULL');
    expect(sql).toContain('"syncNextRetryAt" = NULL');
  });

  it('uses durable state as completed full-resync proof', async () => {
    mockPrismaClient.wallet.findUnique
      .mockResolvedValueOnce({ processedFullResyncGeneration: 7 })
      .mockResolvedValueOnce({ processedFullResyncGeneration: 6 })
      .mockResolvedValueOnce(null);

    await expect(isFullResyncGenerationProcessed('wallet-1', 7)).resolves.toBe(true);
    await expect(isFullResyncGenerationProcessed('wallet-1', 7)).resolves.toBe(false);
    await expect(isFullResyncGenerationProcessed('missing', 7)).resolves.toBe(false);
    await expect(isFullResyncGenerationProcessed('wallet-1', 0)).resolves.toBe(false);
  });

  it('revalidates the exact paired pending full-resync generations', async () => {
    mockPrismaClient.wallet.findUnique
      .mockResolvedValueOnce({
        requestedFullResyncGeneration: 7,
        processedFullResyncGeneration: 6,
        requestedIncrementalSyncGeneration: 9,
        syncActionRequiredAt: null,
      })
      .mockResolvedValueOnce({
        requestedFullResyncGeneration: 7,
        processedFullResyncGeneration: 7,
        requestedIncrementalSyncGeneration: 9,
        syncActionRequiredAt: null,
      })
      .mockResolvedValueOnce({
        requestedFullResyncGeneration: 7,
        processedFullResyncGeneration: 6,
        requestedIncrementalSyncGeneration: 9,
        syncActionRequiredAt: new Date(),
      });

    await expect(isExactFullResyncPending('wallet-1', 7, 9)).resolves.toBe(true);
    await expect(isExactFullResyncPending('wallet-1', 7, 9)).resolves.toBe(false);
    await expect(isExactFullResyncPending('wallet-1', 7, 9)).resolves.toBe(false);
    await expect(isExactFullResyncPending('wallet-1', 0, 9)).resolves.toBe(false);
    expect(mockPrismaClient.wallet.findUnique).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      select: expect.objectContaining({ syncActionRequiredAt: true }),
    });
  });

  it('distinguishes missing wallets from exhausted full-resync generations', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([]);
    mockPrismaClient.wallet.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ requestedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX });

    await expect(requestFullResyncGeneration('missing')).resolves
      .toEqual({ status: 'not_found' });
    await expect(requestFullResyncGeneration('wallet-1')).resolves
      .toEqual({ status: 'generation_exhausted' });
    expect(mockPrismaClient.wallet.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'missing' },
      select: { requestedFullResyncGeneration: true },
    });
  });

  it('atomically clears sync-derived state and advances only the prepared generation', async () => {
    await expect(resetWalletForFullResync('wallet-1', 4)).resolves.toEqual({
      deletedTransactions: 4,
      resetPerformed: true,
    });

    expect(mockPrismaClient.transaction.deleteMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
    });
    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      data: { used: false },
    });
    expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: {
        syncInProgress: true,
        lastSyncedAt: null,
        lastSyncStatus: 'resyncing',
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncExecutionOwner: 'worker',
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: expect.any(Date),
        syncStateVersion: { increment: 1 },
        preparedFullResyncGeneration: 4,
      },
    });
  });

  it('does not repeat an old reset after a newer attempt completed', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 2,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 2,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(resetWalletForFullResync('wallet-1', 1)).resolves.toEqual({
      deletedTransactions: 0,
      resetPerformed: false,
    });
    expect(mockPrismaClient.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it('uses the high-water mark so A cannot re-arm after B', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{
        requestedFullResyncGeneration: 3,
        preparedFullResyncGeneration: 0,
        processedFullResyncGeneration: 0,
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      }])
      .mockResolvedValueOnce([{
        requestedFullResyncGeneration: 3,
        preparedFullResyncGeneration: 1,
        processedFullResyncGeneration: 0,
        lastSyncedAt: null,
        lastSyncStatus: 'resyncing',
        syncInProgress: true,
      }])
      .mockResolvedValueOnce([{
        requestedFullResyncGeneration: 3,
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 3,
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
      }]);

    await expect(resetWalletForFullResync('wallet-1', 1)).resolves.toMatchObject({
      resetPerformed: true,
    });
    await expect(resetWalletForFullResync('wallet-1', 3)).resolves.toMatchObject({
      resetPerformed: true,
    });
    await expect(resetWalletForFullResync('wallet-1', 1)).resolves.toEqual({
      deletedTransactions: 0,
      resetPerformed: false,
    });
    expect(mockPrismaClient.transaction.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a reset for a wallet that disappeared', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([]);

    await expect(resetWalletForFullResync('missing', 1)).rejects.toThrow('Wallet not found');
  });

  it('rejects a forged generation above the reserved high-water mark', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 1,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(resetWalletForFullResync('wallet-1', 4)).rejects.toThrow(
      'Full resync generation was not reserved',
    );
    expect(mockPrismaClient.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, FULL_RESYNC_GENERATION_MAX + 1])(
    'rejects generation outside the PostgreSQL integer domain: %s',
    async generation => {
      await expect(resetWalletForFullResync('wallet-1', generation)).rejects.toThrow(
        'Full resync generation is outside the supported range',
      );
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum reserved PostgreSQL integer generation', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
      preparedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX - 1,
      processedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX - 1,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(resetWalletForFullResync(
      'wallet-1',
      FULL_RESYNC_GENERATION_MAX,
    )).resolves.toMatchObject({ resetPerformed: true });
  });

  it('propagates a reset step failure from the shared transaction', async () => {
    mockPrismaClient.address.updateMany.mockRejectedValue(new Error('address reset failed'));

    await expect(resetWalletForFullResync('wallet-1', 1)).rejects.toThrow('address reset failed');
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('runs a destructive reset through the exact mutation fence', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{
        claimedIncrementalSyncGeneration: 6,
        incrementalSyncLeaseToken: fence.leaseToken,
      }])
      .mockResolvedValueOnce([{
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 0,
        processedFullResyncGeneration: 0,
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: true,
      }]);

    await expect(resetWalletForFullResync('wallet-1', 4, fence)).resolves.toEqual({
      deletedTransactions: 4,
      resetPerformed: true,
    });
    expect(mockPrismaClient.$transaction).toHaveBeenCalledOnce();
  });

  it('rejects a full-resync fence for another wallet', async () => {
    await expect(resetWalletForFullResync('wallet-1', 4, {
      ...fence,
      walletId: 'wallet-2',
    })).rejects.toThrow('Full resync mutation fence belongs to another wallet');
    await expect(completeFencedWalletFullResync('wallet-1', 4, {
      ...fence,
      walletId: 'wallet-2',
    }, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).rejects.toThrow('Full resync mutation fence belongs to another wallet');
  });

  it.each([0, FULL_RESYNC_GENERATION_MAX + 1])(
    'rejects fenced completion generation outside the PostgreSQL integer domain: %s',
    async generation => {
      await expect(completeFencedWalletFullResync('wallet-1', generation, fence, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 250,
      })).rejects.toThrow('Full resync generation is outside the supported range');
    },
  );

  it('atomically completes the full and incremental fenced generations', async () => {
    const syncedAt = new Date('2026-08-22T20:00:00.000Z');
    const syncState = { id: 'wallet-1', lastSyncStatus: 'success' };
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{
        claimedIncrementalSyncGeneration: 6,
        incrementalSyncLeaseToken: fence.leaseToken,
      }])
      .mockResolvedValueOnce([{
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 4,
        processedFullResyncGeneration: 3,
      }]);
    mockPrismaClient.wallet.update.mockResolvedValue(syncState);

    await expect(completeFencedWalletFullResync('wallet-1', 4, fence, {
      syncedAt,
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({ completionRecorded: true, syncState });
    expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'wallet-1' },
      data: expect.objectContaining({
        processedIncrementalSyncGeneration: 6,
        processedFullResyncGeneration: 4,
        incrementalSyncLeaseToken: null,
        lastSyncedAt: syncedAt,
      }),
    }));
  });

  it.each([
    undefined,
    { requestedFullResyncGeneration: 5, preparedFullResyncGeneration: 4, processedFullResyncGeneration: 3 },
    { requestedFullResyncGeneration: 4, preparedFullResyncGeneration: 3, processedFullResyncGeneration: 2 },
    { requestedFullResyncGeneration: 4, preparedFullResyncGeneration: 4, processedFullResyncGeneration: 4 },
  ])('rejects ineligible fenced full-resync completion state: %j', async wallet => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{
        claimedIncrementalSyncGeneration: 6,
        incrementalSyncLeaseToken: fence.leaseToken,
      }])
      .mockResolvedValueOnce(wallet ? [wallet] : []);

    await expect(completeFencedWalletFullResync('wallet-1', 4, fence, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({ completionRecorded: false });
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('records rebuild completion and successful lifecycle state atomically', async () => {
    const syncedAt = new Date('2026-08-22T20:00:00.000Z');
    mockPrismaClient.wallet.update.mockResolvedValue({
      syncInProgress: false,
      lastSyncedAt: syncedAt,
    });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 4,
      processedFullResyncGeneration: 3,
      lastSyncedAt: null,
      lastSyncStatus: 'resyncing',
      syncInProgress: true,
    }]);

    await expect(completeWalletFullResync('wallet-1', 4, {
      syncedAt,
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({
      completionRecorded: true,
      syncState: {
        syncInProgress: false,
        lastSyncedAt: syncedAt,
      },
    });
    expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: {
        lastSyncedAt: syncedAt,
        lastSyncedBlockHeight: 250,
        lastSyncStatus: 'success',
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncInProgress: false,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
        syncStateVersion: { increment: 1 },
        processedFullResyncGeneration: 4,
      },
    });
  });

  it('does not let an old completion overwrite a newer prepared generation', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 4,
      processedFullResyncGeneration: 2,
      lastSyncedAt: null,
      lastSyncStatus: 'resyncing',
      syncInProgress: true,
    }]);

    await expect(completeWalletFullResync('wallet-1', 3, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({ completionRecorded: false });
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects completion when the wallet no longer exists', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([]);

    await expect(completeWalletFullResync('missing-wallet', 1, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).rejects.toThrow('Wallet not found');
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects completion for a generation that was never reserved', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 3,
      processedFullResyncGeneration: 3,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(completeWalletFullResync('wallet-1', 4, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).rejects.toThrow('Full resync generation was not reserved');
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('treats an already successful generation as an idempotent completion', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 4,
      processedFullResyncGeneration: 4,
      lastSyncedAt: new Date('2026-08-22T20:00:00.000Z'),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(completeWalletFullResync('wallet-1', 4, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({ completionRecorded: false });
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('keeps mixed-version rows monotonic when legacy processed is ahead', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 4,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(resetWalletForFullResync('wallet-1', 3)).resolves.toEqual({
      deletedTransactions: 0,
      resetPerformed: false,
    });
    await expect(completeWalletFullResync('wallet-1', 3, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).resolves.toEqual({ completionRecorded: false });
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects completion before destructive preparation', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 2,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'success',
      syncInProgress: false,
    }]);

    await expect(completeWalletFullResync('wallet-1', 4, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 250,
    })).rejects.toThrow('Full resync generation was not prepared');
    expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, FULL_RESYNC_GENERATION_MAX + 1])(
    'rejects completion generation outside the PostgreSQL integer domain: %s',
    async generation => {
      await expect(completeWalletFullResync('wallet-1', generation, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 250,
      })).rejects.toThrow('Full resync generation is outside the supported range');
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    },
  );

  it('records successful rebuild state for a mixed-version processed generation', async () => {
    const syncedAt = new Date('2026-08-22T22:00:00.000Z');
    mockPrismaClient.wallet.update.mockResolvedValue({
      syncInProgress: false,
      lastSyncedAt: syncedAt,
    });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 4,
      lastSyncedAt: null,
      lastSyncStatus: 'resyncing',
      syncInProgress: true,
    }]);

    await expect(completeWalletFullResync('wallet-1', 4, {
      syncedAt,
      lastSyncedBlockHeight: 300,
    })).resolves.toMatchObject({
      completionRecorded: true,
      syncState: {
        syncInProgress: false,
        lastSyncedAt: syncedAt,
      },
    });
    expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastSyncedAt: syncedAt,
        lastSyncStatus: 'success',
        processedFullResyncGeneration: 4,
      }),
    }));
  });
});
