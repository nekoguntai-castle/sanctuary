import { toBullMqJobId } from '../../jobs/bullMqJobIds';
import { getSyncLockKey } from '../../jobs/syncJobContract';
import { isLocked } from '../../infrastructure/distributedLock';
import {
  enqueueIncrementalSyncWakeup,
} from '../workerSyncQueue';
import {
  syncIntentRepository,
  type ExpiredIncrementalSyncClaimCursor,
  type IncrementalSyncActionRequiredReleaseInput,
  type IncrementalSyncClaimInput,
  type IncrementalSyncRetryReleaseInput,
  type IncrementalSyncSuccessInput,
} from '../../repositories/syncIntentRepository';
import type {
  IncrementalSyncClaimResult,
  IncrementalSyncFence,
  IncrementalSyncIntentState,
  IncrementalSyncRequestMode,
  IncrementalSyncTerminalResult,
} from '../../repositories/types';
import {
  walletSyncActivationGate,
  type WalletSyncActivationState,
} from './walletSyncActivationGate';

export interface IncrementalSyncWakeup {
  walletId: string;
  generation: number;
  jobId: string;
}

export type EnqueueIncrementalSyncWakeup = (
  wakeup: IncrementalSyncWakeup,
) => Promise<boolean>;

export type IncrementalSyncWakeupDisposition =
  | 'deferred_action_required'
  | 'deferred_full_resync'
  | 'deferred_retry'
  | 'enqueued'
  | 'unavailable';

export type IncrementalSyncAdmissionResult =
  | {
    status: 'requested' | 'merged';
    generation: number;
    wakeup: IncrementalSyncWakeupDisposition;
  }
  | { status: 'generation_exhausted' | 'not_found' }
  | { status: 'blocked'; activation: WalletSyncActivationState };

export interface IncrementalSyncRecoveryResult {
  scanned: number;
  enqueued: number;
  unavailable: number;
  nextCursor?: string;
  activation?: WalletSyncActivationState;
}

export interface ExpiredIncrementalSyncRecoveryResult {
  scanned: number;
  enqueued: number;
  locked: number;
  unavailable: number;
  nextCursor?: ExpiredIncrementalSyncClaimCursor;
  activation?: WalletSyncActivationState;
}

type SyncIntentRepositoryPort = typeof syncIntentRepository;

export interface SyncIntentAdmissionDependencies {
  enqueueWakeup: EnqueueIncrementalSyncWakeup;
  inspectActivation: () => Promise<WalletSyncActivationState>;
  isExecutionLockHeld: (walletId: string) => Promise<boolean>;
  repository?: SyncIntentRepositoryPort;
}

export interface RequestIncrementalSyncOptions {
  mode?: IncrementalSyncRequestMode;
  now?: Date;
}

export interface RecoverIncrementalSyncOptions {
  now: Date;
  cursor?: string;
  limit?: number;
}

export interface RecoverExpiredIncrementalSyncOptions {
  now: Date;
  cursor?: ExpiredIncrementalSyncClaimCursor;
  limit?: number;
}

export type ReclaimExpiredIncrementalSyncInput = Omit<
  IncrementalSyncClaimInput,
  'expectedExpiredFence'
>;

export type ReclaimExpiredIncrementalSyncResult =
  | IncrementalSyncClaimResult
  | { status: 'blocked'; activation: WalletSyncActivationState };

export type ClaimFreshIncrementalSyncResult = ReclaimExpiredIncrementalSyncResult;

export function incrementalSyncWakeupJobId(walletId: string, generation: number): string {
  return toBullMqJobId(`sync:intent:${walletId}:${generation}`);
}

async function enqueueSafely(
  enqueueWakeup: EnqueueIncrementalSyncWakeup,
  wakeup: IncrementalSyncWakeup,
): Promise<boolean> {
  try {
    return await enqueueWakeup(wakeup);
  } catch {
    return false;
  }
}

function deferredWakeup(
  state: IncrementalSyncIntentState,
  now: Date,
): IncrementalSyncWakeupDisposition | null {
  if (state.requestedFullResyncGeneration > state.processedFullResyncGeneration) {
    return 'deferred_full_resync';
  }
  if (state.syncActionRequiredAt !== null) return 'deferred_action_required';
  if (state.syncNextRetryAt !== null && state.syncNextRetryAt > now) {
    return 'deferred_retry';
  }
  return null;
}

export function createSyncIntentAdmission(
  dependencies: SyncIntentAdmissionDependencies,
) {
  const repository = dependencies.repository ?? syncIntentRepository;

  async function requireActive(): Promise<WalletSyncActivationState | null> {
    const activation = await dependencies.inspectActivation();
    return activation.status === 'active' ? null : activation;
  }

  async function request(
    walletId: string,
    options: RequestIncrementalSyncOptions = {},
  ): Promise<IncrementalSyncAdmissionResult> {
    const blocked = await requireActive();
    if (blocked) return { status: 'blocked', activation: blocked };
    const result = await repository.requestIncrementalSync(
      walletId,
      options.mode ?? 'automatic',
    );
    if (!('state' in result)) {
      return result;
    }

    const generation = result.state.requestedIncrementalSyncGeneration;
    const deferred = deferredWakeup(result.state, options.now ?? new Date());
    if (deferred) return { status: result.status, generation, wakeup: deferred };

    if (await requireActive()) {
      return { status: result.status, generation, wakeup: 'unavailable' };
    }

    const enqueued = await enqueueSafely(dependencies.enqueueWakeup, {
      walletId,
      generation,
      jobId: incrementalSyncWakeupJobId(walletId, generation),
    });
    return {
      status: result.status,
      generation,
      wakeup: enqueued ? 'enqueued' : 'unavailable',
    };
  }

  async function recover(
    options: RecoverIncrementalSyncOptions,
  ): Promise<IncrementalSyncRecoveryResult> {
    const blocked = await requireActive();
    if (blocked) {
      return { scanned: 0, enqueued: 0, unavailable: 0, activation: blocked };
    }
    const states = await repository.findActionableIncrementalSyncIntents(options);
    let enqueued = 0;
    let scanned = 0;
    let unavailable = 0;
    let nextCursor: string | undefined;
    let blockedActivation: WalletSyncActivationState | undefined;
    // Deliberately re-inspect per wake-up: a pass-level snapshot cannot
    // authorize later queue mutations after a rolling-fleet change. The
    // repository page limit bounds these sequential read-only checks.
    for (const state of states) {
      const activation = await requireActive();
      if (activation) {
        unavailable += 1;
        blockedActivation = activation;
        break;
      }
      const generation = state.requestedIncrementalSyncGeneration;
      const accepted = await enqueueSafely(dependencies.enqueueWakeup, {
        walletId: state.id,
        generation,
        jobId: incrementalSyncWakeupJobId(state.id, generation),
      });
      if (accepted) enqueued += 1;
      else unavailable += 1;
      scanned += 1;
      nextCursor = state.id;
    }
    return {
      scanned,
      enqueued,
      unavailable,
      ...(nextCursor ? { nextCursor } : {}),
      ...(blockedActivation ? { activation: blockedActivation } : {}),
    };
  }

  async function wake(walletId: string, generation: number): Promise<boolean> {
    if (await requireActive()) return false;
    return enqueueSafely(dependencies.enqueueWakeup, {
      walletId,
      generation,
      jobId: incrementalSyncWakeupJobId(walletId, generation),
    });
  }

  async function recoverExpired(
    options: RecoverExpiredIncrementalSyncOptions,
  ): Promise<ExpiredIncrementalSyncRecoveryResult> {
    const blocked = await requireActive();
    if (blocked) {
      return {
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
        activation: blocked,
      };
    }
    const claims = await repository.findExpiredIncrementalSyncClaims(options);
    let enqueued = 0;
    let locked = 0;
    let unavailable = 0;
    let scanned = 0;
    let lastProcessed: typeof claims[number] | undefined;
    let blockedActivation: WalletSyncActivationState | undefined;
    // Check both before the Redis probe and immediately before enqueue. This
    // avoids unnecessary lock traffic while blocked and closes a gate flip
    // during the probe; the bounded page caps the additional read-only I/O.
    for (const claim of claims) {
      const activation = await requireActive();
      if (activation) {
        unavailable += 1;
        blockedActivation = activation;
        break;
      }
      try {
        if (await dependencies.isExecutionLockHeld(claim.walletId)) {
          locked += 1;
        } else {
          const afterLockActivation = await requireActive();
          if (afterLockActivation) {
            unavailable += 1;
            blockedActivation = afterLockActivation;
            break;
          }
          const accepted = await enqueueSafely(dependencies.enqueueWakeup, {
            walletId: claim.walletId,
            generation: claim.generation,
            jobId: incrementalSyncWakeupJobId(claim.walletId, claim.generation),
          });
          if (accepted) enqueued += 1;
          else unavailable += 1;
        }
      } catch {
        unavailable += 1;
      }
      scanned += 1;
      lastProcessed = claim;
    }
    return {
      scanned,
      enqueued,
      locked,
      unavailable,
      ...(lastProcessed ? {
        nextCursor: {
          leaseExpiresAt: lastProcessed.leaseExpiresAt,
          walletId: lastProcessed.walletId,
        },
      } : {}),
      ...(blockedActivation ? { activation: blockedActivation } : {}),
    };
  }

  async function reclaimExpired(
    walletId: string,
    input: ReclaimExpiredIncrementalSyncInput,
  ): Promise<ReclaimExpiredIncrementalSyncResult> {
    const blocked = await requireActive();
    if (blocked) return { status: 'blocked', activation: blocked };
    const state = await repository.findIncrementalSyncIntent(walletId);
    if (
      state === null
      || state.claimedIncrementalSyncGeneration !== input.expectedRequestedGeneration
      || state.claimedIncrementalSyncGeneration <= state.processedIncrementalSyncGeneration
      || state.incrementalSyncLeaseToken === null
      || state.incrementalSyncLeaseExpiresAt === null
      || state.incrementalSyncLeaseExpiresAt > input.claimedAt
    ) {
      return { status: 'not_claimed' };
    }
    const activation = await requireActive();
    if (activation) return { status: 'blocked', activation };
    // The read is advisory only. claimIncrementalSync atomically compares the
    // exact observed generation/token/expiry before rotating the token, so a
    // concurrent completion or takeover returns not_claimed without mutation.
    return repository.claimIncrementalSync(walletId, {
      ...input,
      expectedExpiredFence: Object.freeze({
        walletId,
        generation: state.claimedIncrementalSyncGeneration,
        leaseToken: state.incrementalSyncLeaseToken,
      }),
    });
  }

  async function claimFresh(
    walletId: string,
    input: Omit<IncrementalSyncClaimInput, 'expectedExpiredFence'>,
  ): Promise<ClaimFreshIncrementalSyncResult> {
    const blocked = await requireActive();
    if (blocked) return { status: 'blocked', activation: blocked };
    return repository.claimIncrementalSync(walletId, input);
  }

  return {
    request,
    recover,
    recoverExpired,
    wake,
    claimFresh,
    reclaimExpired,
    complete: (
      walletId: string,
      fence: IncrementalSyncFence,
      success: IncrementalSyncSuccessInput,
    ): Promise<IncrementalSyncTerminalResult> => (
      repository.completeIncrementalSync(walletId, fence, success)
    ),
    releaseForRetry: (
      walletId: string,
      fence: IncrementalSyncFence,
      input: IncrementalSyncRetryReleaseInput,
    ): Promise<IncrementalSyncTerminalResult> => (
      repository.releaseIncrementalSyncForRetry(walletId, fence, input)
    ),
    releaseAsActionRequired: (
      walletId: string,
      fence: IncrementalSyncFence,
      input: IncrementalSyncActionRequiredReleaseInput,
    ): Promise<IncrementalSyncTerminalResult> => (
      repository.releaseIncrementalSyncAsActionRequired(walletId, fence, input)
    ),
  };
}

export type SyncIntentAdmission = ReturnType<typeof createSyncIntentAdmission>;

/** Canonical gate-enforced adapter; trigger producers remain disabled in this phase. */
export const syncIntentAdmission = createSyncIntentAdmission({
  enqueueWakeup: enqueueIncrementalSyncWakeup,
  inspectActivation: () => walletSyncActivationGate.inspect(),
  isExecutionLockHeld: (walletId) => isLocked(getSyncLockKey({ walletId })),
});
