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

// The stale reaper probes each wallet's sync lock before force-clearing its
// flag, so the lock authority has to answer in unit tests.
const mockIsLocked = vi.hoisted(() => vi.fn<(key: string) => Promise<boolean>>());

vi.mock('../../../../src/infrastructure/distributedLock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocked: mockIsLocked,
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
  assertChainReachable: vi.fn().mockResolvedValue(100000),
  syncWallet: vi.fn(),
}));

// Mock confirmations
vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../src/models/prisma';
import { syncWallet, assertChainReachable } from '../../../../src/services/bitcoin/blockchain';
import { populateMissingTransactionFields } from '../../../../src/services/bitcoin/sync/confirmations';
import { syncWalletJob } from '../../../../src/worker/jobs/syncJobs';
import { FULL_RESYNC_GENERATION_MAX } from '../../../../src/constants/fullResync';

function createOrdinarySyncJob(attemptsMade = 0, walletId = 'wallet-1'): Job {
  return {
    id: `ordinary-sync-${attemptsMade}`,
    data: { walletId },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job;
}

describe('Sync Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobPrismaMocks.walletUpdate.mockResolvedValue({});
    mockIsLocked.mockResolvedValue(false);
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
      // Previously null, which routed every ordinary sync to the silent
      // `{ skipped: true, reason: 'lock_held' }` no-op. See
      // syncLockContention.test.ts for why that had to change.
      expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({
        walletId: 'test',
      })).toBe(15000);
    });

    it('keeps transaction history when the node is unreachable at resync time', async () => {
      // The reset deletes every transaction before the rebuild is attempted, so
      // an unreachable node used to destroy history it could not then restore.
      // Reaching the chain is the one precondition worth proving up front.
      vi.mocked(prisma.wallet.findUnique)
        .mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(assertChainReachable).mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:50002'),
      );
      const job = {
        id: 'full-resync-unreachable',
        data: {
          walletId: 'wallet-1',
          priority: 'high',
          reason: 'manual',
          fullResync: true,
          fullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
        updateData: vi.fn().mockResolvedValue(undefined),
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow(/ECONNREFUSED/);

      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-1' },
          data: expect.objectContaining({
            lastSyncStatus: 'failed',
            lastSyncError: expect.stringContaining('ECONNREFUSED'),
          }),
        }),
      );
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
      expect(syncWallet).toHaveBeenCalledWith('wallet-1', 0, expect.any(AbortSignal));
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
        data: expect.objectContaining({
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'reset failed',
          lastSyncFailureClass: 'other',
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
      });
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('persists structured retry state when full-resync preparation will retry', async () => {
      vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
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
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          lastSyncStatus: 'retrying',
          lastSyncError: 'reset failed',
          syncExecutionOwner: 'worker',
          syncRetryCount: 1,
          syncNextRetryAt: new Date('2026-08-20T12:00:05.000Z'),
          syncStartedAt: null,
        }),
      });
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
        data: expect.objectContaining({
          syncInProgress: true,
          syncExecutionOwner: 'worker',
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: expect.any(Date),
          syncStateVersion: { increment: 1 },
        }),
      });

      // Should call syncWallet
      expect(syncWallet).toHaveBeenCalledWith('wallet-1', 0, expect.any(AbortSignal));

      // Should populate missing fields
      expect(populateMissingTransactionFields)
        .toHaveBeenCalledWith('wallet-1', expect.any(AbortSignal));

      // Should update wallet with success status and block height
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          syncInProgress: false,
          lastSyncedAt: expect.any(Date),
          lastSyncStatus: 'success',
          lastSyncError: null,
          lastSyncedBlockHeight: 100000,
          lastSyncFailureClass: null,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        }),
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

      expect(syncWallet).toHaveBeenCalledWith('wallet-signal', 0, expect.any(AbortSignal));
      const forwardedSignal = vi.mocked(syncWallet).mock.calls[0]?.[2];
      expect(forwardedSignal).not.toBe(controller.signal);
      expect(forwardedSignal?.aborted).toBe(false);
      expect(populateMissingTransactionFields)
        .toHaveBeenCalledWith('wallet-signal', forwardedSignal);
    });

    it.each([
      { attemptsMade: 0, expectedDelayMs: 5_000 },
      { attemptsMade: 1, expectedDelayMs: 10_000 },
    ])(
      'persists worker retry state after BullMQ attempt $attemptsMade without using the inline retry budget',
      async ({ attemptsMade, expectedDelayMs }) => {
        vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
        const syncError = new Error(`attempt ${attemptsMade} failed`);
        vi.mocked(syncWallet).mockRejectedValueOnce(syncError);

        await expect(syncWalletJob.handler(createOrdinarySyncJob(attemptsMade)))
          .rejects.toBe(syncError);

        // attemptsMade is BullMQ adapter metadata. The persisted value is the
        // failed worker-attempt ordinal; it does not inherit the inline path's
        // "initial attempt plus maxRetryAttempts" policy.
        expect(prisma.wallet.update).toHaveBeenCalledWith({
          where: { id: 'wallet-1' },
          data: expect.objectContaining({
            syncInProgress: false,
            lastSyncStatus: 'retrying',
            lastSyncError: syncError.message,
            lastSyncFailureClass: 'other',
            syncExecutionOwner: 'worker',
            syncRetryCount: attemptsMade + 1,
            syncNextRetryAt: new Date(Date.now() + expectedDelayMs),
            syncStartedAt: null,
          }),
        });
      },
    );

    it('bounds field population within the worker attempt duration cap', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(syncWallet).mockResolvedValueOnce({
          addresses: 0,
          transactions: 0,
          utxos: 0,
        });
        let populateSignal: AbortSignal | undefined;
        vi.mocked(populateMissingTransactionFields).mockImplementationOnce(
          async (_walletId, signal) => {
            populateSignal = signal;
            return new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          },
        );

        const processing = syncWalletJob.handler(createOrdinarySyncJob(0));
        const outcome = processing.catch(error => error);
        await vi.advanceTimersByTimeAsync(120_000);

        expect(populateSignal?.aborted).toBe(true);
        await expect(outcome).resolves.toMatchObject({
          message: 'Sync attempt timed out after 120000ms',
        });
        expect(prisma.wallet.update).toHaveBeenCalledWith({
          where: { id: 'wallet-1' },
          data: expect.objectContaining({
            lastSyncStatus: 'retrying',
            lastSyncFailureClass: 'timeout',
            syncExecutionOwner: 'worker',
          }),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      { backoff: 1_250, expectedDelayMs: 1_250 },
      { backoff: { type: 'fixed', delay: 2_500 }, expectedDelayMs: 2_500 },
      { backoff: { type: 'fixed' }, expectedDelayMs: 0 },
    ])(
      'derives worker retry time from the adapter backoff $backoff',
      async ({ backoff, expectedDelayMs }) => {
        vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
        const syncError = new Error('retry with configured backoff');
        vi.mocked(syncWallet).mockRejectedValueOnce(syncError);
        const job = createOrdinarySyncJob(0) as Job & { opts: Record<string, unknown> };
        job.opts = { attempts: 3, backoff };

        await expect(syncWalletJob.handler(job)).rejects.toBe(syncError);

        expect(prisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            lastSyncStatus: 'retrying',
            syncNextRetryAt: new Date(Date.now() + expectedDelayMs),
          }),
        }));
      },
    );

    it('persists an ordinary final worker failure after the third total BullMQ attempt', async () => {
      const syncError = new Error('final worker failure');
      vi.mocked(syncWallet).mockRejectedValueOnce(syncError);

      await expect(syncWalletJob.handler(createOrdinarySyncJob(2))).rejects.toBe(syncError);

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: syncError.message,
          lastSyncFailureClass: 'other',
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
        }),
      });
    });

    it.each([
      { attemptsMade: 0, status: 'retrying', owner: 'worker', retryCount: 1 },
      { attemptsMade: 2, status: 'failed', owner: null, retryCount: 0 },
    ])(
      'persists an ordinary abort as $status on BullMQ attempt $attemptsMade',
      async ({ attemptsMade, status, owner, retryCount }) => {
        const controller = new AbortController();
        const execution = {
          signal: controller.signal,
          throwIfAborted: () => controller.signal.throwIfAborted(),
        };
        vi.mocked(syncWallet).mockImplementationOnce(async () => {
          controller.abort();
          controller.signal.throwIfAborted();
          throw new Error('unreachable');
        });

        await expect(syncWalletJob.handler(createOrdinarySyncJob(attemptsMade), execution))
          .rejects.toMatchObject({ name: 'AbortError' });

        expect(prisma.wallet.update).toHaveBeenCalledWith({
          where: { id: 'wallet-1' },
          data: expect.objectContaining({
            syncInProgress: false,
            lastSyncStatus: status,
            lastSyncError: 'This operation was aborted',
            lastSyncFailureClass: 'sync_cancelled',
            syncExecutionOwner: owner,
            syncRetryCount: retryCount,
            syncNextRetryAt: status === 'retrying' ? expect.any(Date) : null,
            syncStartedAt: null,
          }),
        });
      },
    );

    it.each([
      { attemptsMade: 0, status: 'retrying', owner: 'worker', retryCount: 1 },
      { attemptsMade: 2, status: 'failed', owner: null, retryCount: 0 },
    ])(
      'aborts a hung worker sync at maxSyncDurationMs and records $status',
      async ({ attemptsMade, status, owner, retryCount }) => {
        vi.useFakeTimers();
        try {
          const parentController = new AbortController();
          const execution = {
            signal: parentController.signal,
            throwIfAborted: () => parentController.signal.throwIfAborted(),
          };
          let syncSignal: AbortSignal | undefined;
          vi.mocked(syncWallet).mockImplementationOnce(async (_walletId, _depth, signal) => {
            syncSignal = signal;
            return new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          });

          const processing = syncWalletJob.handler(createOrdinarySyncJob(attemptsMade), execution);
          const outcome = processing.catch(error => error);
          await vi.advanceTimersByTimeAsync(0);
          expect(syncSignal).toBeDefined();

          await vi.advanceTimersByTimeAsync(120000);

          // The lifecycle owner must abort the signal it hands to the adapter;
          // aborting the caller-owned parent signal would violate ownership.
          expect(syncSignal?.aborted).toBe(true);
          expect(parentController.signal.aborted).toBe(false);
          await expect(outcome).resolves.toBeInstanceOf(Error);
          expect(prisma.wallet.update).toHaveBeenCalledWith({
            where: { id: 'wallet-1' },
            data: expect.objectContaining({
              syncInProgress: false,
              lastSyncStatus: status,
              lastSyncFailureClass: 'timeout',
              syncExecutionOwner: owner,
              syncRetryCount: retryCount,
              syncNextRetryAt: status === 'retrying' ? expect.any(Date) : null,
              syncStartedAt: null,
            }),
          });
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it('keeps a committed success terminal when shutdown arrives immediately afterward', async () => {
      const controller = new AbortController();
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
      };
      vi.mocked(syncWallet).mockResolvedValueOnce({ addresses: 1, transactions: 2, utxos: 3 });
      syncJobPrismaMocks.walletUpdate
        .mockResolvedValueOnce({})
        .mockImplementationOnce(async (args?: unknown) => {
          const data = (args as { data?: { lastSyncStatus?: string } })?.data;
          if (data?.lastSyncStatus === 'success') controller.abort();
          return {};
        });

      await expect(syncWalletJob.handler(createOrdinarySyncJob(0), execution))
        .resolves.toMatchObject({ success: true });

      const persistedStatuses = syncJobPrismaMocks.walletUpdate.mock.calls
        .map(([args]) => (args as { data?: { lastSyncStatus?: string } })?.data?.lastSyncStatus)
        .filter(Boolean);
      expect(persistedStatuses).toEqual(['success']);
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
        data: expect.objectContaining({
          syncInProgress: false,
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
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
        data: expect.objectContaining({
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'This operation was aborted',
          lastSyncFailureClass: 'sync_cancelled',
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
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
        data: expect.objectContaining({
          syncInProgress: false,
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
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

    it('should record and rethrow the original sync failure after BullMQ retries are exhausted', async () => {
      const syncError = new Error('Sync failed');
      vi.mocked(syncWallet).mockRejectedValueOnce(syncError);

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(mockJob)).rejects.toBe(syncError);

      // Should update wallet with error status
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: 'Sync failed',
          lastSyncFailureClass: 'other',
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
      });
    });

    it('should safety-net reset syncInProgress when catch block DB update fails', async () => {
      vi.useFakeTimers();
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
      // The catch-block status write is retried by the shared lifecycle owner,
      // so the safety net only engages once every attempt has failed. Reject all
      // four, then let the finally block's reset succeed.
      vi.mocked(prisma.wallet.update)
        .mockResolvedValueOnce({} as any)                          // syncInProgress: true
        .mockRejectedValueOnce(new Error('DB connection lost'))     // terminal write attempt 1
        .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 2
        .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 3
        .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 4 (final)
        .mockResolvedValueOnce({} as any);                          // finally safety-net

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job;

      const pending = expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');
      await vi.runAllTimersAsync();
      await pending;

      // Verify the finally block's safety-net reset was the last write.
      expect(prisma.wallet.update).toHaveBeenCalledTimes(6);
      expect(prisma.wallet.update).toHaveBeenNthCalledWith(6, {
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          syncInProgress: false,
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
      });
      vi.useRealTimers();
    });

    it('should handle finally block safety-net DB failure gracefully', async () => {
      vi.useFakeTimers();
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
      vi.mocked(prisma.wallet.update)
        .mockResolvedValueOnce({} as any)                    // syncInProgress: true
        .mockRejectedValueOnce(new Error('DB down'))          // terminal write attempt 1
        .mockRejectedValueOnce(new Error('DB down'))          // attempt 2
        .mockRejectedValueOnce(new Error('DB down'))          // attempt 3
        .mockRejectedValueOnce(new Error('DB down'))          // attempt 4 (final)
        .mockRejectedValueOnce(new Error('DB still down'));   // finally safety-net also fails

      const mockJob = {
        id: 'job-1',
        data: { walletId: 'wallet-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      // Cleanup errors are contained without masking the original failure.
      const pending = expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');
      await vi.runAllTimersAsync();
      await pending;
      expect(prisma.wallet.update).toHaveBeenCalledTimes(6);
      vi.useRealTimers();
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
});
