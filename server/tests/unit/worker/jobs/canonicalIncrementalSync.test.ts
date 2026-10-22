/**
 * Canonical incremental sync: full-resync failure classification.
 *
 * An oversized or unreadable annotation snapshot rolls the full-resync reset
 * back. Retrying would refuse it again forever, so the attempt must release
 * straight to action_required and stop BullMQ retries. Also pins how the
 * sync outcome counters classify a failure after durable completion, and that
 * a confirmation the missing-field repair commits is published and queued as
 * a confirmation webhook.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { SyncWalletJobData } from '../../../../src/jobs/syncJobContract';
import { acquiredExecution, canonicalIntentState, canonicalJob } from './syncJobs.test.fixtures';
import { DEFAULT_EVENTS, acceptAllDeliveries, makeEndpoint, storedTx } from '../../services/webhooks/deliveryService.fixtures';

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
  populate: vi.fn(),
  emitTransactionConfirmed: vi.fn(),
  listEndpoints: vi.fn(),
  createDelivery: vi.fn(),
  findManyByTxids: vi.fn(),
  findWalletById: vi.fn(),
  queueWebhookDeliveryNotification: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/logger')>();
  return {
    ...actual,
    createLogger: (name: string) => ({ ...actual.createLogger(name), warn: mocks.warn }),
  };
});

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
  transactionRepository: { findManyByTxids: mocks.findManyByTxids },
  walletRepository: { findById: mocks.findWalletById },
  webhookRepository: { listEndpoints: mocks.listEndpoints, createDelivery: mocks.createDelivery },
}));
vi.mock('../../../../src/infrastructure', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/infrastructure')>(),
  queueWebhookDeliveryNotification: mocks.queueWebhookDeliveryNotification,
}));
vi.mock('../../../../src/services/eventService', () => ({
  eventService: { emitTransactionConfirmed: mocks.emitTransactionConfirmed },
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
  populateMissingTransactionFields: mocks.populate,
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
    mocks.populate.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
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

describe('executeCanonicalIncrementalSync confirmation publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimFresh.mockResolvedValue({
      status: 'claimed',
      claim: { generation: 1, leaseToken: 'incremental-token' },
      state: canonicalIntentState(),
    });
    mocks.complete.mockResolvedValue({
      status: 'applied',
      state: canonicalIntentState({ processedIncrementalSyncGeneration: 1 }),
    });
    mocks.syncWallet.mockResolvedValue({ transactions: 1, utxos: 0 });
    mocks.findWalletById.mockResolvedValue({ id: 'wallet-intent', name: 'Treasury', network: 'mainnet' });
    mocks.findManyByTxids.mockResolvedValue([storedTx(1, 'received', 'wallet-intent')]);
    mocks.listEndpoints.mockResolvedValue([makeEndpoint({ walletId: 'wallet-intent', eventTypes: DEFAULT_EVENTS })]);
    acceptAllDeliveries(mocks.createDelivery);
    mocks.queueWebhookDeliveryNotification.mockResolvedValue(true);
  });

  async function runRepairCommittingFirstConfirmation(): Promise<unknown> {
    const update = { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 };
    mocks.populate.mockImplementation(async (
      _walletId: string,
      _signal: AbortSignal,
      onCommit?: (commit: { updated: number; confirmationUpdates: typeof update[] }) => void,
    ) => {
      onCommit?.({ updated: 1, confirmationUpdates: [update] });
      return { updated: 1, confirmationUpdates: [update] };
    });
    const job = canonicalJob() as Job<SyncWalletJobData>;
    return executeCanonicalIncrementalSync(
      job,
      job.data as Parameters<typeof executeCanonicalIncrementalSync>[1],
      acquiredExecution(),
      'mainnet',
      Date.now(),
      {
        isFinalAttempt: () => false,
        lockTtlMs: 60_000,
        publishAttemptTransition: mocks.publish,
        retryState: () => ({ nextRetryAt: new Date(Date.now() + 5_000) }),
        enrollWalletSubscriptions: vi.fn().mockResolvedValue(undefined),
      },
    );
  }

  it('queues wallet.transaction.confirmed when the missing-field repair confirms a mempool transaction', async () => {
    await runRepairCommittingFirstConfirmation();

    await vi.waitFor(() => expect(mocks.createDelivery).toHaveBeenCalledTimes(1));
    expect(mocks.createDelivery).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'wallet.transaction.confirmed',
      eventId: 'wallet:wallet-intent:tx:tx-1:wallet.transaction.confirmed:v1',
    }));
    expect(mocks.emitTransactionConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-intent', txid: 'tx-1', confirmations: 1, previousConfirmations: 0,
    }));
  });

  it('logs, and does not fail the sync, when the confirmation event cannot be published', async () => {
    mocks.emitTransactionConfirmed.mockImplementationOnce(() => {
      throw new Error('broadcast unavailable');
    });

    await expect(runRepairCommittingFirstConfirmation()).resolves.toMatchObject({ success: true });

    expect(mocks.warn).toHaveBeenCalledWith('Confirmation events not published', {
      walletId: 'wallet-intent',
      txids: ['tx-1'],
    });
  });
});
