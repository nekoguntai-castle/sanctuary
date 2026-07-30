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

    it('forwards the execution signal through sync and field-population phases', async () => {
      vi.mocked(syncWallet).mockResolvedValueOnce({ transactions: 0, utxos: 0 });
      const controller = new AbortController();
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
      };
      const job = {
        id: 'job-signal',
        data: { walletId: 'wallet-signal' },
        attemptsMade: 0,
      } as unknown as Job;

      await syncWalletJob.handler(job, execution);

      expect(syncWallet).toHaveBeenCalledWith('wallet-signal', 0, controller.signal);
      expect(populateMissingTransactionFields)
        .toHaveBeenCalledWith('wallet-signal', controller.signal);
    });

    it('resets syncInProgress when shutdown aborts while the mark-true update is in flight', async () => {
      let markStarted!: () => void;
      let finishMark!: () => void;
      const markStartedPromise = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const finishMarkPromise = new Promise<void>((resolve) => {
        finishMark = resolve;
      });
      vi.mocked(prisma.wallet.update)
        .mockImplementationOnce(async () => {
          markStarted();
          await finishMarkPromise;
          return {} as any;
        })
        .mockResolvedValueOnce({} as any);

      const controller = new AbortController();
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
      };
      const job = {
        id: 'job-abort-mark',
        data: { walletId: 'wallet-abort-mark' },
        attemptsMade: 0,
      } as unknown as Job;

      const processing = syncWalletJob.handler(job, execution);
      await markStartedPromise;
      controller.abort();
      finishMark();

      await expect(processing).rejects.toMatchObject({ name: 'AbortError' });
      expect(prisma.wallet.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'wallet-abort-mark' },
        data: { syncInProgress: false },
      });
      expect(syncWallet).not.toHaveBeenCalled();
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

    it('should safety-net reset syncInProgress when catch block DB update fails', async () => {
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
      // First call: set syncInProgress=true (succeeds)
      // Second call: catch block's error update (fails)
      // Third call: finally block's safety-net reset (succeeds)
      vi.mocked(prisma.wallet.update)
        .mockResolvedValueOnce({} as any)   // syncInProgress: true
        .mockRejectedValueOnce(new Error('DB connection lost'))  // catch block fails
        .mockResolvedValueOnce({} as any);  // finally safety-net

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      const result = await syncWalletJob.handler(mockJob);

      expect(result.success).toBe(false);

      // Verify the finally block's safety-net reset was called
      expect(prisma.wallet.update).toHaveBeenCalledTimes(3);
      expect(prisma.wallet.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'wallet-1' },
        data: { syncInProgress: false },
      });
    });

    it('should handle finally block safety-net DB failure gracefully', async () => {
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
      vi.mocked(prisma.wallet.update)
        .mockResolvedValueOnce({} as any)            // syncInProgress: true
        .mockRejectedValueOnce(new Error('DB down'))  // catch block fails
        .mockRejectedValueOnce(new Error('DB still down')); // finally safety-net also fails

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      // Should not throw — the finally block catches its own errors
      const result = await syncWalletJob.handler(mockJob);

      expect(result.success).toBe(false);
      expect(prisma.wallet.update).toHaveBeenCalledTimes(3);
    });

    it('should not double-reset flag when catch block succeeds', async () => {
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await syncWalletJob.handler(mockJob);

      // Only 2 calls: set true + catch block set false. No finally safety-net call.
      expect(prisma.wallet.update).toHaveBeenCalledTimes(2);
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

      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])           // stuck wallets query
        .mockResolvedValueOnce(staleWallets); // stale wallets query

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
      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])  // stuck wallets
        .mockResolvedValueOnce([]); // stale wallets

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
      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])   // stuck wallets
        .mockResolvedValueOnce([]);  // stale wallets

      const mockJob = {
        id: 'job-1',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      // Second findMany call (stale wallets) should have take limit
      expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          take: 75,
        })
      );
    });

    it('should use a per-job maxWallets override when provided', async () => {
      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])   // stuck wallets
        .mockResolvedValueOnce([]);  // stale wallets

      const mockJob = {
        id: 'job-override',
        data: { maxWallets: 12 },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          take: 12,
        })
      );
    });

    it('should use custom stale threshold if provided', async () => {
      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])   // stuck wallets
        .mockResolvedValueOnce([]);  // stale wallets

      const mockJob = {
        id: 'job-1',
        data: { staleThresholdMs: 300000 }, // 5 minutes
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      // Verify the stale wallets query (second call) used correct cutoff
      expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(2,
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

    it('should reset stuck syncInProgress flags for wallets exceeding maxSyncDurationMs', async () => {
      const stuckWallets = [
        { id: 'wallet-stuck-1', name: 'Stuck Wallet 1', lastSyncedAt: new Date('2026-04-08T05:07:00Z') },
        { id: 'wallet-stuck-2', name: 'Stuck Wallet 2', lastSyncedAt: new Date('2026-04-08T05:08:00Z') },
      ];

      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce(stuckWallets)  // stuck wallets query
        .mockResolvedValueOnce([]);           // stale wallets query

      const mockJob = {
        id: 'job-stuck-reset',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      // Should have reset both stuck wallets
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-stuck-1' },
        data: { syncInProgress: false },
      });
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-stuck-2' },
        data: { syncInProgress: false },
      });
    });

    it('should query stuck wallets using maxSyncDurationMs cutoff', async () => {
      vi.mocked(prisma.wallet.findMany)
        .mockResolvedValueOnce([])   // stuck wallets
        .mockResolvedValueOnce([]);  // stale wallets

      const mockJob = {
        id: 'job-cutoff-check',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job;

      await checkStaleWalletsJob.handler(mockJob);

      // First findMany call is for stuck wallets with syncInProgress: true
      expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          where: {
            syncInProgress: true,
            OR: [
              { lastSyncedAt: { lt: expect.any(Date) } },
              { lastSyncedAt: null },
            ],
          },
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
