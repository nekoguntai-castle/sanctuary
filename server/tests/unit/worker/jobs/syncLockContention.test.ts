/**
 * Non-regression tests for the 2026-08-20 silent lock-contention no-op.
 *
 * Every ~5 minutes the stale sweep enqueued three wallets, the sync lock was
 * held by a tombstone left behind by an unconfirmed release, and the job
 * resolved `{ skipped: true, reason: 'lock_held' }` — a SUCCESSFUL completion
 * having done nothing. The wallets kept a green badge, no row was written, and
 * the only account was a worker log line the user cannot read. One of them went
 * 14.5 hours that way.
 *
 * `retryDelayMsIfUnavailable` returned a delay only for `fullResync === true`,
 * so ordinary and stale syncs always took the silent branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUpdate, mockFindByIdWithSelect, mockPublishLifecycle, mockBroadcastWalletLog,
  mockFindStale, mockFindStuckWithCutoff,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFindByIdWithSelect: vi.fn(),
  mockPublishLifecycle: vi.fn(),
  mockBroadcastWalletLog: vi.fn(),
  mockFindStale: vi.fn(),
  mockFindStuckWithCutoff: vi.fn(),
}));
const mockReadStaleWalletSchedulePolicy = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: mockReadStaleWalletSchedulePolicy,
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    updateSyncState: async (walletId: string, state: Record<string, unknown>) => {
      await mockUpdate(walletId, state);
      return {
        id: walletId,
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        syncActionRequiredAt: null,
        requestedFullResyncGeneration: 0,
        preparedFullResyncGeneration: 0,
        processedFullResyncGeneration: 0,
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncedBlockHeight: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
        syncStateVersion: 1,
        ...state,
      };
    },
    findByIdWithSelect: mockFindByIdWithSelect,
    findStale: mockFindStale,
    findStuckWithCutoff: mockFindStuckWithCutoff,
  },
  transactionRepository: { findWalletIdsWithPendingConfirmations: vi.fn() },
  resyncRepository: {
    resetWalletForFullResync: vi.fn(),
  },
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastWalletLog: mockBroadcastWalletLog,
}));

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: mockPublishLifecycle },
}));

import {
  createCheckStaleWalletsJob,
  resolveSyncLockRetryStartedAt,
  syncWalletJob,
} from '../../../../src/worker/jobs/syncJobs';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../../src/constants/walletSyncActivation';
import {
  isSyncWalletJobLockData,
  readSyncWalletJobData,
} from '../../../../src/jobs/syncJobContract';

const checkStaleWalletsJob = createCheckStaleWalletsJob();

describe('sync lock contention is never a silent success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    mockUpdate.mockResolvedValue({});
    mockFindStale.mockResolvedValue([]);
    mockFindStuckWithCutoff.mockResolvedValue([]);
  });

  it('re-delays an ordinary sync instead of skipping it', () => {
    const delay = syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({ walletId: 'w1' });
    expect(delay).not.toBeNull();
    expect(delay).toBeGreaterThan(0);
  });

  it('re-delays a stale-sweep sync instead of skipping it', () => {
    const delay = syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({
      walletId: 'w2',
      reason: 'stale',
    });
    expect(delay).not.toBeNull();
    expect(delay).toBeGreaterThan(0);
  });

  it('still re-delays a full resync', () => {
    expect(syncWalletJob.lockOptions?.retryDelayMsIfUnavailable?.({
      walletId: 'w3',
      fullResync: true,
    })).toBe(5000);
  });

  it('lets a full resync wait out a whole sync', () => {
    const window = syncWalletJob.lockOptions?.maxLockRetryWindowMs;
    const resolved = typeof window === 'function'
      ? window({ walletId: 'w', fullResync: true })
      : window;
    expect(resolved as number).toBeGreaterThan(5 * 60_000);
  });

  it('bounds an ordinary sync more tightly than the lock TTL', () => {
    // Without a bound shorter than the stale-sweep interval, every 5-minute
    // sweep would stack another delayed job per wallet.
    const window = syncWalletJob.lockOptions?.maxLockRetryWindowMs;
    const resolved = typeof window === 'function' ? window({ walletId: 'w4' }) : window;
    expect(resolved).toBeDefined();
    expect(resolved as number).toBeLessThan(5 * 60_000);
  });

  describe('v2 per-attempt contention clock', () => {
    const makeJob = (data: Record<string, unknown>, attemptsMade = 0, timestamp = 123) => ({
      data,
      attemptsMade,
      timestamp,
      updateData: vi.fn().mockResolvedValue(undefined),
    } as any);

    it('keeps the retained enqueue timestamp for v1 jobs', async () => {
      const job = makeJob({ version: 1, walletId: 'w-v1' }, 0, 456);
      await expect(resolveSyncLockRetryStartedAt(job)).resolves.toBe(456);
      expect(job.updateData).not.toHaveBeenCalled();
    });

    it('persists the first v2 contention time before delaying', async () => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(1_786_000_000_000);
      const job = makeJob({ version: 2, walletId: 'w-v2' }, 1, 100);

      await expect(resolveSyncLockRetryStartedAt(job)).resolves.toBe(1_786_000_000_000);
      expect(job.updateData).toHaveBeenCalledWith({
        version: 2,
        walletId: 'w-v2',
        lockContention: {
          firstLockContentionAt: 1_786_000_000_000,
          attemptEpoch: 1,
        },
      });
    });

    it('preserves a valid fenced v3 payload for the next lock attempt', async () => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(1_786_000_000_001);
      const job = makeJob({
        version: 3,
        walletId: 'w-v3',
        incrementalSyncGeneration: 7,
        requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      }, 1, 100);

      await expect(resolveSyncLockRetryStartedAt(job)).resolves.toBe(1_786_000_000_001);
      expect(job.updateData).toHaveBeenCalledWith({
        version: 3,
        walletId: 'w-v3',
        incrementalSyncGeneration: 7,
        requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        lockContention: {
          firstLockContentionAt: 1_786_000_000_001,
          attemptEpoch: 1,
        },
      });
      expect(isSyncWalletJobLockData(job.data)).toBe(true);
      expect(readSyncWalletJobData(job.data)).not.toBeNull();
    });

    it('reuses a matching marker and replaces one from an earlier attempt', async () => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(1_500);
      const matching = makeJob({
        version: 2,
        walletId: 'w-v2',
        lockContention: { firstLockContentionAt: 1_000, attemptEpoch: 2 },
      }, 2);
      await expect(resolveSyncLockRetryStartedAt(matching)).resolves.toBe(1_000);
      expect(matching.updateData).not.toHaveBeenCalled();

      vi.spyOn(Date, 'now').mockReturnValueOnce(2_000);
      const advanced = makeJob({
        version: 2,
        walletId: 'w-v2',
        lockContention: { firstLockContentionAt: 1_000, attemptEpoch: 1 },
      }, 2);
      await expect(resolveSyncLockRetryStartedAt(advanced)).resolves.toBe(2_000);
      expect(advanced.updateData).toHaveBeenCalledWith(expect.objectContaining({
        lockContention: { firstLockContentionAt: 2_000, attemptEpoch: 2 },
      }));
    });

    it('replaces a matching marker that is implausibly far in the future', async () => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(10_000);
      const job = makeJob({
        version: 2,
        walletId: 'w-v2',
        lockContention: {
          firstLockContentionAt: 10_000 + 30_001,
          attemptEpoch: 2,
        },
      }, 2);

      await expect(resolveSyncLockRetryStartedAt(job)).resolves.toBe(10_000);
      expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({
        lockContention: { firstLockContentionAt: 10_000, attemptEpoch: 2 },
      }));
    });

    it('fails instead of delaying without a durable v2 marker', async () => {
      const job = makeJob({ version: 2, walletId: 'w-v2' });
      job.updateData.mockRejectedValueOnce(new Error('redis write failed'));
      await expect(resolveSyncLockRetryStartedAt(job)).rejects.toThrow('redis write failed');
    });
  });

  it('neutralizes retired stale work before any wallet-lock attempt', async () => {
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({
      mode: 'forbidden',
      tombstone: {
        version: 1,
        forbiddenAt: '2026-08-22T00:00:00.000Z',
        compatibilityFloor: 2,
      },
    });
    const job = {
      id: 'b64_c3luYzpzdGFsZTp3LTE',
      name: 'sync-wallet',
      data: { version: 1, walletId: 'w-1', reason: 'stale' },
    } as any;

    await expect(syncWalletJob.lockOptions?.beforeLockAttempt?.(job)).resolves.toEqual({
      complete: true,
      result: expect.objectContaining({ error: 'Stale-wallet scheduler work retired' }),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('preserves stale work while the compatibility policy remains enabled', async () => {
    const job = {
      id: 'b64_c3luYzpzdGFsZTp3LTE',
      name: 'sync-wallet',
      data: { version: 1, walletId: 'w-1', reason: 'stale' },
    } as any;

    await expect(syncWalletJob.lockOptions?.beforeLockAttempt?.(job))
      .resolves.toBeUndefined();
  });

  it('fails closed on an indeterminate retained identity after retirement', async () => {
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({
      mode: 'forbidden',
      tombstone: {
        version: 1,
        forbiddenAt: '2026-08-22T00:00:00.000Z',
        compatibilityFloor: 2,
      },
    });
    const job = {
      id: 'b64_not+base64',
      name: 'sync-wallet',
      data: { version: 1, walletId: 'w-1', reason: 'custom-source' },
    } as any;

    await expect(syncWalletJob.lockOptions?.beforeLockAttempt?.(job))
      .rejects.toThrow('Cannot classify retained sync-wallet job identity');
  });

  describe('when the retry budget is exhausted', () => {
    const detail = {
      lockKey: 'sync:wallet:w5',
      retryWindowMs: 240_000,
      message: 'lock sync:wallet:w5 stayed held for the whole 240000ms retry budget',
      isFinalAttempt: true,
    };

    it('marks the wallet failed when no sync is actually running', async () => {
      // syncInProgress=false while the lock is held is the tombstone signature.
      mockFindByIdWithSelect.mockResolvedValue({ syncInProgress: false });

      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.({ walletId: 'w5' }, detail);

      expect(mockUpdate).toHaveBeenCalledWith('w5', expect.objectContaining({
        lastSyncStatus: 'failed',
      }));
      expect(mockPublishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'w5', transition: 'failed' }),
      );
    });

    it('does not persist terminal state while BullMQ still has an attempt', async () => {
      mockFindByIdWithSelect.mockResolvedValue({ syncInProgress: false });

      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { walletId: 'w5' },
        { ...detail, isFinalAttempt: false },
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockPublishLifecycle).not.toHaveBeenCalled();
    });

    it('does NOT mark the wallet failed when a sync is genuinely running', async () => {
      // Legitimate contention: another holder is mid-sync and will write its own
      // terminal status. Marking failed here would be a false negative.
      mockFindByIdWithSelect.mockResolvedValue({ syncInProgress: true });

      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.({ walletId: 'w5' }, detail);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('ignores a payload with no wallet id', async () => {
      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.({}, detail);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the liveness lookup itself fails', async () => {
      mockFindByIdWithSelect.mockRejectedValue(new Error('db down'));

      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.({ walletId: 'w6' }, detail);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockPublishLifecycle).not.toHaveBeenCalled();
    });

    it('publishes only after a transient durable-write failure recovers', async () => {
      vi.useFakeTimers();
      try {
        mockFindByIdWithSelect.mockResolvedValue({ syncInProgress: false });
        mockUpdate
          .mockRejectedValueOnce(new Error('database down'))
          .mockResolvedValueOnce({});

        const pending = syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
          { walletId: 'w5' },
          detail,
        );
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();

        expect(mockUpdate).toHaveBeenCalledTimes(2);
        expect(mockPublishLifecycle).toHaveBeenCalledWith(
          expect.objectContaining({ walletId: 'w5', transition: 'failed' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the durable failure when wallet-log publication throws', async () => {
      mockFindByIdWithSelect.mockResolvedValue({ syncInProgress: false });
      mockBroadcastWalletLog.mockImplementationOnce(() => {
        throw new Error('log bridge failed');
      });

      await expect(syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.(
        { walletId: 'w5' },
        detail,
      )).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalledWith('w5', expect.objectContaining({
        lastSyncStatus: 'failed',
        lastSyncFailureClass: 'lock_contention',
      }));
      expect(mockPublishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'w5', transition: 'failed' }),
      );
    });
  });
});
