/**
 * Sync Jobs Tests
 *
 * Tests for the worker sync job handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { isSyncWalletJobLockData } from '../../../../src/jobs/syncJobContract';
import {
  acquiredExecution,
  canonicalIntentState,
  canonicalJob,
} from './syncJobs.test.fixtures';

const syncJobPrismaMocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
  walletFindMany: vi.fn<() => Promise<unknown[]>>(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
  publishLifecycle: vi.fn<(...args: unknown[]) => Promise<void>>(),
  broadcastWalletLog: vi.fn(),
}));
const syncIntentMocks = vi.hoisted(() => ({
  bridgeRetained: vi.fn(),
  claimFresh: vi.fn(),
  reclaimExpired: vi.fn(),
  complete: vi.fn(),
  releaseForRetry: vi.fn(),
  releaseAsActionRequired: vi.fn(),
  wake: vi.fn(),
  reset: vi.fn(),
}));
const mockEnrollWalletSubscriptions = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: syncJobPrismaMocks.publishLifecycle },
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastWalletLog: syncJobPrismaMocks.broadcastWalletLog,
}));

vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: syncIntentMocks,
}));

// The stale reaper probes each wallet's sync lock before force-clearing its
// flag, so the lock authority has to answer in unit tests.
const mockIsLocked = vi.hoisted(() => vi.fn<(key: string) => Promise<boolean>>());
const mockReadStaleWalletSchedulePolicy = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: mockReadStaleWalletSchedulePolicy,
}));

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
      findUnique: syncJobPrismaMocks.walletFindUnique,
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
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 0,
      lastSyncedAt: null,
      lastSyncStatus: 'resyncing',
      syncInProgress: true,
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
import {
  createSyncJobs,
  createSyncWalletJob,
  syncWalletJob as failClosedSyncWalletJob,
} from '../../../../src/worker/jobs/syncJobs';
import { resyncRepository } from '../../../../src/repositories';
import { WalletSyncAttemptTelemetry } from '../../../../src/worker/walletSyncAttemptTelemetry';
import { getConfig } from '../../../../src/config';

const syncWalletJob = createSyncWalletJob({
  enrollWalletSubscriptions: mockEnrollWalletSubscriptions,
});

function persistedSyncState(args?: unknown, stateVersion = 1): Record<string, unknown> {
  const data = (args as { data?: Record<string, unknown> } | undefined)?.data ?? {};
  return {
    id: 'wallet-1',
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
    ...data,
    syncStateVersion: stateVersion,
  };
}

describe('Sync Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncJobPrismaMocks.walletFindUnique.mockResolvedValue({ network: 'mainnet' });
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    let stateVersion = 0;
    syncJobPrismaMocks.walletUpdate.mockImplementation(async (args: unknown) => (
      persistedSyncState(args, ++stateVersion)
    ));
    vi.mocked(syncWallet).mockReset();
    vi.mocked(syncWallet).mockResolvedValue({ transactions: 0, utxos: 0 } as never);
    mockIsLocked.mockResolvedValue(false);
    syncIntentMocks.claimFresh.mockReset();
    syncIntentMocks.bridgeRetained.mockReset().mockResolvedValue({
      status: 'requested', generation: 1, wakeup: 'deferred_activation',
    });
    syncIntentMocks.reclaimExpired.mockReset();
    syncIntentMocks.complete.mockReset();
    syncIntentMocks.releaseForRetry.mockReset();
    syncIntentMocks.releaseAsActionRequired.mockReset();
    syncIntentMocks.wake.mockReset();
    syncIntentMocks.reset.mockReset().mockImplementation(async (walletId: string) => (
      prisma.wallet.update({
        where: { id: walletId },
        data: {
          syncInProgress: false,
          syncExecutionOwner: null,
          syncStartedAt: null,
        },
      })
    ));
    mockEnrollWalletSubscriptions.mockReset().mockResolvedValue(undefined);
  });

  it('builds the complete sync handler set from neutral dependencies', () => {
    const jobs = createSyncJobs({
      enrollWalletSubscriptions: mockEnrollWalletSubscriptions,
    });

    expect(jobs.map(({ name }) => name)).toEqual([
      'sync-wallet',
      'check-stale-wallets',
      'update-confirmations',
      'update-all-confirmations',
    ]);
  });

  describe('syncWalletJob', () => {
    it('should have correct configuration', () => {
      expect(syncWalletJob.name).toBe('sync-wallet');
      expect(syncWalletJob.queue).toBe('sync');
      expect(syncWalletJob.options?.attempts).toBe(3);
      expect(syncWalletJob.validateData).toBe(isSyncWalletJobLockData);
      expect(syncWalletJob.validateData?.({ walletId: '' })).toBe(false);
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

    it.each([
      {
        label: 'unversioned ordinary',
        data: { walletId: 'wallet-retained', reason: 'manual' },
        fullResync: false,
      },
      {
        label: 'v1 ordinary',
        data: { version: 1, walletId: 'wallet-retained', reason: 'stale' },
        fullResync: false,
      },
      {
        label: 'generationless v2 ordinary',
        data: {
          version: 2,
          walletId: 'wallet-retained',
          priority: 'high',
          reason: 'address_activity',
          lockContention: {
            firstLockContentionAt: 1_786_000_000_000,
            attemptEpoch: 0,
          },
        },
        fullResync: false,
      },
      {
        label: 'v1 full resync',
        data: {
          version: 1,
          walletId: 'wallet-retained',
          reason: 'manual',
          fullResync: true,
          fullResyncGeneration: 99,
        },
        fullResync: true,
      },
      {
        label: 'v1 full resync with deferred generation repair',
        data: {
          version: 1,
          walletId: 'wallet-retained',
          reason: 'manual',
          fullResync: true,
        },
        fullResync: true,
      },
    ])('bridges $label into durable fenced intent without legacy effects', async ({
      data,
      fullResync,
    }) => {
      const job = {
        id: 'retained-job',
        data,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).resolves.toEqual({
        version: 1,
        success: true,
        duration: 0,
      });

      expect(syncIntentMocks.bridgeRetained).toHaveBeenCalledTimes(1);
      expect(syncIntentMocks.bridgeRetained).toHaveBeenCalledWith('wallet-retained', {
        fullResync,
        reason: data.reason,
        ...(data.reason === 'stale' ? { retirementSensitive: true } : {}),
      });
      expect(syncIntentMocks.claimFresh).not.toHaveBeenCalled();
      expect(syncIntentMocks.reclaimExpired).not.toHaveBeenCalled();
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
      expect(syncIntentMocks.wake).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
      expect(assertChainReachable).not.toHaveBeenCalled();
      expect(populateMissingTransactionFields).not.toHaveBeenCalled();
      expect(prisma.wallet.update).not.toHaveBeenCalled();
      expect(prisma.address.updateMany).not.toHaveBeenCalled();
      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
      expect(syncJobPrismaMocks.publishLifecycle).not.toHaveBeenCalled();
      expect(syncJobPrismaMocks.broadcastWalletLog).not.toHaveBeenCalled();
      expect(job.data).toBe(data);
    });

    it.each([
      { status: 'requested', success: true, error: undefined },
      { status: 'merged', success: true, error: undefined },
      {
        status: 'not_found',
        success: false,
        error: 'Retained sync admission not_found',
      },
      {
        status: 'generation_exhausted',
        success: false,
        error: 'Retained sync admission generation_exhausted',
      },
    ] as const)('maps retained admission status $status to an exact worker result', async ({
      status,
      success,
      error,
    }) => {
      syncIntentMocks.bridgeRetained.mockResolvedValueOnce(
        success
          ? { status, generation: 1, wakeup: 'deferred_activation' }
          : { status },
      );

      await expect(syncWalletJob.handler({
        id: 'retained-result',
        data: { version: 1, walletId: 'wallet-retained', reason: 'manual' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job)).resolves.toEqual({
        version: 1,
        success,
        duration: 0,
        ...(error && { error }),
      });
    });

    it('lets a retained admission failure reject so BullMQ can retry it', async () => {
      syncIntentMocks.bridgeRetained.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(syncWalletJob.handler({
        id: 'retained-failure',
        data: { version: 1, walletId: 'wallet-retained', reason: 'manual' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job)).rejects.toThrow('database unavailable');
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('returns a neutral terminal result when a retained wallet no longer exists', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null);

      await expect(syncWalletJob.handler({
        id: 'retained-missing-wallet',
        data: { version: 1, walletId: 'wallet-missing', reason: 'manual' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job)).resolves.toEqual({
        version: 1,
        success: false,
        duration: 0,
        error: 'Wallet not found',
      });
      expect(syncIntentMocks.bridgeRetained).not.toHaveBeenCalled();
    });

    it('rejects a generation-bound wake-up without acquired wallet-lock proof', async () => {
      await expect(syncWalletJob.handler(canonicalJob())).rejects.toThrow(
        'Generation-bound wallet sync requires acquired lock proof',
      );

      expect(syncIntentMocks.claimFresh).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
    });

    // A persisted network the vocabulary does not recognise is a permanent
    // property of the row: retrying cannot repair it. Previously this value
    // resolved to 'mainnet', routing the wallet at the funds-bearing network's
    // tip. It must now fail closed, and must do so in a way that is BOTH
    // non-retryable and durably visible: release straight to action_required,
    // publish the terminal transition, and raise UnrecoverableError. Releasing
    // for retry instead would let bounded recovery re-wake a wallet that can
    // never succeed, and it would never surface to an operator.
    it('fails a wake-up closed when the persisted network is unrecognised', async () => {
      const beginStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'beginStage');
      const finishStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'finishStage');
      syncJobPrismaMocks.walletFindUnique.mockResolvedValue({ network: 'bogus-network' });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-1' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseAsActionRequired.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState(),
      });

      const rejection = await syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      ).then(() => null, (error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toMatch(/unrecognised persisted network/);
      // The classification is the point: BullMQ must not retry a permanently
      // invalid row. `jobFailureClassification` keys off Error.name.
      expect((rejection as Error).name).toBe('UnrecoverableError');

      // Terminal, not retryable — an operator must be able to see this wallet.
      expect(syncIntentMocks.releaseAsActionRequired).toHaveBeenCalledWith(
        'wallet-intent',
        expect.objectContaining({ generation: 1, leaseToken: 'lease-1' }),
        expect.objectContaining({ errorMessage: expect.stringMatching(/unrecognised persisted network/) }),
      );
      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'wallet-intent', transition: 'failed' }),
      );
      expect(syncWallet).not.toHaveBeenCalled();
      expect(beginStage).toHaveBeenCalledWith('preflight', expect.any(Number));
      expect(finishStage).toHaveBeenCalledWith('preflight', 'failed', expect.any(Number));
    });

    // Mirrors the generic catch's lost-fence branch: if the terminal release
    // cannot re-assert the fence there is nothing durable to announce, so warn
    // and still refuse to retry rather than publish a transition for a state we
    // no longer own.
    it('does not publish a terminal transition when the invalid-network release loses its fence', async () => {
      syncJobPrismaMocks.walletFindUnique.mockResolvedValue({ network: 'bogus-network' });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-1' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseAsActionRequired.mockResolvedValueOnce({ status: 'lost_fence' });

      const rejection = await syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      ).then(() => null, (error: unknown) => error);

      expect((rejection as Error).name).toBe('UnrecoverableError');
      // Only the 'started' transition — no terminal announcement for a fence we lost.
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledTimes(1);
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ transition: 'started' }),
      );
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('neutralizes an obsolete generation-bound wake-up without executing sync', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({ status: 'not_claimed' });

      await expect(syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      )).resolves.toMatchObject({ success: true });

      expect(syncIntentMocks.claimFresh).toHaveBeenCalledWith('wallet-intent', expect.objectContaining({
        expectedRequestedGeneration: 1,
      }));
      expect(syncWallet).not.toHaveBeenCalled();
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
    });

    it('rethrows a retry whose exact generation still has an active durable claim', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({ status: 'already_claimed' });
      syncIntentMocks.reclaimExpired.mockResolvedValueOnce({ status: 'not_claimed' });

      await expect(syncWalletJob.handler(
        canonicalJob(1),
        acquiredExecution(),
      )).rejects.toThrow('generation 1 already has an active claim');

      expect(syncWallet).not.toHaveBeenCalled();
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
    });

    it('rotates an expired exact claim only after the execution lock is acquired', async () => {
      const claimedState = canonicalIntentState();
      syncIntentMocks.claimFresh.mockResolvedValueOnce({ status: 'already_claimed' });
      syncIntentMocks.reclaimExpired.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'rotated-token' },
        state: claimedState,
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ processedIncrementalSyncGeneration: 1 }),
        trailingGenerationPending: false,
      });

      await expect(syncWalletJob.handler(canonicalJob(), acquiredExecution()))
        .resolves.toMatchObject({ success: true });

      expect(syncIntentMocks.reclaimExpired).toHaveBeenCalledWith(
        'wallet-intent',
        expect.objectContaining({
          expectedRequestedGeneration: 1,
          claimedAt: expect.any(Date),
          leaseExpiresAt: expect.any(Date),
          leaseToken: expect.any(String),
        }),
      );
      expect(syncWallet).toHaveBeenCalledWith(
        'wallet-intent',
        0,
        expect.any(AbortSignal),
        { walletId: 'wallet-intent', generation: 1, leaseToken: 'rotated-token' },
        expect.any(Number),
        expect.anything(),
        expect.anything(),
      );
    });

    it('neutral-completes when the fleet gate blocks expired reclaim', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({ status: 'already_claimed' });
      syncIntentMocks.reclaimExpired.mockResolvedValueOnce({
        status: 'blocked',
        activation: {
          status: 'fleet_blocked',
          requiredFloor: 1,
          reason: 'worker_below_floor',
        },
      });

      await expect(syncWalletJob.handler(canonicalJob(), acquiredExecution()))
        .resolves.toMatchObject({ success: true });
      expect(syncWallet).not.toHaveBeenCalled();
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
      expect(syncJobPrismaMocks.publishLifecycle).not.toHaveBeenCalled();
    });

    it('neutral-completes when the fleet gate blocks a fresh claim', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'blocked',
        activation: {
          status: 'fleet_blocked',
          requiredFloor: 1,
          reason: 'worker_below_floor',
        },
      });

      await expect(syncWalletJob.handler(canonicalJob(), acquiredExecution()))
        .resolves.toMatchObject({ success: true });
      expect(syncIntentMocks.reclaimExpired).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
      expect(syncJobPrismaMocks.publishLifecycle).not.toHaveBeenCalled();
    });

    it('claims, executes, and atomically completes the exact incremental generation', async () => {
      const claimedState = canonicalIntentState();
      const completedState = canonicalIntentState({
        processedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        syncInProgress: false,
        lastSyncStatus: 'success',
      });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: claimedState,
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: completedState,
        trailingGenerationPending: false,
      });
      vi.mocked(syncWallet).mockResolvedValueOnce({ transactions: 2, utxos: 3 } as never);

      await expect(syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      )).resolves.toMatchObject({
        success: true,
        transactionsFound: 2,
        utxosUpdated: 3,
      });

      expect(syncIntentMocks.complete).toHaveBeenCalledWith(
        'wallet-intent',
        { walletId: 'wallet-intent', generation: 1, leaseToken: 'lease-token' },
        expect.objectContaining({
          syncedAt: expect.any(Date),
          lastSyncedBlockHeight: 100000,
        }),
      );
      const forwardedFence = vi.mocked(syncWallet).mock.calls[0]?.[3];
      expect(forwardedFence).toEqual({
        walletId: 'wallet-intent',
        generation: 1,
        leaseToken: 'lease-token',
      });
      expect(Object.isFrozen(forwardedFence)).toBe(true);
      expect(vi.mocked(populateMissingTransactionFields).mock.calls[0]?.[3])
        .toBe(forwardedFence);
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ transition: 'started', state: claimedState }),
      );
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ transition: 'succeeded', state: completedState }),
      );
      expect(syncIntentMocks.wake).not.toHaveBeenCalled();
    });

    it('enrolls every wallet checkpoint after canonical mutations and before completion', async () => {
      const enrollWalletSubscriptions = vi.fn().mockResolvedValue(undefined);
      const handler = createSyncWalletJob({ enrollWalletSubscriptions });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ processedIncrementalSyncGeneration: 1 }),
        trailingGenerationPending: false,
      });

      await handler.handler(canonicalJob(), acquiredExecution());

      expect(enrollWalletSubscriptions).toHaveBeenCalledWith(
        'wallet-intent',
        'mainnet',
        expect.any(AbortSignal),
      );
      expect(vi.mocked(populateMissingTransactionFields))
        .toHaveBeenCalledBefore(enrollWalletSubscriptions);
      expect(enrollWalletSubscriptions).toHaveBeenCalledBefore(syncIntentMocks.complete);
    });

    it('registers canonical work at preflight and orders every outer phase', async () => {
      const beginStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'beginStage');
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-stage-order' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ processedIncrementalSyncGeneration: 1 }),
        trailingGenerationPending: false,
      });

      await syncWalletJob.handler(canonicalJob(), acquiredExecution());

      expect(beginStage.mock.calls.map(([stage]) => stage)).toEqual([
        'preflight',
        'missing_field_repair',
        'subscription_enrollment',
        'finalization',
      ]);
      expect(beginStage).toHaveBeenCalledBefore(vi.mocked(syncWallet));
    });

    it('accepts the supported legacy testnet alias before starting telemetry', async () => {
      syncJobPrismaMocks.walletFindUnique.mockResolvedValue({ network: 'testnet' });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-legacy-testnet' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ processedIncrementalSyncGeneration: 1 }),
        trailingGenerationPending: false,
      });

      await expect(syncWalletJob.handler(canonicalJob(), acquiredExecution()))
        .resolves.toMatchObject({ success: true });
      expect(syncWallet).toHaveBeenCalledOnce();
    });

    it('marks an early full-resync network failure after preflight registration', async () => {
      const beginStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'beginStage');
      const finishStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'finishStage');
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-network-failure' },
        state: canonicalIntentState({ requestedFullResyncGeneration: 4 }),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });
      vi.mocked(assertChainReachable).mockRejectedValueOnce(new Error('network unavailable'));
      const job = canonicalJob();
      job.data = { ...job.data, fullResync: true, fullResyncGeneration: 4 };

      await expect(syncWalletJob.handler(job, acquiredExecution()))
        .rejects.toThrow('network unavailable');

      expect(beginStage.mock.calls.map(([stage]) => stage)).toEqual([
        'preflight',
        'initial_network',
      ]);
      expect(finishStage).toHaveBeenLastCalledWith(
        'initial_network',
        'failed',
        expect.any(Number),
      );
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('bounds full-resync reachability with the remote-stage budget', async () => {
      vi.useFakeTimers();
      const finishStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'finishStage');
      vi.mocked(getConfig).mockReturnValueOnce({
        sync: {
          staleThresholdMs: 600_000,
          staleBatchSize: 75,
          maxConcurrentSyncs: 5,
          maxSyncDurationMs: 600_000,
          syncStaggerDelayMs: 2_000,
        },
        bitcoin: { network: 'mainnet' },
      } as ReturnType<typeof getConfig>);
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-network-budget' },
        state: canonicalIntentState({ requestedFullResyncGeneration: 4 }),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });
      vi.mocked(assertChainReachable).mockImplementationOnce(async (_network, options) => (
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) throw new Error('expected bounded request signal');
          signal.addEventListener(
            'abort',
            () => reject(signal.reason),
            { once: true },
          );
        })
      ));
      const job = canonicalJob();
      job.data = { ...job.data, fullResync: true, fullResyncGeneration: 4 };

      const rejection = syncWalletJob.handler(job, acquiredExecution()).catch(error => error);
      await vi.advanceTimersByTimeAsync(300_000);

      await expect(rejection).resolves.toMatchObject({
        name: 'SyncRemoteStageBudgetError',
      });
      expect(finishStage).toHaveBeenCalledWith(
        'initial_network',
        'budget_expired',
        expect.any(Number),
      );
      expect(syncWallet).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('fenced-releases the claim when checkpoint enrollment remains incomplete', async () => {
      const finishStage = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'finishStage');
      const enrollWalletSubscriptions = vi.fn()
        .mockRejectedValue(new Error('checkpoint enrollment incomplete'));
      const handler = createSyncWalletJob({ enrollWalletSubscriptions });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });

      await expect(handler.handler(canonicalJob(), acquiredExecution()))
        .rejects.toThrow('checkpoint enrollment incomplete');

      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledWith(
        'wallet-intent',
        { walletId: 'wallet-intent', generation: 1, leaseToken: 'lease-token' },
        expect.objectContaining({ errorMessage: 'checkpoint enrollment incomplete' }),
      );
      expect(finishStage.mock.calls.filter(
        ([stage, outcome]) => stage === 'subscription_enrollment' && outcome === 'failed',
      )).toHaveLength(1);
    });

    it('fails closed when the metadata-only export reaches canonical enrollment', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });

      await expect(failClosedSyncWalletJob.handler(canonicalJob(), acquiredExecution()))
        .rejects.toThrow('Subscription checkpoint runtime dependency is required');
      expect(syncIntentMocks.complete).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledOnce();
    });

    it('executes a v3 full resync through one immutable incremental mutation fence', async () => {
      const completedState = canonicalIntentState({
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 4,
        processedFullResyncGeneration: 4,
        processedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: null,
        syncInProgress: false,
        lastSyncStatus: 'success',
      });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'full-resync-token' },
        state: canonicalIntentState({ requestedFullResyncGeneration: 4 }),
      });
      const reset = vi.spyOn(resyncRepository, 'resetWalletForFullResync')
        .mockResolvedValueOnce({ deletedTransactions: 2, resetPerformed: true });
      const complete = vi.spyOn(resyncRepository, 'completeFencedWalletFullResync')
        .mockResolvedValueOnce({ completionRecorded: true, syncState: completedState as never });
      const job = canonicalJob();
      job.data = {
        ...job.data,
        fullResync: true,
        fullResyncGeneration: 4,
      };

      try {
        await expect(syncWalletJob.handler(job, acquiredExecution()))
          .resolves.toMatchObject({ success: true });

        expect(syncIntentMocks.claimFresh).toHaveBeenCalledWith(
          'wallet-intent',
          expect.objectContaining({
            expectedRequestedGeneration: 1,
            fullResyncGeneration: 4,
          }),
        );
        const fence = reset.mock.calls[0]?.[2];
        expect(fence).toEqual({
          walletId: 'wallet-intent',
          generation: 1,
          leaseToken: 'full-resync-token',
        });
        expect(Object.isFrozen(fence)).toBe(true);
        expect(assertChainReachable).toHaveBeenCalledBefore(reset);
        expect(syncWallet).toHaveBeenCalledWith(
          'wallet-intent', 0, expect.any(AbortSignal), fence, expect.any(Number),
          expect.anything(),
          expect.anything(),
        );
        expect(populateMissingTransactionFields).toHaveBeenCalledWith(
          'wallet-intent', expect.any(AbortSignal), undefined, fence, false,
          expect.any(Number), expect.anything(), expect.anything(),
        );
        expect(complete).toHaveBeenCalledWith(
          'wallet-intent',
          4,
          fence,
          expect.objectContaining({ syncedAt: expect.any(Date) }),
        );
        expect(syncIntentMocks.complete).not.toHaveBeenCalled();
        expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
          expect.objectContaining({ transition: 'succeeded', state: completedState }),
        );
      } finally {
        reset.mockRestore();
        complete.mockRestore();
      }
    });

    it('fails closed when fenced full-resync completion loses authority', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'full-resync-token' },
        state: canonicalIntentState({ requestedFullResyncGeneration: 4 }),
      });
      const reset = vi.spyOn(resyncRepository, 'resetWalletForFullResync')
        .mockResolvedValueOnce({ deletedTransactions: 0, resetPerformed: true });
      const complete = vi.spyOn(resyncRepository, 'completeFencedWalletFullResync')
        .mockResolvedValueOnce({ completionRecorded: false });
      const job = canonicalJob();
      job.data = { ...job.data, fullResync: true, fullResyncGeneration: 4 };

      try {
        await expect(syncWalletJob.handler(job, acquiredExecution()))
          .rejects.toThrow('Incremental sync fence was lost');
        expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
        expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
      } finally {
        reset.mockRestore();
        complete.mockRestore();
      }
    });

    it('best-effort wakes the exact trailing generation after durable completion', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState({ requestedIncrementalSyncGeneration: 2 }),
      });
      syncIntentMocks.complete.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({
          requestedIncrementalSyncGeneration: 2,
          processedIncrementalSyncGeneration: 1,
          incrementalSyncLeaseToken: null,
        }),
        trailingGenerationPending: true,
      });
      syncIntentMocks.wake.mockResolvedValueOnce(false);

      await expect(syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      )).resolves.toMatchObject({ success: true });

      expect(syncIntentMocks.wake).toHaveBeenCalledWith('wallet-intent', 2);
    });

    it.each([
      { attemptsMade: 0, transition: 'retrying', release: 'releaseForRetry' },
      { attemptsMade: 2, transition: 'failed', release: 'releaseAsActionRequired' },
    ] as const)(
      'fenced-releases a canonical failure as $transition',
      async ({ attemptsMade, transition, release }) => {
        syncIntentMocks.claimFresh.mockResolvedValueOnce({
          status: 'claimed',
          claim: { generation: 1, leaseToken: 'lease-token' },
          state: canonicalIntentState(),
        });
        syncIntentMocks[release].mockResolvedValueOnce({
          status: 'applied',
          state: canonicalIntentState({
            syncInProgress: false,
            lastSyncStatus: transition === 'failed' ? 'failed' : 'retrying',
          }),
        });
        vi.mocked(syncWallet).mockRejectedValueOnce(new Error('electrum unavailable'));

        await expect(syncWalletJob.handler(
          canonicalJob(attemptsMade),
          acquiredExecution(),
        )).rejects.toThrow('electrum unavailable');

        expect(syncIntentMocks[release]).toHaveBeenCalledWith(
          'wallet-intent',
          { walletId: 'wallet-intent', generation: 1, leaseToken: 'lease-token' },
          expect.objectContaining({
            errorMessage: 'electrum unavailable',
            failureClass: expect.any(String),
          }),
        );
        const publishedTransition = expect.objectContaining({ transition });
        if (transition === 'retrying') {
          expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
            publishedTransition,
            expect.anything(),
          );
        } else {
          expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
            publishedTransition,
          );
        }
      },
    );

    it('records the canonical timeout callback before releasing the fenced attempt', async () => {
      vi.useFakeTimers();
      const timeoutSpy = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'recordAttemptTimeout');
      const graceSpy = vi.spyOn(
        WalletSyncAttemptTelemetry.prototype,
        'recordAbortGraceExhaustion',
      );
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-timeout' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });
      vi.mocked(syncWallet).mockImplementationOnce(async () => (
        new Promise(() => undefined)
      ) as never);

      const pending = syncWalletJob.handler(canonicalJob(), acquiredExecution());
      const rejection = pending.catch(error => error);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150_000);

      await expect(rejection).resolves.toMatchObject({
        message: 'Sync attempt timed out after 120000ms',
      });
      expect(timeoutSpy).toHaveBeenCalledOnce();
      expect(graceSpy).toHaveBeenCalledOnce();
      expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledWith(
        'wallet-intent',
        expect.objectContaining({ leaseToken: 'lease-timeout' }),
        expect.objectContaining({ errorMessage: 'Sync attempt timed out after 120000ms' }),
      );
      vi.useRealTimers();
    });

    it('records canonical parent abort before releasing the fenced attempt', async () => {
      const abortSpy = vi.spyOn(WalletSyncAttemptTelemetry.prototype, 'recordAttemptAbort');
      const controller = new AbortController();
      const reason = new Error('worker shutting down');
      let notifyStarted!: () => void;
      const started = new Promise<void>(resolve => { notifyStarted = resolve; });
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-abort' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });
      vi.mocked(syncWallet).mockImplementationOnce(async (_walletId, _depth, signal) => {
        notifyStarted();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }) as never;
      });
      const execution = {
        signal: controller.signal,
        throwIfAborted: () => controller.signal.throwIfAborted(),
        acquiredLock: { key: 'sync:wallet:wallet-intent', token: 'a'.repeat(32) },
      };

      const pending = syncWalletJob.handler(canonicalJob(), execution);
      const rejection = pending.catch(error => error);
      await started;
      controller.abort(reason);

      await expect(rejection).resolves.toBe(reason);
      expect(abortSpy).toHaveBeenCalledOnce();
      expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledWith(
        'wallet-intent',
        expect.objectContaining({ leaseToken: 'lease-abort' }),
        expect.objectContaining({ errorMessage: 'worker shutting down' }),
      );
    });

    it('uses the canonical retry budget when BullMQ omits job attempt options', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.releaseForRetry.mockResolvedValueOnce({
        status: 'applied',
        state: canonicalIntentState({ syncInProgress: false, lastSyncStatus: 'retrying' }),
      });
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('temporary failure'));
      const job = canonicalJob(0);
      job.opts = {};

      await expect(syncWalletJob.handler(job, acquiredExecution()))
        .rejects.toThrow('temporary failure');

      expect(syncIntentMocks.releaseForRetry).toHaveBeenCalledOnce();
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenLastCalledWith(
        expect.objectContaining({ transition: 'retrying' }),
        { maxRetries: 2 },
      );
    });

    it('does not write retry or failure state after losing the completion fence', async () => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks.complete.mockResolvedValueOnce({ status: 'lost_fence' });

      await expect(syncWalletJob.handler(
        canonicalJob(),
        acquiredExecution(),
      )).rejects.toThrow('Incremental sync fence was lost');

      expect(syncIntentMocks.releaseForRetry).not.toHaveBeenCalled();
      expect(syncIntentMocks.releaseAsActionRequired).not.toHaveBeenCalled();
    });

    it.each([
      { attemptsMade: 0, release: 'releaseForRetry' },
      { attemptsMade: 2, release: 'releaseAsActionRequired' },
    ] as const)('does not publish a terminal transition after losing the $release fence', async ({
      attemptsMade,
      release,
    }) => {
      syncIntentMocks.claimFresh.mockResolvedValueOnce({
        status: 'claimed',
        claim: { generation: 1, leaseToken: 'lease-token' },
        state: canonicalIntentState(),
      });
      syncIntentMocks[release].mockResolvedValueOnce({ status: 'lost_fence' });
      vi.mocked(syncWallet).mockRejectedValueOnce(new Error('electrum unavailable'));

      await expect(syncWalletJob.handler(
        canonicalJob(attemptsMade),
        acquiredExecution(),
      )).rejects.toThrow('electrum unavailable');

      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledTimes(1);
      expect(syncJobPrismaMocks.publishLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ transition: 'started' }),
      );
    });

    it('rejects unknown wallet payload versions before repository effects', async () => {
      const job = {
        id: 'future-wallet-job',
        data: { version: 3, walletId: 'wallet-future' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow(
        'Unsupported sync-wallet job contract version',
      );
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('rejects an invalid v1 payload that still has a lock-safe wallet identity', async () => {
      const job = {
        id: 'invalid-wallet-job',
        data: { version: 1, walletId: 'wallet-invalid', reason: 42 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow(
        'Unsupported sync-wallet job contract version',
      );
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
    });

    it('rejects an unsupported full-resync contract even with a valid generation', async () => {
      const job = {
        id: 'unsupported-full-resync',
        data: {
          version: 3,
          walletId: 'wallet-invalid',
          fullResync: true,
          fullResyncGeneration: 1,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).rejects.toThrow(
        'Unsupported sync-wallet job contract version',
      );
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(syncIntentMocks.bridgeRetained).not.toHaveBeenCalled();
    });

    it('neutralizes retained stale-only work after durable retirement', async () => {
      mockReadStaleWalletSchedulePolicy.mockResolvedValue({
        mode: 'forbidden',
        tombstone: {
          version: 1,
          forbiddenAt: '2026-08-22T00:00:00.000Z',
          compatibilityFloor: 2,
        },
      });
      const job = {
        id: 'b64_c3luYzpzdGFsZTp3YWxsZXQtMTox',
        name: 'sync-wallet',
        data: { version: 1, walletId: 'wallet-1', reason: 'stale' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job;

      await expect(syncWalletJob.handler(job)).resolves.toEqual({
        version: 1,
        success: false,
        duration: 0,
        error: 'Stale-wallet scheduler work retired',
      });
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(syncWallet).not.toHaveBeenCalled();
    });

  });
});
