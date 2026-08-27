import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import { getConfig } from '../../config';
import {
  getSyncLockKey,
  SYNC_JOB_CONTRACT_VERSION,
  type SyncWalletJobDataV2,
  type SyncWalletJobDataV3,
  type SyncWalletJobData,
  type SyncWalletJobResult,
} from '../../jobs/syncJobContract';
import {
  assertChainReachable,
  getCachedBlockHeight,
  syncWallet,
} from '../../services/bitcoin/blockchain';
import { populateMissingTransactionFields } from '../../services/bitcoin/sync/confirmations';
import {
  createSyncStageRuntime,
  isSyncStageBudgetError,
} from '../../services/bitcoin/sync/attemptRuntime';
import { resolvePersistedBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';
import { classifyWalletSyncFailure } from '../../services/sync/failureClassification';
import {
  syncIntentAdmission,
  type ClaimFreshIncrementalSyncResult,
} from '../../services/sync/syncIntentAdmission';
import {
  runSyncAttemptWithTimeout,
  SYNC_ABORT_GRACE_MS,
  type PersistedSyncTransition,
} from '../../services/sync/syncAttemptLifecycle';
import { syncLifecyclePublisher } from '../../services/sync/syncLifecyclePublisher';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { JobExecutionContext } from './types';
import { resyncRepository } from '../../repositories';
import type { IncrementalSyncLifecycleState } from '../../repositories/types';
import { WalletSyncAttemptTelemetry } from '../walletSyncAttemptTelemetry';
import { createSyncPhaseProgress, type SyncPhaseProgress } from '../../services/bitcoin/sync/phaseProgress';

const log = createLogger('JOB:SYNC:INCREMENTAL');

export type CanonicalIncrementalSyncData =
  | Extract<SyncWalletJobDataV2, { incrementalSyncGeneration: number }>
  | SyncWalletJobDataV3;

interface CanonicalIncrementalSyncDependencies {
  isFinalAttempt: (job: Job<SyncWalletJobData>) => boolean;
  lockTtlMs: number;
  publishAttemptTransition: (
    job: Job<SyncWalletJobData>,
    transition: PersistedSyncTransition,
  ) => Promise<void>;
  retryState: (job: Job<SyncWalletJobData>) => { nextRetryAt: Date };
  enrollWalletSubscriptions: (
    walletId: string,
    network: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

class LostIncrementalSyncFenceError extends Error {
  constructor(walletId: string, generation: number) {
    super(`Incremental sync fence was lost for wallet ${walletId} generation ${generation}`);
    this.name = 'LostIncrementalSyncFenceError';
  }
}

async function assertFullResyncChainReachable(
  network: BitcoinNetwork,
  signal: AbortSignal,
  deadlineAt: number,
  phaseProgress: SyncPhaseProgress,
): Promise<void> {
  const stage = createSyncStageRuntime(
    { signal, deadlineAt, phaseProgress },
    'full_resync_initial_network',
  );
  try {
    await assertChainReachable(network, {
      signal: stage.signal,
      deadlineAt: stage.deadlineAt,
    });
  } catch (error) {
    if (
      isSyncStageBudgetError(error)
      || isSyncStageBudgetError(stage.signal.reason)
    ) {
      phaseProgress.budgetExpired('Full-resync network check exceeded its remote budget.');
    }
    throw error;
  } finally {
    stage.dispose();
  }
}

/**
 * A failure that no retry can repair, such as a persisted wallet network the
 * vocabulary does not recognise. The catch in `executeCanonicalIncrementalSync`
 * releases these straight to `action_required` regardless of attempt number, and
 * rethrows them as `UnrecoverableError` so BullMQ stops retrying. Releasing for
 * retry instead would let bounded recovery keep re-waking a wallet that can
 * never succeed, and it would never surface to an operator.
 */
class PermanentIncrementalSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentIncrementalSyncError';
  }
}

function incrementalTransition(
  walletId: string,
  transition: PersistedSyncTransition['transition'],
  state: PersistedSyncTransition['state'],
): PersistedSyncTransition {
  return { walletId, transition, state };
}

async function completeCanonicalSync(
  data: CanonicalIncrementalSyncData,
  fence: Readonly<{ walletId: string; generation: number; leaseToken: string }>,
  success: { syncedAt: Date; lastSyncedBlockHeight: number },
): Promise<IncrementalSyncLifecycleState | null> {
  if (data.fullResync === true) {
    const completion = await resyncRepository.completeFencedWalletFullResync(
      data.walletId,
      data.fullResyncGeneration,
      fence,
      success,
    );
    return completion.completionRecorded ? completion.syncState : null;
  }
  const completion = await syncIntentAdmission.complete(data.walletId, fence, success);
  return completion.status === 'applied' ? completion.state : null;
}

async function claimIncrementalExecution(
  data: CanonicalIncrementalSyncData,
  claimedAt: Date,
  leaseExpiresAt: Date,
): Promise<Exclude<
  ClaimFreshIncrementalSyncResult,
  { status: 'already_claimed' }
>> {
  const input = {
    leaseToken: randomUUID(),
    claimedAt,
    leaseExpiresAt,
    expectedRequestedGeneration: data.incrementalSyncGeneration,
    ...(data.fullResync === true
      ? { fullResyncGeneration: data.fullResyncGeneration }
      : {}),
  };
  const fresh = await syncIntentAdmission.claimFresh(data.walletId, input);
  if (fresh.status === 'blocked') return fresh;
  if (fresh.status !== 'already_claimed') return fresh;
  const reclaimed = await syncIntentAdmission.reclaimExpired(data.walletId, input);
  if (reclaimed.status === 'blocked') return reclaimed;
  if (reclaimed.status !== 'claimed') {
    throw new Error(
      `Incremental sync generation ${data.incrementalSyncGeneration} already has an active claim`,
    );
  }
  return reclaimed;
}

export async function executeCanonicalIncrementalSync(
  job: Job<SyncWalletJobData>,
  data: CanonicalIncrementalSyncData,
  execution: JobExecutionContext | undefined,
  walletNetwork: string,
  startTime: number,
  dependencies: CanonicalIncrementalSyncDependencies,
): Promise<SyncWalletJobResult> {
  const expectedLockKey = getSyncLockKey(data);
  if (execution?.acquiredLock?.key !== expectedLockKey) {
    throw new UnrecoverableError('Generation-bound wallet sync requires acquired lock proof');
  }

  const claimedAt = new Date();
  const claimResult = await claimIncrementalExecution(
    data,
    claimedAt,
    new Date(claimedAt.getTime() + dependencies.lockTtlMs),
  );
  if (claimResult.status === 'blocked') {
    // Durable intent remains authoritative and replacement-safe recovery will
    // wake it after activation returns. Neutral completion avoids consuming
    // BullMQ attempts for a rollout gate rather than an execution failure.
    log.info(`Deferring gated incremental wake-up for wallet ${data.walletId}`, {
      generation: data.incrementalSyncGeneration,
      jobId: job.id,
      activationStatus: claimResult.activation.status,
    });
    return {
      version: SYNC_JOB_CONTRACT_VERSION,
      success: true,
      duration: Date.now() - startTime,
    };
  }
  if (claimResult.status === 'not_claimed') {
    log.info(`Ignoring obsolete incremental wake-up for wallet ${data.walletId}`, {
      generation: data.incrementalSyncGeneration,
      jobId: job.id,
    });
    return {
      version: SYNC_JOB_CONTRACT_VERSION,
      success: true,
      duration: Date.now() - startTime,
    };
  }

  const fence = Object.freeze({
    walletId: data.walletId,
    generation: claimResult.claim.generation,
    leaseToken: claimResult.claim.leaseToken,
  });
  await syncLifecyclePublisher.publish(incrementalTransition(
    data.walletId,
    'started',
    claimResult.state,
  ));

  let attemptTelemetry: WalletSyncAttemptTelemetry | undefined;
  let phaseProgress: SyncPhaseProgress | undefined;
  let cancellationOutcome: 'timedOut' | 'aborted' | undefined;
  try {
    attemptTelemetry = new WalletSyncAttemptTelemetry({
      executionId: fence.leaseToken,
      ownedLock: {
        key: execution.acquiredLock.key,
        token: execution.acquiredLock.token,
      },
      mode: data.fullResync === true ? 'full_resync' : 'incremental',
      network: walletNetwork === 'testnet' ? 'testnet3' : walletNetwork,
    });
    phaseProgress = createSyncPhaseProgress(data.walletId, attemptTelemetry);
    phaseProgress.begin('preflight');

    // An unrecognised persisted network is a permanent property of the row:
    // retrying cannot repair it. Raise it as a typed permanent failure so the
    // catch below releases straight to action_required through the single
    // existing release callsite, rather than adding a second wallet-history
    // producer callsite to the frozen inventory.
    let resolvedNetwork: BitcoinNetwork;
    try {
      resolvedNetwork = resolvePersistedBitcoinNetwork(walletNetwork);
    } catch {
      throw new PermanentIncrementalSyncError(
        `Wallet ${data.walletId} has an unrecognised persisted network; refusing to route sync work`,
      );
    }

    const maxSyncDurationMs = getConfig().sync.maxSyncDurationMs;
    const result = await runSyncAttemptWithTimeout(
      async (signal, deadlineAt) => {
        if (data.fullResync === true) {
          phaseProgress?.begin('initial_network');
          await assertFullResyncChainReachable(
            resolvedNetwork,
            signal,
            deadlineAt,
            phaseProgress!,
          );
          signal.throwIfAborted();
          await resyncRepository.resetWalletForFullResync(
            data.walletId,
            data.fullResyncGeneration,
            fence,
          );
        }
        const syncResult = await syncWallet(
          data.walletId,
          0,
          signal,
          fence,
          deadlineAt,
          attemptTelemetry,
          phaseProgress,
        );
        phaseProgress?.begin('missing_field_repair');
        await populateMissingTransactionFields(
          data.walletId,
          signal,
          undefined,
          fence,
          false,
          deadlineAt,
          attemptTelemetry,
          phaseProgress,
        );
        phaseProgress?.begin('subscription_enrollment');
        await dependencies.enrollWalletSubscriptions(
          data.walletId,
          walletNetwork,
          signal,
        );
        return syncResult;
      },
      maxSyncDurationMs,
      SYNC_ABORT_GRACE_MS,
      execution.signal,
      {
        timeout: () => {
          cancellationOutcome = 'timedOut';
          attemptTelemetry?.recordAttemptTimeout();
        },
        aborted: () => {
          cancellationOutcome = 'aborted';
          attemptTelemetry?.recordAttemptAbort();
        },
        abortGraceExhausted: () => attemptTelemetry?.recordAbortGraceExhaustion(),
      },
    );
    phaseProgress.begin('finalization');
    execution.throwIfAborted();

    const network = resolvedNetwork;
    const syncedAt = new Date();
    const success = {
      syncedAt,
      lastSyncedBlockHeight: getCachedBlockHeight(network),
    };
    const completionState = await completeCanonicalSync(data, fence, success);
    if (!completionState) {
      throw new LostIncrementalSyncFenceError(data.walletId, fence.generation);
    }
    await syncLifecyclePublisher.publish(incrementalTransition(
      data.walletId,
      'succeeded',
      completionState,
    ));
    if (completionState.requestedIncrementalSyncGeneration
      > completionState.processedIncrementalSyncGeneration) {
      await syncIntentAdmission.wake(
        data.walletId,
        completionState.requestedIncrementalSyncGeneration,
      );
    }
    phaseProgress.finish();
    attemptTelemetry.finish('completed');

    return {
      version: SYNC_JOB_CONTRACT_VERSION,
      success: true,
      duration: Date.now() - startTime,
      transactionsFound: result.transactions,
      utxosUpdated: result.utxos,
    };
  } catch (error) {
    if (isSyncStageBudgetError(error)) {
      phaseProgress?.budgetExpired();
    } else {
      phaseProgress?.finish(
        cancellationOutcome === 'aborted' || cancellationOutcome === 'timedOut'
          ? 'stage_aborted'
          : 'stage_failed',
      );
    }
    attemptTelemetry?.finish(cancellationOutcome ?? 'failed');
    if (error instanceof LostIncrementalSyncFenceError) throw error;
    const releasedAt = new Date();
    const errorMessage = getErrorMessage(error, 'Unknown error');
    const failureClass = classifyWalletSyncFailure(errorMessage);
    const permanent = error instanceof PermanentIncrementalSyncError;
    const finalAttempt = permanent || dependencies.isFinalAttempt(job);
    const terminal = finalAttempt
      ? await syncIntentAdmission.releaseAsActionRequired(data.walletId, fence, {
        actionRequiredAt: releasedAt,
        errorMessage,
        failureClass,
      })
      : await syncIntentAdmission.releaseForRetry(data.walletId, fence, {
        releasedAt,
        nextRetryAt: dependencies.retryState(job).nextRetryAt,
        errorMessage,
        failureClass,
      });
    if (terminal.status === 'applied') {
      await dependencies.publishAttemptTransition(job, incrementalTransition(
        data.walletId,
        finalAttempt ? 'failed' : 'retrying',
        terminal.state,
      ));
    } else {
      log.warn(`Incremental sync failure lost its durable fence for wallet ${data.walletId}`, {
        generation: fence.generation,
        jobId: job.id,
      });
    }
    if (permanent) throw new UnrecoverableError(errorMessage);
    throw error;
  }
}
