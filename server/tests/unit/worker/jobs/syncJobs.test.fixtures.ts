import type { Job } from 'bullmq';
import type { JobExecutionContext } from '../../../../src/jobs/types';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../../src/constants/walletSyncActivation';

export function canonicalIntentState(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'wallet-intent',
    requestedIncrementalSyncGeneration: 1,
    claimedIncrementalSyncGeneration: 1,
    processedIncrementalSyncGeneration: 0,
    incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
    incrementalSyncClaimedAt: new Date(),
    incrementalSyncLeaseExpiresAt: new Date(Date.now() + 60_000),
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncActionRequiredAt: null,
    requestedFullResyncGeneration: 0,
    preparedFullResyncGeneration: 0,
    processedFullResyncGeneration: 0,
    syncInProgress: true,
    lastSyncedAt: null,
    lastSyncedBlockHeight: null,
    lastSyncStatus: 'syncing',
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: 'worker',
    syncStartedAt: new Date(),
    syncStateVersion: 1,
    ...overrides,
  };
}

export function canonicalJob(attemptsMade = 0): Job {
  return {
    id: 'canonical-generation-1',
    data: {
      version: 3,
      walletId: 'wallet-intent',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    },
    attemptsMade,
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  } as unknown as Job;
}

export function acquiredExecution(
  walletId = 'wallet-intent',
): JobExecutionContext {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    throwIfAborted: () => controller.signal.throwIfAborted(),
    acquiredLock: { key: `sync:wallet:${walletId}`, token: 'a'.repeat(32) },
  };
}
