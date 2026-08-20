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
  mockUpdate, mockFindByIdWithSelect, mockBroadcastSyncStatus, mockBroadcastWalletLog,
  mockFindStranded, mockEnqueueFullResync, mockFindStale, mockFindStuckWithCutoff,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFindByIdWithSelect: vi.fn(),
  mockBroadcastSyncStatus: vi.fn(),
  mockBroadcastWalletLog: vi.fn(),
  mockFindStranded: vi.fn(),
  mockEnqueueFullResync: vi.fn(),
  mockFindStale: vi.fn(),
  mockFindStuckWithCutoff: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    update: mockUpdate,
    findByIdWithSelect: mockFindByIdWithSelect,
    findStale: mockFindStale,
    findStuckWithCutoff: mockFindStuckWithCutoff,
  },
  transactionRepository: { findWalletIdsWithPendingConfirmations: vi.fn() },
  resyncRepository: {
    resetWalletForFullResync: vi.fn(),
    findStrandedFullResyncWallets: mockFindStranded,
  },
}));

vi.mock('../../../../src/services/workerSyncQueue', () => ({
  enqueueFullResyncBatch: mockEnqueueFullResync,
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastSyncStatus: mockBroadcastSyncStatus,
  broadcastWalletLog: mockBroadcastWalletLog,
}));

import { checkStaleWalletsJob, syncWalletJob } from '../../../../src/worker/jobs/syncJobs';

describe('sync lock contention is never a silent success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockFindStale.mockResolvedValue([]);
    mockFindStuckWithCutoff.mockResolvedValue([]);
    mockFindStranded.mockResolvedValue([]);
    mockEnqueueFullResync.mockResolvedValue({
      acceptedWalletIds: [], deduplicatedWalletIds: [], indeterminateWallets: [], outcomes: [],
    });
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
      expect(mockBroadcastSyncStatus).toHaveBeenCalled();
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

    it('still records the failure when the liveness lookup itself fails', async () => {
      // A failing lookup must not become a reason to stay silent: the wallet
      // would keep a green badge with nothing else ever writing a status.
      mockFindByIdWithSelect.mockRejectedValue(new Error('db down'));

      await syncWalletJob.lockOptions?.onLockRetryBudgetExhausted?.({ walletId: 'w6' }, detail);

      expect(mockUpdate).toHaveBeenCalledWith('w6', expect.objectContaining({
        lastSyncStatus: 'failed',
      }));
    });
  });
});


describe('stranded full-resync reconciliation', () => {
  const staleJob = (id: string) => ({
    id, data: {}, attemptsMade: 0, opts: { attempts: 2 },
  }) as never;

  beforeEach(() => {
    mockFindStale.mockResolvedValue([]);
    mockFindStuckWithCutoff.mockResolvedValue([]);
  });

  it('looks for stranded generations on every stale sweep', async () => {
    // Nothing else in the server reads requested > processed. If this call is
    // removed, a lost full-resync generation is permanent and invisible again.
    await checkStaleWalletsJob.handler(staleJob('job-0'));
    expect(mockFindStranded).toHaveBeenCalled();
  });

  it('logs and continues when the lookup itself fails', async () => {
    mockFindStranded.mockRejectedValueOnce(new Error('db down'));
    await expect(checkStaleWalletsJob.handler(staleJob('job-1'))).resolves.toBeDefined();
  });

  it('re-enqueues a stranded generation when the queue accepts it', async () => {
    mockFindStranded.mockResolvedValueOnce([{
      id: 'w9', name: 'AMN-MS3',
      requestedFullResyncGeneration: 1, processedFullResyncGeneration: 0,
    }]);
    mockEnqueueFullResync.mockResolvedValueOnce({
      acceptedWalletIds: ['w9'], deduplicatedWalletIds: [], indeterminateWallets: [], outcomes: [],
    });

    await expect(checkStaleWalletsJob.handler(staleJob('job-3'))).resolves.toBeDefined();
    expect(mockEnqueueFullResync).toHaveBeenCalledWith(
      ['w9'],
      { reason: 'reconcile-stranded-full-resync' },
    );
  });

  it('logs and continues when re-enqueueing throws', async () => {
    mockFindStranded.mockResolvedValueOnce([{
      id: 'w1', name: 'AMN-MS3',
      requestedFullResyncGeneration: 1, processedFullResyncGeneration: 0,
    }]);
    mockEnqueueFullResync.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(checkStaleWalletsJob.handler(staleJob('job-2'))).resolves.toBeDefined();
  });
});
