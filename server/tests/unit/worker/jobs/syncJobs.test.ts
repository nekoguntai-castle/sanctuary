/**
 * Sync Jobs Tests
 *
 * Tests for the worker sync job handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

const syncJobPrismaMocks = vi.hoisted(() => ({
  walletFindMany: vi.fn<() => Promise<unknown[]>>(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
}));

// Mock prisma
vi.mock('../../../../src/models/prisma', () => ({
  default: (() => {
    const client: any = {
    wallet: {
      findMany: syncJobPrismaMocks.walletFindMany,
      findUnique: vi.fn().mockResolvedValue({ network: 'mainnet' }),
      update: syncJobPrismaMocks.walletUpdate,
    },
    address: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{
      requestedFullResyncGeneration: 1,
      processedFullResyncGeneration: 0,
    }]),
    };
    client.$transaction = vi.fn(async (callback: any) => callback(client));
    return client;
  })(),
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
import { syncWallet } from '../../../../src/services/bitcoin/blockchain';
import { populateMissingTransactionFields } from '../../../../src/services/bitcoin/sync/confirmations';
import {
  syncWalletJob,
  checkStaleWalletsJob,
} from '../../../../src/worker/jobs/syncJobs';
import { FULL_RESYNC_GENERATION_MAX } from '../../../../src/constants/fullResync';

describe('Sync Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobPrismaMocks.walletUpdate.mockResolvedValue({});
  });

  describe('syncWalletJob', () => {
    it('should have correct configuration', () => {
      expect(syncWalletJob.name).toBe('sync-wallet');
      expect(syncWalletJob.queue).toBe('sync');
      expect(syncWalletJob.options?.attempts).toBe(3);
      expect(syncWalletJob.lockOptions?.lockKey({ walletId: 'test' })).toBe('sync:wallet:test');
      expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({
        walletId: 'test',
        fullResync: true,
      })).toBe(5000);
      expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({
        walletId: 'test',
      })).toBeNull();
    });

    it('resets full-resync state while retaining durable rebuild job data', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{
        requestedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
        processedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX - 1,
      }] as any);
      vi.mocked(prisma.transaction.deleteMany).mockResolvedValueOnce({ count: 7 } as any);
      vi.mocked(syncWallet).mockResolvedValueOnce({ addresses: 3, transactions: 5, utxos: 10 });
      const updateData = vi.fn().mockResolvedValue(undefined);
      const job = {
        id: 'full-resync-job',
        data: {
          walletId: 'wallet-1',
          priority: 'high',
          reason: 'manual',
          fullResync: true,
          fullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
        updateData,
      } as unknown as Job;

      await syncWalletJob.handler(job);

      expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });
      expect(updateData).not.toHaveBeenCalled();
      expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.(job.data as any)).toBe(5000);
    });

    it('does not depend on mutable queue data after persisting the reset generation', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(syncWallet).mockResolvedValueOnce({ addresses: 1, transactions: 1, utxos: 2 });
      const updateData = vi.fn().mockRejectedValue(new Error('redis update failed'));
      const job = {
        id: 'full-resync-job',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
        updateData,
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).resolves.toMatchObject({ success: true });
      expect(prisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: 'resyncing' }),
      }));
      expect(prisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          processedFullResyncGeneration: 1,
        }),
      }));
      expect(prisma.wallet.update).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: 'failed' }),
      }));
      expect(syncWallet).toHaveBeenCalledWith('wallet-1');
      expect(updateData).not.toHaveBeenCalled();
    });

    it('retains rebuild intent and does not repeat deletion across a sync retry', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([{
          requestedFullResyncGeneration: 1,
          processedFullResyncGeneration: 0,
        }] as any)
        .mockResolvedValueOnce([{
          requestedFullResyncGeneration: 1,
          processedFullResyncGeneration: 1,
        }] as any);
      vi.mocked(syncWallet)
        .mockRejectedValueOnce(new Error('sync interrupted'))
        .mockResolvedValueOnce({ addresses: 1, transactions: 1, utxos: 2 });
      const updateData = vi.fn();
      const job = {
        id: 'full-resync-job',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
        updateData,
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow('sync interrupted');
      await expect(syncWalletJob.handler(job)).resolves.toMatchObject({ success: true });

      expect(prisma.transaction.deleteMany).toHaveBeenCalledTimes(1);
      expect(updateData).not.toHaveBeenCalled();
      expect(job.data.fullResync).toBe(true);
      expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.(job.data as any)).toBe(5000);
    });

    it('executes the retained successor generation after active reset A completes', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([{
          requestedFullResyncGeneration: 2,
          processedFullResyncGeneration: 0,
        }] as any)
        .mockResolvedValueOnce([{
          requestedFullResyncGeneration: 2,
          processedFullResyncGeneration: 1,
        }] as any);
      let signalActiveReset!: () => void;
      let finishActiveReset!: () => void;
      const activeResetStarted = new Promise<void>(resolve => { signalActiveReset = resolve; });
      const activeResetMayFinish = new Promise<void>(resolve => { finishActiveReset = resolve; });
      vi.mocked(syncWallet)
        .mockImplementationOnce(async () => {
          signalActiveReset();
          await activeResetMayFinish;
          return { addresses: 1, transactions: 1, utxos: 1 };
        })
        .mockResolvedValueOnce({ addresses: 2, transactions: 2, utxos: 2 });
      const activeJob = {
        id: 'full-resync-generation-1',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;
      const successorJob = {
        id: 'full-resync-generation-2',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 2,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      const activeProcessing = syncWalletJob.handler(activeJob);
      await activeResetStarted;
      expect(prisma.transaction.deleteMany).toHaveBeenCalledTimes(1);
      finishActiveReset();
      await expect(activeProcessing).resolves.toMatchObject({ success: true });
      await expect(syncWalletJob.handler(successorJob)).resolves.toMatchObject({ success: true });

      expect(prisma.transaction.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ processedFullResyncGeneration: 2 }),
      }));
    });

    it.each([
      undefined,
      0,
      -1,
      1.5,
      FULL_RESYNC_GENERATION_MAX + 1,
    ])('rejects a full-resync job with invalid generation %s', async fullResyncGeneration => {
      const job = {
        id: 'invalid-full-resync-job',
        data: { walletId: 'wallet-1', fullResync: true, fullResyncGeneration },
        attemptsMade: 0,
        opts: {},
        updateData: vi.fn(),
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow(
        'Full resync job is missing its durable generation',
      );
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
    });

    it('records truthful metadata when full-resync preparation exhausts retries', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.transaction.deleteMany).mockRejectedValueOnce(
        new Error('reset failed'),
      );
      const job = {
        id: 'exhausted-full-resync-job',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
        updateData: vi.fn(),
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow('reset failed');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'reset failed',
        },
      });
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('retains retry state without publishing failure metadata before the final attempt', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.transaction.deleteMany).mockRejectedValueOnce(
        new Error('reset failed'),
      );
      const job = {
        id: 'retryable-full-resync-job',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
        updateData: vi.fn(),
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow('reset failed');
      expect(prisma.wallet.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastSyncStatus: 'failed' }),
        }),
      );
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('preserves the preparation error when final metadata recording also fails', async () => {
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.transaction.deleteMany).mockRejectedValueOnce(
        new Error('reset failed'),
      );
      vi.mocked(prisma.wallet.update).mockRejectedValueOnce(
        new Error('metadata failed'),
      );
      const job = {
        id: 'exhausted-full-resync-job',
        data: {
          walletId: 'wallet-1',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
        updateData: vi.fn(),
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow('reset failed');
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('should sync wallet and update metadata on success', async () => {
      vi.mocked(syncWallet).mockResolvedValueOnce({
        addresses: 3,
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
      vi.mocked(syncWallet).mockResolvedValueOnce({ addresses: 0, transactions: 0, utxos: 0 });
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
      syncJobPrismaMocks.walletUpdate
        .mockImplementationOnce(async () => {
          markStarted();
          await finishMarkPromise;
          return {};
        })
        .mockResolvedValueOnce({});

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

    it('records final failure when shutdown aborts immediately after reset commits', async () => {
      const controller = new AbortController();
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      syncJobPrismaMocks.walletUpdate
        .mockImplementationOnce(async () => {
          controller.abort();
          return {};
        })
        .mockResolvedValueOnce({});
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
      };
      const job = {
        id: 'full-resync-final-abort',
        data: {
          walletId: 'wallet-final-abort',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job, execution)).rejects.toMatchObject({
        name: 'AbortError',
      });

      expect(prisma.wallet.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'wallet-final-abort' },
        data: {
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'This operation was aborted',
        },
      });
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('preserves the abort and safety-net cleanup when final abort metadata fails', async () => {
      const controller = new AbortController();
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      syncJobPrismaMocks.walletUpdate
        .mockImplementationOnce(async () => {
          controller.abort();
          return {};
        })
        .mockRejectedValueOnce(new Error('metadata failed'))
        .mockResolvedValueOnce({});
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
      };
      const job = {
        id: 'full-resync-final-abort-metadata-failure',
        data: {
          walletId: 'wallet-final-abort',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job, execution)).rejects.toMatchObject({
        name: 'AbortError',
      });

      expect(prisma.wallet.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'wallet-final-abort' },
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

    it('should record and rethrow the original sync failure for BullMQ retry', async () => {
      const syncError = new Error('Sync failed');
      vi.mocked(syncWallet).mockRejectedValueOnce(syncError);

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(mockJob)).rejects.toBe(syncError);

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

      await expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');

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

      // Cleanup errors are contained without masking the original failure.
      await expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');
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

      await expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');

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

      syncJobPrismaMocks.walletFindMany
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

      syncJobPrismaMocks.walletFindMany
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

});
