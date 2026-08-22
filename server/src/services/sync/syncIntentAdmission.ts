import { toBullMqJobId } from '../../jobs/bullMqJobIds';
import {
  syncIntentRepository,
  type IncrementalSyncClaimInput,
  type IncrementalSyncRetryReleaseInput,
} from '../../repositories/syncIntentRepository';
import type {
  IncrementalSyncClaimResult,
  IncrementalSyncFence,
  IncrementalSyncIntentState,
  IncrementalSyncRequestMode,
  IncrementalSyncTerminalResult,
} from '../../repositories/types';

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
  | { status: 'generation_exhausted' | 'not_found' };

export interface IncrementalSyncRecoveryResult {
  scanned: number;
  enqueued: number;
  unavailable: number;
  nextCursor?: string;
}

type SyncIntentRepositoryPort = typeof syncIntentRepository;

export interface SyncIntentAdmissionDependencies {
  enqueueWakeup: EnqueueIncrementalSyncWakeup;
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

  async function request(
    walletId: string,
    options: RequestIncrementalSyncOptions = {},
  ): Promise<IncrementalSyncAdmissionResult> {
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
    const states = await repository.findActionableIncrementalSyncIntents(options);
    let enqueued = 0;
    for (const state of states) {
      const generation = state.requestedIncrementalSyncGeneration;
      const accepted = await enqueueSafely(dependencies.enqueueWakeup, {
        walletId: state.id,
        generation,
        jobId: incrementalSyncWakeupJobId(state.id, generation),
      });
      if (accepted) enqueued += 1;
    }
    return {
      scanned: states.length,
      enqueued,
      unavailable: states.length - enqueued,
      ...(states.length > 0 ? { nextCursor: states[states.length - 1].id } : {}),
    };
  }

  return {
    request,
    recover,
    claim: (
      walletId: string,
      input: IncrementalSyncClaimInput,
    ): Promise<IncrementalSyncClaimResult> => repository.claimIncrementalSync(walletId, input),
    complete: (
      walletId: string,
      fence: IncrementalSyncFence,
    ): Promise<IncrementalSyncTerminalResult> => repository.completeIncrementalSync(walletId, fence),
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
      actionRequiredAt: Date,
    ): Promise<IncrementalSyncTerminalResult> => (
      repository.releaseIncrementalSyncAsActionRequired(walletId, fence, actionRequiredAt)
    ),
  };
}

export type SyncIntentAdmission = ReturnType<typeof createSyncIntentAdmission>;
