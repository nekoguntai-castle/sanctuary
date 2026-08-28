import {
  isNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';
import {
  completeSubscriptionEnrollment,
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpointOwners,
  requestSubscriptionEnrollment,
} from '../repositories/subscriptionCheckpointRepository';
import { recordSubscriptionComparisonFailure } from '../repositories/subscriptionCoverageRepository';
import type {
  SubscriptionCheckpointOwner,
  SubscriptionCheckpointSyncIntent,
  SubscriptionEnrollmentCompletionResult,
  SubscriptionEnrollmentRequestResult,
} from '../repositories/types';
import {
  createSubscriptionCheckpointEnrollment,
  type SubscriptionBatchPort,
  type SubscriptionCheckpointEnrollmentRepositoryPort,
  type SubscriptionCheckpointEnrollmentResult,
} from '../services/sync/subscriptionCheckpointEnrollment';
import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';
import {
  syncLifecyclePublisher,
  type SyncLifecyclePublisher,
} from '../services/sync/syncLifecyclePublisher';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';

const MAX_RUNTIME_PAGE_SIZE = 200;
const ELECTRUM_STATUS_PATTERN = /^[0-9a-f]{64}$/;
const log = createLogger('WORKER:SUBSCRIPTION_CHECKPOINT_RUNTIME');

interface RuntimeRepositoryPort extends SubscriptionCheckpointEnrollmentRepositoryPort {
  findSubscriptionCheckpointOwners(
    network: NetworkType,
    scriptHash: string,
    options: { cursor?: string; limit?: number },
  ): Promise<SubscriptionCheckpointOwner[]>;
  requestSubscriptionEnrollment(
    addressId: string,
    network: NetworkType,
  ): Promise<SubscriptionEnrollmentRequestResult>;
}

export interface SubscriptionCheckpointRuntimeDependencies {
  repository: RuntimeRepositoryPort;
  subscribeBatch: SubscriptionBatchPort;
  releaseBatch?: (statuses: Map<string, string | null>) => void;
  serializePersistence?: <T>(operation: () => Promise<T>) => Promise<T>;
  publishTransition: SyncLifecyclePublisher['publish'];
  wake(walletId: string, generation: number): Promise<boolean>;
  now?: () => Date;
  isActive?: () => boolean;
}

export interface SubscriptionIntentDispatchResult {
  intents: number;
  published: number;
  publicationFailed: number;
  woken: number;
  wakeUnavailable: number;
}

export interface SubscriptionCheckpointEnrollmentPageResult
  extends SubscriptionCheckpointEnrollmentResult {
  dispatch: SubscriptionIntentDispatchResult;
}

export interface RecordSubscriptionStatusPageInput {
  network: NetworkType;
  scriptHash: string;
  observedStatus: string | null;
  cursor?: string;
  limit?: number;
}

export interface RecordSubscriptionStatusPageResult {
  scanned: number;
  completed: number;
  unavailable: number;
  syncIntents: SubscriptionCheckpointSyncIntent[];
  dispatch: SubscriptionIntentDispatchResult;
  nextCursor?: string;
}

function runtimeLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_RUNTIME_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Subscription checkpoint runtime limit must be a positive integer');
  }
  return Math.min(limit, MAX_RUNTIME_PAGE_SIZE);
}

function requireObservation(input: RecordSubscriptionStatusPageInput): void {
  if (!isNetworkType(input.network)) {
    throw new Error('Subscription checkpoint runtime network is invalid');
  }
  if (!ELECTRUM_STATUS_PATTERN.test(input.scriptHash)) {
    throw new Error('Subscription checkpoint runtime script hash is invalid');
  }
  if (input.observedStatus !== null
    && !ELECTRUM_STATUS_PATTERN.test(input.observedStatus)) {
    throw new Error('Subscription checkpoint runtime status is invalid');
  }
}

function observationTime(now: () => Date): Date {
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new Error('Subscription checkpoint runtime clock must return a valid date');
  }
  return observedAt;
}

function emptyDispatch(intents: number): SubscriptionIntentDispatchResult {
  return {
    intents,
    published: 0,
    publicationFailed: 0,
    woken: 0,
    wakeUnavailable: 0,
  };
}

async function dispatchIntents(
  dependencies: SubscriptionCheckpointRuntimeDependencies,
  intents: SubscriptionCheckpointSyncIntent[],
): Promise<SubscriptionIntentDispatchResult> {
  const result = emptyDispatch(intents.length);
  for (const intent of intents) {
    try {
      await dependencies.publishTransition({
        walletId: intent.walletId,
        transition: 'requested',
        state: intent.state,
      });
      result.published += 1;
    } catch {
      result.publicationFailed += 1;
    }

    try {
      if (await dependencies.wake(intent.walletId, intent.generation)) {
        result.woken += 1;
      } else {
        result.wakeUnavailable += 1;
      }
    } catch {
      result.wakeUnavailable += 1;
    }
  }
  return result;
}

function addIntent(
  intents: Map<string, SubscriptionCheckpointSyncIntent>,
  completion: SubscriptionEnrollmentCompletionResult,
): void {
  if (completion.status !== 'applied' || !completion.syncIntent) return;
  const intent = completion.syncIntent;
  intents.set(`${intent.walletId}:${intent.generation}`, intent);
}

export function createSubscriptionCheckpointRuntime(
  dependencies: SubscriptionCheckpointRuntimeDependencies,
) {
  let enrollmentAdmissionTail: Promise<void> = Promise.resolve();
  const enrollment = createSubscriptionCheckpointEnrollment({
    repository: dependencies.repository,
    subscribeBatch: dependencies.subscribeBatch,
    ...(dependencies.releaseBatch ? { releaseBatch: dependencies.releaseBatch } : {}),
    ...(dependencies.serializePersistence
      ? { serializePersistence: dependencies.serializePersistence }
      : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.isActive ? { isActive: dependencies.isActive } : {}),
  });

  async function enrollPendingPage(options: {
    network: NetworkType;
    walletId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SubscriptionCheckpointEnrollmentPageResult> {
    const previousAdmission = enrollmentAdmissionTail;
    let releaseAdmission!: () => void;
    enrollmentAdmissionTail = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    await previousAdmission;
    let page: SubscriptionCheckpointEnrollmentResult;
    try {
      page = await enrollment.enrollPage({
        network: options.network,
        ...(options.walletId !== undefined ? { walletId: options.walletId } : {}),
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        limit: runtimeLimit(options.limit),
      });
    } finally {
      releaseAdmission();
    }
    return {
      ...page,
      dispatch: await dispatchIntents(dependencies, page.syncIntents),
    };
  }

  async function hasPendingWalletEnrollment(options: {
    network: NetworkType;
    walletId: string;
  }): Promise<boolean> {
    if (!isNetworkType(options.network)) {
      throw new Error('Subscription checkpoint runtime network is invalid');
    }
    const pending = await dependencies.repository.findPendingSubscriptionEnrollments({
      network: options.network,
      walletId: options.walletId,
      limit: 1,
    });
    return pending.length > 0;
  }

  async function completeOwner(
    owner: SubscriptionCheckpointOwner,
    input: RecordSubscriptionStatusPageInput,
    observedAt: Date,
  ): Promise<SubscriptionEnrollmentCompletionResult> {
    const request = await dependencies.repository.requestSubscriptionEnrollment(
      owner.addressId,
      input.network,
    );
    if (!('state' in request)) return { status: request.status };
    const generation = request.state.requestedEnrollmentGeneration;
    try {
      return await dependencies.repository.completeSubscriptionEnrollment({
        addressId: owner.addressId,
        address: owner.address,
        network: input.network,
        generation,
        scriptHash: input.scriptHash,
        observedStatus: input.observedStatus,
        observedAt,
      });
    } catch (error) {
      try {
        await dependencies.repository.recordSubscriptionComparisonFailure({
          addressId: owner.addressId,
          network: input.network,
          enrollmentGeneration: generation,
          failedAt: observedAt,
        });
      } catch (evidenceError) {
        // The pending checkpoint keeps readiness fail-closed. Preserve the
        // original completion error while still surfacing evidence-store loss.
        log.error('Unable to persist subscription comparison failure evidence', {
          addressId: owner.addressId,
          completionError: getErrorMessage(error),
          evidenceError: getErrorMessage(evidenceError),
        });
      }
      throw error;
    }
  }

  async function recordStatusPage(
    input: RecordSubscriptionStatusPageInput,
  ): Promise<RecordSubscriptionStatusPageResult> {
    requireObservation(input);
    const limit = runtimeLimit(input.limit);
    const owners = (
      await dependencies.repository.findSubscriptionCheckpointOwners(
        input.network,
        input.scriptHash,
        {
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          limit,
        },
      )
    ).slice(0, limit);
    if (owners.length === 0) {
      return {
        scanned: 0,
        completed: 0,
        unavailable: 0,
        syncIntents: [],
        dispatch: emptyDispatch(0),
      };
    }
    const observedAt = observationTime(dependencies.now ?? (() => new Date()));
    const intents = new Map<string, SubscriptionCheckpointSyncIntent>();
    let completed = 0;
    for (const owner of owners) {
      if (dependencies.isActive && !dependencies.isActive()) break;
      try {
        const completion = await completeOwner(owner, input, observedAt);
        if (completion.status !== 'applied') continue;
        completed += 1;
        addIntent(intents, completion);
      } catch {
        // The checkpoint remains pending and is retried by bounded reconciliation.
        continue;
      }
    }
    const syncIntents = [...intents.values()];
    return {
      scanned: owners.length,
      completed,
      unavailable: owners.length - completed,
      syncIntents,
      dispatch: await dispatchIntents(dependencies, syncIntents),
      nextCursor: owners[owners.length - 1].addressId,
    };
  }

  return { enrollPendingPage, hasPendingWalletEnrollment, recordStatusPage };
}

export function createProductionSubscriptionCheckpointRuntime(
  subscribeBatch: SubscriptionBatchPort,
  isActive: () => boolean,
  releaseBatch?: (statuses: Map<string, string | null>) => void,
  serializePersistence?: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  return createSubscriptionCheckpointRuntime({
    repository: {
      findPendingSubscriptionEnrollments,
      findSubscriptionCheckpointOwners,
      requestSubscriptionEnrollment,
      completeSubscriptionEnrollment,
      recordSubscriptionComparisonFailure,
    },
    subscribeBatch,
    ...(releaseBatch ? { releaseBatch } : {}),
    ...(serializePersistence ? { serializePersistence } : {}),
    publishTransition: (transition) => syncLifecyclePublisher.publish(transition),
    wake: (walletId, generation) => syncIntentAdmission.wake(walletId, generation),
    isActive,
  });
}

export type SubscriptionCheckpointRuntime = ReturnType<
  typeof createSubscriptionCheckpointRuntime
>;
