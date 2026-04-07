/**
 * Sync Jobs Tests
 *
 * Tests for the worker sync job handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Mock prisma
vi.mock('../../../../src/models/prisma', () => ({
  default: {
    wallet: {
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ network: 'mainnet' }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    sync: {
      staleThresholdMs: 600000, // 10 minutes
      staleBatchSize: 75,
      maxConcurrentSyncs: 5,
      maxSyncDurationMs: 120000,
      syncStaggerDelayMs: 2000,
    },
    bitcoin: {
      network: 'mainnet',
    },
  })),
}));

// Mock blockchain (includes syncWallet)
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: vi.fn().mockReturnValue(100000),
  setCachedBlockHeight: vi.fn(),
  syncWallet: vi.fn(),
}));

// Mock confirmations
vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../src/models/prisma';
import { syncWallet, setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';
import { updateTransactionConfirmations, populateMissingTransactionFields } from '../../../../src/services/bitcoin/sync/confirmations';
import {
  syncWalletJob,
  checkStaleWalletsJob,
  updateConfirmationsJob,
  updateAllConfirmationsJob,
} from '../../../../src/worker/jobs/syncJobs';

describe('Sync Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncWalletJob', () => {
    it('should have correct configuration', () => {
      expect(syncWalletJob.name).toBe('sync-wallet');
      expect(syncWalletJob.queue).toBe('sync');
      expect(syncWalletJob.options?.attempts).toBe(3);
      expect(syncWalletJob.lockOptions?.lockKey({ walletId: 'test' })).toBe('sync:wallet:test');
    });

    it('should sync wallet and update metadata on success', async () => {
      vi.mocked(syncWallet).mockResolvedValueOnce({
        transactions: 5,
        utxos: 10,
      });

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1', priority: 'normal', reason: 'scheduled' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      const result = await syncWalletJob.handler(mockJob);

      // Should mark wallet as syncing
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: { syncInProgress: true },
      });

      // Should call syncWallet
      expect(syncWallet).toHaveBeenCalledWith('wallet-1');

      // Should populate missing fields
      expect(populateMissingTransactionFields).toHaveBeenCalledWith('wallet-1');

      // Should update wallet with success status and block height
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          syncInProgress: false,
          lastSyncedAt: expect.any(Date),
          lastSyncedBlockHeight: 100000,
          lastSyncStatus: 'success',
          lastSyncError: null,
        },
      });

      expect(result.success).toBe(true);
      expect(result.transactionsFound).toBe(5);
      expect(result.utxosUpdated).toBe(10);
    });

    it('should return early when wallet does not exist', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null as any);

      const mockJob = {
        id: 'job-missing-wallet',
        data: { walletId: 'missing-wallet', reason: 'scheduled' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      const result = await syncWalletJob.handler(mockJob);

      expect(result).toEqual({
        success: false,
        duration: 0,
        error: 'Wallet not found',
      });
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });

    it('should handle sync failure and record error', async () => {
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      const result = await syncWalletJob.handler(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync failed');

      // Should update wallet with error status
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'Sync failed',
        },
      });
    });
  });

  describe('checkStaleWalletsJob', () => {
    it('should have correct configuration', () => {
      expect(checkStaleWalletsJob.name).toBe('check-stale-wallets');
      expect(checkStaleWalletsJob.queue).toBe('sync');
    });

    it('should find stale wallets', async () => {
      const staleWallets = [
        { id: 'wallet-1', name: 'Wallet 1', lastSyncedAt: null },
        { id: 'wallet-2', name: 'Wallet 2', lastSyncedAt: new Date('2020-01-01') },
      ];

      vi.mocked(prisma.wallet.findMany).mockResolvedValueOnce(staleWallets);

      const mockJob = {
        id: 'job-1',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      const result = await checkStaleWalletsJob.handler(mockJob);

      expect(result.staleWalletIds).toEqual(['wallet-1', 'wallet-2']);
      expect(result.queued).toBe(2);
    });

    it('should return empty array when no stale wallets', async () => {
      vi.mocked(prisma.wallet.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-1',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      const result = await checkStaleWalletsJob.handler(mockJob);

      expect(result.staleWalletIds).toEqual([]);
      expect(result.queued).toBe(0);
    });

    it('should limit results to configured stale batch size by default', async () => {
      vi.mocked(prisma.wallet.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-1',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 75,
        })
      );
    });

    it('should use a per-job maxWallets override when provided', async () => {
      vi.mocked(prisma.wallet.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-override',
        data: { maxWallets: 12 },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 12,
        })
      );
    });

    it('should use custom stale threshold if provided', async () => {
      vi.mocked(prisma.wallet.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-1',
        data: { staleThresholdMs: 300000 }, // 5 minutes
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      // Verify the cutoff time was calculated correctly
      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { lastSyncedAt: null },
              { lastSyncedAt: { lt: expect.any(Date) } },
            ]),
          }),
        })
      );
    });
  });

  describe('updateConfirmationsJob', () => {
    it('should have correct configuration', () => {
      expect(updateConfirmationsJob.name).toBe('update-confirmations');
      expect(updateConfirmationsJob.queue).toBe('confirmations');
    });

    it('should update block height when provided', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-1',
        data: { height: 100005, hash: '0000abc123' },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await updateConfirmationsJob.handler(mockJob);

      expect(setCachedBlockHeight).toHaveBeenCalledWith(100005, 'mainnet');
    });

    it('should return early if no pending transactions', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const mockJob = {
        id: 'job-1',
        data: { height: 100005 },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(result.updated).toBe(0);
      expect(result.notified).toBe(0);
      expect(updateTransactionConfirmations).not.toHaveBeenCalled();
    });

    it('should update confirmations for wallets with pending transactions', async () => {
      const pendingWallets = [
        { walletId: 'w1' },
        { walletId: 'w2' },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce(pendingWallets);
      vi.mocked(updateTransactionConfirmations)
        .mockResolvedValueOnce([
          { txid: 'tx1', oldConfirmations: 0, newConfirmations: 1 },
        ])
        .mockResolvedValueOnce([
          { txid: 'tx2', oldConfirmations: 2, newConfirmations: 3 },
          { txid: 'tx3', oldConfirmations: 5, newConfirmations: 6 },
        ]);

      const mockJob = {
        id: 'job-1',
        data: { height: 100005 },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(updateTransactionConfirmations).toHaveBeenCalledTimes(2);
      expect(updateTransactionConfirmations).toHaveBeenCalledWith('w1');
      expect(updateTransactionConfirmations).toHaveBeenCalledWith('w2');

      expect(result.updated).toBe(3);
      // 3 milestone confirmations (1, 3, 6)
      expect(result.notified).toBe(3);
    });

    it('should not increment notified count for non-milestone confirmations', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([{ walletId: 'w1' }]);
      vi.mocked(updateTransactionConfirmations).mockResolvedValueOnce([
        { txid: 'tx1', oldConfirmations: 1, newConfirmations: 2 },
      ]);

      const result = await updateConfirmationsJob.handler({
        id: 'job-non-milestone',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job);

      expect(result).toEqual({ updated: 1, notified: 0 });
    });

    it('should skip update summary log path when pending wallets produce no updates', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([{ walletId: 'w1' }]);
      vi.mocked(updateTransactionConfirmations).mockResolvedValueOnce([]);

      const result = await updateConfirmationsJob.handler({
        id: 'job-empty-updates',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job);

      expect(result).toEqual({ updated: 0, notified: 0 });
    });

    it('should continue when one wallet confirmation update fails', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        { walletId: 'w-fail' },
        { walletId: 'w-ok' },
      ]);
      vi.mocked(updateTransactionConfirmations)
        .mockRejectedValueOnce(new Error('wallet update failed'))
        .mockResolvedValueOnce([
          { txid: 'tx-ok', oldConfirmations: 0, newConfirmations: 1 },
        ]);

      const result = await updateConfirmationsJob.handler({
        id: 'job-partial-failure',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job);

      expect(result).toEqual({ updated: 1, notified: 1 });
      expect(updateTransactionConfirmations).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateAllConfirmationsJob', () => {
    it('delegates to updateConfirmationsJob without block data', async () => {
      const handlerSpy = vi.spyOn(updateConfirmationsJob, 'handler').mockResolvedValueOnce({
        updated: 2,
        notified: 1,
      });

      const result = await updateAllConfirmationsJob.handler();

      expect(handlerSpy).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
      expect(result).toEqual({ updated: 2, notified: 1 });
    });
  });
});
