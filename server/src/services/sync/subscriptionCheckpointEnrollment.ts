import {
  isNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';
import type {
  SubscriptionEnrollmentCompletionInput,
  SubscriptionEnrollmentCompletionResult,
  SubscriptionEnrollmentCandidate,
  SubscriptionCheckpointSyncIntent,
} from '../../repositories/types';
import type {
  RecordSubscriptionComparisonFailureInput,
  RecordSubscriptionComparisonFailureResult,
} from '../../repositories/subscriptionCoverageRepository';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { addressToScriptHash } from '../bitcoin/electrum/methods';

const MAX_ENROLLMENT_PAGE_SIZE = 200;
const ELECTRUM_STATUS_PATTERN = /^[0-9a-f]{64}$/;
const log = createLogger('SERVICE:SUBSCRIPTION_CHECKPOINT_ENROLLMENT');

export interface SubscriptionBatchInput {
  network: NetworkType;
  addresses: string[];
}

export type SubscriptionBatchPort = (
  input: SubscriptionBatchInput,
) => Promise<Map<string, string | null>>;

export interface SubscriptionCheckpointEnrollmentRepositoryPort {
  findPendingSubscriptionEnrollments(options: {
    network: NetworkType;
    walletId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SubscriptionEnrollmentCandidate[]>;
  completeSubscriptionEnrollment(
    input: SubscriptionEnrollmentCompletionInput,
  ): Promise<SubscriptionEnrollmentCompletionResult>;
  recordSubscriptionComparisonFailure(
    input: RecordSubscriptionComparisonFailureInput,
  ): Promise<RecordSubscriptionComparisonFailureResult>;
}

export interface SubscriptionCheckpointEnrollmentDependencies {
  repository: SubscriptionCheckpointEnrollmentRepositoryPort;
  subscribeBatch: SubscriptionBatchPort;
  now?: () => Date;
  isActive?: () => boolean;
}

export interface EnrollSubscriptionCheckpointPageOptions {
  network: NetworkType;
  walletId?: string;
  cursor?: string;
  limit?: number;
}

export interface SubscriptionCheckpointEnrollmentResult {
  scanned: number;
  enrolled: number;
  unavailable: number;
  /** Exact committed generations, deduplicated by wallet/generation for post-commit wake-up. */
  syncIntents: SubscriptionCheckpointSyncIntent[];
  nextCursor?: string;
}

interface PreparedEnrollment {
  candidate: SubscriptionEnrollmentCandidate;
  scriptHash: string;
}

function enrollmentLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_ENROLLMENT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Subscription enrollment limit must be a positive integer');
  }
  return Math.min(limit, MAX_ENROLLMENT_PAGE_SIZE);
}

function enrollmentTime(now: () => Date): Date {
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new Error('Subscription enrollment clock must return a valid date');
  }
  return observedAt;
}

function prepareCandidate(
  candidate: SubscriptionEnrollmentCandidate,
  network: NetworkType,
): PreparedEnrollment | null {
  if (candidate.network !== network) return null;
  try {
    return {
      candidate,
      scriptHash: addressToScriptHash(candidate.address, network),
    };
  } catch {
    return null;
  }
}

function pageResult(
  candidates: SubscriptionEnrollmentCandidate[],
  enrolled: number,
  syncIntents: SubscriptionCheckpointSyncIntent[] = [],
): SubscriptionCheckpointEnrollmentResult {
  return {
    scanned: candidates.length,
    enrolled,
    unavailable: candidates.length - enrolled,
    syncIntents,
    ...(candidates.length > 0
      ? { nextCursor: candidates[candidates.length - 1].addressId }
      : {}),
  };
}

function returnedStatus(
  statuses: Map<string, string | null>,
  address: string,
): { returned: true; status: string | null } | { returned: false } {
  if (!statuses.has(address)) return { returned: false };
  const status = statuses.get(address);
  if (status !== null && (
    typeof status !== 'string' || !ELECTRUM_STATUS_PATTERN.test(status)
  )) {
    return { returned: false };
  }
  return { returned: true, status };
}

async function completeSafely(
  repository: SubscriptionCheckpointEnrollmentRepositoryPort,
  prepared: PreparedEnrollment,
  network: NetworkType,
  observedStatus: string | null,
  observedAt: Date,
): Promise<SubscriptionEnrollmentCompletionResult> {
  const { candidate, scriptHash } = prepared;
  try {
    const result = await repository.completeSubscriptionEnrollment({
      addressId: candidate.addressId,
      address: candidate.address,
      network,
      generation: candidate.requestedEnrollmentGeneration,
      scriptHash,
      observedStatus,
      observedAt,
    });
    return result;
  } catch {
    await recordFailureSafely(repository, candidate, network, observedAt);
    return { status: 'not_applied' };
  }
}

async function recordFailureSafely(
  repository: SubscriptionCheckpointEnrollmentRepositoryPort,
  candidate: SubscriptionEnrollmentCandidate,
  network: NetworkType,
  failedAt: Date,
): Promise<void> {
  try {
    await repository.recordSubscriptionComparisonFailure({
      addressId: candidate.addressId,
      network,
      enrollmentGeneration: candidate.requestedEnrollmentGeneration,
      failedAt,
    });
  } catch (error) {
    // The durable coverage gap remains open. The readiness reader therefore
    // still fails closed even when failure-evidence persistence is unavailable.
    log.error('Unable to persist subscription comparison failure evidence', {
      addressId: candidate.addressId,
      error: getErrorMessage(error),
    });
  }
}

async function recordFailures(
  repository: SubscriptionCheckpointEnrollmentRepositoryPort,
  candidates: SubscriptionEnrollmentCandidate[],
  network: NetworkType,
  failedAt: Date,
  isActive?: () => boolean,
): Promise<void> {
  for (const candidate of candidates) {
    // Every untouched candidate retains its durable open gap, so shutdown may
    // stop this best-effort evidence loop without creating a false-ready state.
    if (isActive && !isActive()) break;
    await recordFailureSafely(repository, candidate, network, failedAt);
  }
}

function safeFailureTime(now: () => Date): Date | null {
  try {
    return enrollmentTime(now);
  } catch (error) {
    log.error('Unable to timestamp subscription comparison failures', {
      error: getErrorMessage(error),
    });
    return null;
  }
}

function addSyncIntent(
  intents: Map<string, SubscriptionCheckpointSyncIntent>,
  intent: SubscriptionCheckpointSyncIntent | null,
): void {
  if (!intent) return;
  intents.set(`${intent.walletId}:${intent.generation}`, intent);
}

export function createSubscriptionCheckpointEnrollment(
  dependencies: SubscriptionCheckpointEnrollmentDependencies,
) {
  async function enrollPage(
    options: EnrollSubscriptionCheckpointPageOptions,
  ): Promise<SubscriptionCheckpointEnrollmentResult> {
    if (!isNetworkType(options.network)) {
      throw new Error('Subscription enrollment requires a supported network');
    }
    const limit = enrollmentLimit(options.limit);
    const candidates = (
      await dependencies.repository.findPendingSubscriptionEnrollments({
        network: options.network,
        ...(options.walletId !== undefined ? { walletId: options.walletId } : {}),
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        limit,
      })
    ).slice(0, limit);
    if (candidates.length === 0) return pageResult(candidates, 0);

    const prepared: PreparedEnrollment[] = [];
    const invalidCandidates: SubscriptionEnrollmentCandidate[] = [];
    for (const candidate of candidates) {
      const item = prepareCandidate(candidate, options.network);
      if (item) prepared.push(item);
      else invalidCandidates.push(candidate);
    }
    if (prepared.length === 0) {
      const failedAt = safeFailureTime(dependencies.now ?? (() => new Date()));
      // Without a trustworthy timestamp we cannot persist event history, but
      // all candidates remain pending with durable gaps, so readiness is false.
      if (failedAt) {
        await recordFailures(
          dependencies.repository,
          invalidCandidates,
          options.network,
          failedAt,
          dependencies.isActive,
        );
      }
      return pageResult(candidates, 0);
    }
    if (dependencies.isActive && !dependencies.isActive()) {
      return pageResult(candidates, 0);
    }

    let statuses: Map<string, string | null>;
    try {
      statuses = await dependencies.subscribeBatch({
        network: options.network,
        addresses: prepared.map(({ candidate }) => candidate.address),
      });
    } catch {
      const failedAt = safeFailureTime(dependencies.now ?? (() => new Date()));
      if (failedAt) {
        await recordFailures(
          dependencies.repository,
          [...invalidCandidates, ...prepared.map(({ candidate }) => candidate)],
          options.network,
          failedAt,
          dependencies.isActive,
        );
      }
      return pageResult(candidates, 0);
    }
    if (!(statuses instanceof Map)) {
      const failedAt = safeFailureTime(dependencies.now ?? (() => new Date()));
      if (failedAt) {
        await recordFailures(
          dependencies.repository,
          [...invalidCandidates, ...prepared.map(({ candidate }) => candidate)],
          options.network,
          failedAt,
          dependencies.isActive,
        );
      }
      return pageResult(candidates, 0);
    }
    if (dependencies.isActive && !dependencies.isActive()) {
      return pageResult(candidates, 0);
    }
    const observedAt = enrollmentTime(dependencies.now ?? (() => new Date()));
    await recordFailures(
      dependencies.repository,
      invalidCandidates,
      options.network,
      observedAt,
      dependencies.isActive,
    );

    let enrolled = 0;
    const syncIntents = new Map<string, SubscriptionCheckpointSyncIntent>();
    for (const item of prepared) {
      if (dependencies.isActive && !dependencies.isActive()) break;
      const observation = returnedStatus(statuses, item.candidate.address);
      if (!observation.returned) {
        await recordFailureSafely(
          dependencies.repository,
          item.candidate,
          options.network,
          observedAt,
        );
        continue;
      }
      const completion = await completeSafely(
        dependencies.repository,
        item,
        options.network,
        observation.status,
        observedAt,
      );
      if (completion.status === 'applied') {
        enrolled += 1;
        addSyncIntent(syncIntents, completion.syncIntent);
      }
    }
    return pageResult(candidates, enrolled, [...syncIntents.values()]);
  }

  return { enrollPage };
}

export type SubscriptionCheckpointEnrollment = ReturnType<
  typeof createSubscriptionCheckpointEnrollment
>;
