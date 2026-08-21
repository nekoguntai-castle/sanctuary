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
  broadcastSyncStatus: vi.fn(),
  broadcastWalletLog: vi.fn(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastSyncStatus: bridgeMocks.broadcastSyncStatus,
  broadcastWalletLog: bridgeMocks.broadcastWalletLog,
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

describe('syncWalletJob worker → UI bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.walletUpdate.mockResolvedValue({});
    vi.mocked(syncWallet).mockResolvedValue({
      transactions: 2,
      utxos: 1,
    } as never);
  });

  it('announces that the sync started', async () => {
    await syncWalletJob.handler(createJob(), undefined as never);

    expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1', {
      inProgress: true,
    });
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

    const successCall = bridgeMocks.broadcastSyncStatus.mock.calls.find(
      ([, status]) => status.status === 'success',
    );
    expect(successCall).toBeDefined();
    expect(successCall?.[1]).toEqual({
      inProgress: false,
      status: 'success',
      lastSyncedAt: expect.any(Date),
    });

    const persisted = bridgeMocks.walletUpdate.mock.calls
      .map(([args]: any[]) => args.data)
      .find((data: any) => data.lastSyncStatus === 'success');
    expect(persisted.lastSyncedAt).toEqual(successCall?.[1].lastSyncedAt);
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

    expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1', {
      inProgress: false,
      status: 'failed',
      error: 'Electrum unreachable',
      retriesExhausted: true,
    });
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

  it('does not reclassify a committed success when success publication throws', async () => {
    bridgeMocks.broadcastSyncStatus
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('redis publish failed');
      })
      .mockImplementation(() => undefined);

    await expect(syncWalletJob.handler(createJob(), undefined as never))
      .resolves.toMatchObject({ success: true });

    const persistedStatuses = bridgeMocks.walletUpdate.mock.calls
      .map(([args]) => (args as { data?: { lastSyncStatus?: string } })?.data?.lastSyncStatus)
      .filter(Boolean);
    expect(persistedStatuses).toEqual(['success']);
    expect(bridgeMocks.broadcastWalletLog).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({ message: 'Sync completed' }));
  });

  it('marks the last attempt as exhausted', async () => {
    vi.mocked(syncWallet).mockRejectedValue(new Error('boom'));
    const job = createJob();
    (job as { attemptsMade: number }).attemptsMade = 2;

    await expect(syncWalletJob.handler(job, undefined as never)).rejects.toThrow('boom');

    expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({ status: 'failed', retriesExhausted: true }));
  });

  it('still reports the failure when the error row cannot be written', async () => {
    vi.mocked(syncWallet).mockRejectedValue(new Error('boom'));
    bridgeMocks.walletUpdate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({});
    const job = createJob();
    (job as { attemptsMade: number }).attemptsMade = 2;

    await expect(syncWalletJob.handler(job, undefined as never)).rejects.toThrow('boom');

    expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1',
      expect.objectContaining({ status: 'failed', error: 'boom' }));
  });

  it('emits nothing for a wallet that does not exist', async () => {
    const prisma = (await import('../../../../src/models/prisma')).default;
    vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null as never);

    await syncWalletJob.handler(createJob(), undefined as never);

    expect(bridgeMocks.broadcastSyncStatus).not.toHaveBeenCalled();
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
      expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1', {
        inProgress: false,
        status: 'failed',
        error: 'Lock sync:wallet:wallet-1 stayed held for the whole retry budget',
        retriesExhausted: true,
      });
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
      expect(bridgeMocks.broadcastSyncStatus).not.toHaveBeenCalled();
    });

    // The processor logs and swallows a failure here, so the one thing that must
    // not depend on the database is the report itself.
    it('still reports to the UI and retries the durable write after a transient failure', async () => {
      vi.useFakeTimers();
      try {
        bridgeMocks.walletUpdate
          .mockRejectedValueOnce(new Error('database down'))
          .mockResolvedValueOnce({});

        const pending = syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
          { walletId: 'wallet-1' },
          { lockKey: 'k', retryWindowMs: 1, message: 'gave up', isFinalAttempt: true },
        );
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();

        expect(bridgeMocks.walletUpdate).toHaveBeenCalledTimes(2);
        expect(bridgeMocks.broadcastSyncStatus).toHaveBeenCalledWith('wallet-1',
          expect.objectContaining({ status: 'failed' }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('persists lock contention even when both publications throw', async () => {
      bridgeMocks.broadcastSyncStatus.mockImplementationOnce(() => {
        throw new Error('status bridge failed');
      });
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
