/**
 * Canonical incremental sync: full-resync failure classification.
 *
 * An oversized or unreadable annotation snapshot rolls the full-resync reset
 * back. Retrying would refuse it again forever, so the attempt must release
 * straight to action_required and stop BullMQ retries. Also pins how the
 * sync outcome counters classify a failure after durable completion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { SyncWalletJobData } from '../../../../src/jobs/syncJobContract';
import { acquiredExecution, canonicalIntentState, canonicalJob } from './syncJobs.test.fixtures';

const mocks = vi.hoisted(() => ({
  claimFresh: vi.fn(),
  reclaimExpired: vi.fn(),
  complete: vi.fn(),
  releaseForRetry: vi.fn(),
  releaseAsActionRequired: vi.fn(),
  wake: vi.fn(),
  publish: vi.fn(),
  resetWalletForFullResync: vi.fn(),
  completeFencedWalletFullResync: vi.fn(),
  syncWallet: vi.fn(),
}));

vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: {
    claimFresh: mocks.claimFresh,
    reclaimExpired: mocks.reclaimExpired,
    complete: mocks.complete,
    releaseForRetry: mocks.releaseForRetry,
    releaseAsActionRequired: mocks.releaseAsActionRequired,
    wake: mocks.wake,
  },
}));
vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: mocks.publish },
}));
vi.mock('../../../../src/repositories', () => ({
  resyncRepository: {
    resetWalletForFullResync: mocks.resetWalletForFullResync,
    completeFencedWalletFullResync: mocks.completeFencedWalletFullResync,
  },
}));
vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ sync: { maxSyncDurationMs: 120_000 } }),
}));
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  assertChainReachable: vi.fn().mockResolvedValue(100_000),
  getCachedBlockHeight: vi.fn().mockReturnValue(100_000),
  syncWallet: mocks.syncWallet,
}));
vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/services/bitcoin/sync/phaseProgress', () => ({
  createSyncPhaseProgress: () => ({
    begin: vi.fn(),
    finish: vi.fn(),
    budgetExpired: vi.fn(),
  }),
}));

import { executeCanonicalIncrementalSync } from '../../../../src/worker/jobs/canonicalIncrementalSync';
import { ResyncAnnotationSnapshotError } from '../../../../src/repositories/resyncAnnotationSnapshot';
import {
  walletSyncDuration,
  walletSyncsTotal,
} from '../../../../src/observability/metrics/businessMetrics';
import { registry } from '../../../../src/observability/metrics/registry';

function fullResyncJob(): Job<SyncWalletJobData> {
  const job = canonicalJob() as Job<SyncWalletJobData>;
  job.data = { ...job.data, fullResync: true, fullResyncGeneration: 4 } as SyncWalletJobData;
  return job;
}

async function runFullResync(isFinalAttempt = false): Promise<unknown> {
  const job = fullResyncJob();
  return executeCanonicalIncrementalSync(
    job,
    job.data as Parameters<typeof executeCanonicalIncrementalSync>[1],
    acquiredExecution(),
    'mainnet',
    Date.now(),
    {
      isFinalAttempt: () => isFinalAttempt,
      lockTtlMs: 60_000,
      publishAttemptTransition: mocks.publish,
      retryState: () => ({ nextRetryAt: new Date(Date.now() + 5_000) }),
      enrollWalletSubscriptions: vi.fn().mockResolvedValue(undefined),
    },
  ).then(() => null, (error: unknown) => error);
}

describe('executeCanonicalIncrementalSync full-resync failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimFresh.mockResolvedValue({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'full-resync-token' },
      state: canonicalIntentState({ requestedFullResyncGeneration: 4 }),
    });
    mocks.releaseAsActionRequired.mockResolvedValue({
      status: 'applied',
      state: canonicalIntentState({ syncActionRequiredAt: new Date() }),
    });
    mocks.releaseForRetry.mockResolvedValue({
      status: 'applied',
      state: canonicalIntentState({ lastSyncStatus: 'retrying' }),
    });
  });

  it('releases a snapshot overflow straight to action_required without retrying', async () => {
    mocks.resetWalletForFullResync.mockRejectedValueOnce(new ResyncAnnotationSnapshotError(
      'Wallet wallet-intent has 50001 annotated transactions; export or clean up transaction labels and memos first',
    ));

    const rejection = await runFullResync();

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe('UnrecoverableError');
    expect((rejection as Error).message).toMatch(/export or clean up transaction labels and memos/);
    expect(mocks.releaseAsActionRequired).toHaveBeenCalledWith(
      'wallet-intent',
      { walletId: 'wallet-intent', generation: 1, leaseToken: 'full-resync-token' },
      expect.objectContaining({ errorMessage: expect.stringMatching(/annotated transactions/) }),
    );
    expect(mocks.releaseForRetry).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ walletId: 'wallet-intent', transition: 'failed' }),
    );
    expect(mocks.syncWallet).not.toHaveBeenCalled();
  });

  it.each([
    ['an Error', new Error('database unavailable')],
    ['a non-Error value', 'database unavailable'],
  ])('keeps an ordinary reset failure (%s) retryable', async (_case, failure) => {
    mocks.resetWalletForFullResync.mockRejectedValueOnce(failure);

    const rejection = await runFullResync();

    expect(rejection).toBe(failure);
    expect(mocks.releaseForRetry).toHaveBeenCalledWith(
      'wallet-intent',
      expect.anything(),
      expect.objectContaining({ errorMessage: 'database unavailable' }),
    );
    expect(mocks.releaseAsActionRequired).not.toHaveBeenCalled();
    expect(mocks.syncWallet).not.toHaveBeenCalled();
  });
  // Documents current behaviour (P3 follow-up, not changed here): completion is
  // durable before the 'succeeded' publish and the trailing wake, so a throw
  // there counts a durably completed sync as one failure, never also success.
  it('counts one failure when publishing after durable completion throws', async () => {
    walletSyncsTotal.reset();
    walletSyncDuration.reset();
    mocks.resetWalletForFullResync.mockResolvedValueOnce({
      deletedTransactions: 0,
      resetPerformed: true,
    });
    mocks.syncWallet.mockResolvedValueOnce({ transactions: 0, utxos: 0 });
    mocks.completeFencedWalletFullResync.mockResolvedValueOnce({
      completionRecorded: true,
      syncState: canonicalIntentState({ processedFullResyncGeneration: 4 }),
    });
    mocks.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('publish failed'));
    mocks.releaseForRetry.mockResolvedValueOnce({ status: 'lost_fence' });

    const rejection = await runFullResync();

    expect((rejection as Error).message).toBe('publish failed');
    expect(mocks.completeFencedWalletFullResync).toHaveBeenCalledOnce();
    const counters = await registry.getSingleMetricAsString('sanctuary_wallet_syncs_total');
    expect(counters).toContain('sanctuary_wallet_syncs_total{status="failure"} 1');
    expect(counters).not.toContain('status="success"');
  });
});
