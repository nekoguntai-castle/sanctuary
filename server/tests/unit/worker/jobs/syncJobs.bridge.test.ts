/**
 * Sync Job → UI Bridge Tests
 *
 * The worker's sync handler used to perform an entire sync without emitting a
 * single WebSocket event or wallet log entry, so a worker-run sync (which is
 * every sync) was invisible to the UI. These tests pin the start / success /
 * failure signals it must now emit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

const bridgeMocks = vi.hoisted(() => ({
  broadcastWalletLog: vi.fn(),
  publishLifecycle: vi.fn<(...args: unknown[]) => Promise<void>>(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastWalletLog: bridgeMocks.broadcastWalletLog,
}));

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: bridgeMocks.publishLifecycle },
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: (() => {
    const client: any = {
      wallet: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({
          network: 'mainnet',
          syncInProgress: false,
        }),
        update: bridgeMocks.walletUpdate,
      },
      address: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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

vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    sync: {
      staleThresholdMs: 600000,
      staleBatchSize: 75,
      maxConcurrentSyncs: 5,
      maxSyncDurationMs: 120000,
      syncStaggerDelayMs: 2000,
    },
    bitcoin: { network: 'mainnet' },
  })),
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: vi.fn().mockReturnValue(100000),
  setCachedBlockHeight: vi.fn(),
  // A full resync proves the chain is reachable before it deletes anything.
  assertChainReachable: vi.fn().mockResolvedValue(100000),
  syncWallet: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));

import { syncWallet } from '../../../../src/services/bitcoin/blockchain';
import { syncWalletJob } from '../../../../src/worker/jobs/syncJobs';

function createJob(data: Record<string, unknown> = {}): Job {
  return {
    id: 'job-bridge',
    data: { walletId: 'wallet-1', reason: 'manual', ...data },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Job;
}

function persistedSyncState(args?: unknown, stateVersion = 1): Record<string, unknown> {
  const data = (args as { data?: Record<string, unknown> } | undefined)?.data ?? {};
  return {
    syncInProgress: false,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncStartedAt: null,
    ...data,
    syncStateVersion: stateVersion,
  };
}

describe('syncWalletJob worker → UI bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let stateVersion = 0;
    bridgeMocks.walletUpdate.mockImplementation(async (args: unknown) => (
      persistedSyncState(args, ++stateVersion)
    ));
    vi.mocked(syncWallet).mockResolvedValue({
      transactions: 2,
      utxos: 1,
    } as never);
  });

  it('announces that the sync started', async () => {
    await syncWalletJob.handler(createJob(), undefined as never);

    expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-1', transition: 'started' }),
    );
    expect(bridgeMocks.broadcastWalletLog).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({ level: 'info', module: 'SYNC', message: 'Sync started' }));
    expect(bridgeMocks.walletUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: expect.any(Date),
      }),
    }));
  });

  it('announces success with the timestamp it persisted', async () => {
    await syncWalletJob.handler(createJob(), undefined as never);

    const successCall = bridgeMocks.publishLifecycle.mock.calls.find(
      ([transition]: any[]) => transition.transition === 'succeeded',
    );
    expect(successCall).toBeDefined();
    expect((successCall?.[0] as any).state).toEqual(expect.objectContaining({
      syncInProgress: false,
      lastSyncStatus: 'success',
      lastSyncedAt: expect.any(Date),
    }));

    const persisted = bridgeMocks.walletUpdate.mock.calls
      .map(([args]: any[]) => args.data)
      .find((data: any) => data.lastSyncStatus === 'success');
    expect(persisted.lastSyncedAt).toEqual((successCall?.[0] as any).state.lastSyncedAt);
  });

  it('announces a full resync start distinctly', async () => {
    await syncWalletJob.handler(
      createJob({ fullResync: true, fullResyncGeneration: 1 }),
      undefined as never,
    );

    expect(bridgeMocks.broadcastWalletLog).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({ message: 'Full resync started' }));
  });

  it('carries the failure reason to the UI', async () => {
    vi.mocked(syncWallet).mockRejectedValue(new Error('Electrum unreachable'));
    const job = createJob();
    (job as { attemptsMade: number }).attemptsMade = 2;

    await expect(syncWalletJob.handler(job, undefined as never))
      .rejects.toThrow('Electrum unreachable');

    expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-1', transition: 'failed' }),
    );
    expect(bridgeMocks.broadcastWalletLog).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({
        level: 'error',
        module: 'SYNC',
        message: 'Sync failed: Electrum unreachable',
      }));
    expect(bridgeMocks.walletUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastSyncFailureClass: 'electrum_unavailable',
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
      }),
    }));
  });

  it('publishes the BullMQ retry budget with a non-final retry snapshot', async () => {
    vi.mocked(syncWallet).mockRejectedValue(new Error('temporary failure'));
    const job = createJob();
    (job as unknown as { opts: Record<string, unknown> }).opts = {};

    await expect(syncWalletJob.handler(job, undefined as never))
      .rejects.toThrow('temporary failure');

    expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ transition: 'retrying' }),
      { maxRetries: 2 },
    );
  });

  it('marks the last attempt as exhausted', async () => {
    vi.mocked(syncWallet).mockRejectedValue(new Error('boom'));
    const job = createJob();
    (job as { attemptsMade: number }).attemptsMade = 2;

    await expect(syncWalletJob.handler(job, undefined as never)).rejects.toThrow('boom');

    expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ transition: 'failed' }),
    );
  });

  it('does not publish an uncommitted failure when the error row cannot be written', async () => {
    vi.useFakeTimers();
    vi.mocked(syncWallet).mockRejectedValue(new Error('boom'));
    bridgeMocks.walletUpdate
      .mockImplementationOnce(async (args) => persistedSyncState(args, 1))
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockImplementationOnce(async (args) => persistedSyncState(args, 2));
    const job = createJob();
    (job as { attemptsMade: number }).attemptsMade = 2;

    const processing = expect(syncWalletJob.handler(job, undefined as never)).rejects.toThrow('boom');
    await vi.runAllTimersAsync();
    await processing;

    expect(bridgeMocks.publishLifecycle).not.toHaveBeenCalledWith(
      expect.objectContaining({ transition: 'failed' }),
    );
    expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ transition: 'cleared' }),
    );
    vi.useRealTimers();
  });

  it('emits nothing for a wallet that does not exist', async () => {
    const prisma = (await import('../../../../src/models/prisma')).default;
    vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null as never);

    await syncWalletJob.handler(createJob(), undefined as never);

    expect(bridgeMocks.publishLifecycle).not.toHaveBeenCalled();
  });

  describe('lock retry budget exhaustion', () => {
    // The processor gives up on lock contention before the handler runs, so
    // nothing here writes the wallet row unless the handler declares what that
    // outcome means. Without this the wallet keeps whatever badge it had and
    // the reason for the give-up exists only in a worker log.
    it('records the give-up as a durable failure reason', async () => {
      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { walletId: 'wallet-1', fullResync: true },
        {
          lockKey: 'sync:wallet:wallet-1',
          retryWindowMs: 1_860_000,
          message: 'Lock sync:wallet:wallet-1 stayed held for the whole retry budget',
          isFinalAttempt: true,
        },
      );

      expect(bridgeMocks.walletUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          lastSyncStatus: 'failed',
          lastSyncError: 'Lock sync:wallet:wallet-1 stayed held for the whole retry budget',
          lastSyncFailureClass: 'lock_contention',
          syncExecutionOwner: null,
          syncStartedAt: null,
        }),
      }));
      expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'wallet-1', transition: 'failed' }),
      );
    });

    // syncInProgress belongs to whoever holds the lock. Clearing it here would
    // false-idle a sync that is genuinely running - the exact defect a6 fixes.
    it('leaves the lock holder\'s in-progress flag alone', async () => {
      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { walletId: 'wallet-1' },
        { lockKey: 'k', retryWindowMs: 1, message: 'gave up', isFinalAttempt: true },
      );

      const [call] = bridgeMocks.walletUpdate.mock.calls as any[];
      expect(call[0].data).not.toHaveProperty('syncInProgress');
    });

    it('ignores a payload that names no wallet', async () => {
      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { reason: 'manual' },
        { lockKey: 'k', retryWindowMs: 1, message: 'gave up', isFinalAttempt: true },
      );

      expect(bridgeMocks.walletUpdate).not.toHaveBeenCalled();
      expect(bridgeMocks.publishLifecycle).not.toHaveBeenCalled();
    });

    it('publishes only after a transient durable-write failure recovers', async () => {
      vi.useFakeTimers();
      try {
        bridgeMocks.walletUpdate
          .mockRejectedValueOnce(new Error('database down'))
          .mockImplementationOnce(async (args) => persistedSyncState(args, 1));

        const pending = syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
          { walletId: 'wallet-1' },
          { lockKey: 'k', retryWindowMs: 1, message: 'gave up', isFinalAttempt: true },
        );
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();

        expect(bridgeMocks.walletUpdate).toHaveBeenCalledTimes(2);
        expect(bridgeMocks.publishLifecycle).toHaveBeenCalledWith(
          expect.objectContaining({ transition: 'failed' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('persists lock contention when the wallet-log publication throws', async () => {
      bridgeMocks.broadcastWalletLog.mockImplementationOnce(() => {
        throw new Error('log bridge failed');
      });

      await expect(syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { walletId: 'wallet-1' },
        { lockKey: 'k', retryWindowMs: 1, message: 'gave up', isFinalAttempt: true },
      )).resolves.toBeUndefined();

      expect(bridgeMocks.walletUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          lastSyncStatus: 'failed',
          lastSyncFailureClass: 'lock_contention',
        }),
      }));
    });
  });
});
