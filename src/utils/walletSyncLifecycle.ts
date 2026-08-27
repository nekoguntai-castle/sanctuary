import type { WalletSyncSubject } from './walletSyncPresentationTypes';
import { parseStrictIsoInstant } from './isoInstant';

export const WALLET_SYNC_LIFECYCLE_STATES = [
  'action_required',
  'running',
  'retrying',
  'pending',
  'attention',
  'settled',
] as const;

export type WalletSyncLifecycleState = typeof WALLET_SYNC_LIFECYCLE_STATES[number];
export type AcceptedWalletSyncIntentKind = 'incremental' | 'full_resync';

export interface AcceptedWalletSyncIntent {
  kind: AcceptedWalletSyncIntentKind;
  generation: number;
}

export type WalletSyncAttentionReason =
  | 'invalid_generation_evidence'
  | 'invalid_timestamp_evidence'
  | 'lease_evidence_expired'
  | 'lease_evidence_incomplete'
  | 'execution_evidence_disagrees';

export interface WalletSyncLifecycleClassification {
  state: WalletSyncLifecycleState;
  incrementalPending: boolean;
  fullResyncPending: boolean;
  attentionReason?: WalletSyncAttentionReason;
  leaseClaimedAt?: number;
  leaseExpiresAt?: number;
  retryAt?: number;
}

export interface WalletSyncFleetSummary {
  total: number;
  actionRequired: number;
  syncing: number;
  retrying: number;
  pending: number;
  attention: number;
  settled: number;
  text: string;
}

export interface WalletSyncControlOptions {
  requestSubmitting?: boolean;
  acceptedIntent?: AcceptedWalletSyncIntent;
}

export interface WalletSyncControls {
  requestSubmitting: boolean;
  executionRunning: boolean;
  requestPending: boolean;
  incrementalPending: boolean;
  fullResyncPending: boolean;
  actionRequired: boolean;
  syncDisabled: boolean;
  fullResyncDisabled: boolean;
}

export function projectAcceptedWalletSyncIntent<T extends WalletSyncSubject>(
  subject: T,
  acceptedIntent: AcceptedWalletSyncIntent | undefined,
  executionRunning: boolean,
): T {
  if (!acceptedIntent || executionRunning) return subject;
  const priorGeneration = acceptedIntent.generation - 1;
  const common = {
    ...subject,
    lastSyncStatus: null,
    syncInProgress: false,
    syncExecutionOwner: null,
    syncNextRetryAt: null,
    syncStartedAt: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncActionRequiredAt: null,
  };
  if (acceptedIntent.kind === 'full_resync') {
    return {
      ...common,
      requestedFullResyncGeneration: Math.max(
        subject.requestedFullResyncGeneration ?? 0,
        acceptedIntent.generation,
      ),
      preparedFullResyncGeneration: Math.min(
        subject.preparedFullResyncGeneration ?? priorGeneration,
        priorGeneration,
      ),
      processedFullResyncGeneration: Math.min(
        subject.processedFullResyncGeneration ?? priorGeneration,
        priorGeneration,
      ),
    };
  }
  return {
    ...common,
    requestedIncrementalSyncGeneration: Math.max(
      subject.requestedIncrementalSyncGeneration ?? 0,
      acceptedIntent.generation,
    ),
    claimedIncrementalSyncGeneration: Math.min(
      subject.claimedIncrementalSyncGeneration ?? priorGeneration,
      priorGeneration,
    ),
    processedIncrementalSyncGeneration: Math.min(
      subject.processedIncrementalSyncGeneration ?? priorGeneration,
      priorGeneration,
    ),
  };
}

interface GenerationEvidence {
  invalid: boolean;
  pending: boolean;
  claimAhead: boolean;
}

interface TimestampEvidence {
  actionAt: number | null;
  claimedAt: number | null;
  leaseExpiresAt: number | null;
  retryAt: number | null;
  invalid: boolean;
  leaseIncomplete: boolean;
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseInstant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return parseStrictIsoInstant(value);
}

function hasInvalidInstant(value: string | null | undefined): boolean {
  return hasValue(value) && parseInstant(value) === null;
}

function incrementalEvidence(subject: WalletSyncSubject): GenerationEvidence {
  const requested = subject.requestedIncrementalSyncGeneration;
  const claimed = subject.claimedIncrementalSyncGeneration;
  const processed = subject.processedIncrementalSyncGeneration;
  const hasRequested = hasValue(requested);
  const hasProcessed = hasValue(processed);
  if (hasRequested !== hasProcessed) return { invalid: true, pending: false, claimAhead: false };
  if (!hasRequested) {
    return hasValue(claimed)
      ? { invalid: true, pending: false, claimAhead: false }
      : { invalid: false, pending: false, claimAhead: false };
  }
  if (!isGeneration(requested) || !isGeneration(processed) || processed > requested) {
    return { invalid: true, pending: false, claimAhead: false };
  }
  if (claimed === undefined || claimed === null) {
    return { invalid: false, pending: requested > processed, claimAhead: false };
  }
  if (!isGeneration(claimed) || claimed < processed || claimed > requested) {
    return { invalid: true, pending: requested > processed, claimAhead: false };
  }
  return {
    invalid: false,
    pending: requested > processed,
    claimAhead: claimed > processed,
  };
}

function fullResyncEvidence(subject: WalletSyncSubject): GenerationEvidence {
  const requested = subject.requestedFullResyncGeneration;
  const prepared = subject.preparedFullResyncGeneration;
  const processed = subject.processedFullResyncGeneration;
  const hasRequested = hasValue(requested);
  const hasProcessed = hasValue(processed);
  if (hasRequested !== hasProcessed) return { invalid: true, pending: false, claimAhead: false };
  if (!hasRequested) {
    return hasValue(prepared)
      ? { invalid: true, pending: false, claimAhead: false }
      : { invalid: false, pending: false, claimAhead: false };
  }
  if (!isGeneration(requested) || !isGeneration(processed) || processed > requested) {
    return { invalid: true, pending: false, claimAhead: false };
  }
  if (prepared !== undefined && prepared !== null && (
    !isGeneration(prepared) || prepared < processed || prepared > requested
  )) return { invalid: true, pending: requested > processed, claimAhead: false };
  return { invalid: false, pending: requested > processed, claimAhead: false };
}

function timestampEvidence(subject: WalletSyncSubject): TimestampEvidence {
  const actionAt = parseInstant(subject.syncActionRequiredAt);
  const claimedAt = parseInstant(subject.incrementalSyncClaimedAt);
  const leaseExpiresAt = parseInstant(subject.incrementalSyncLeaseExpiresAt);
  const retryAt = parseInstant(subject.syncNextRetryAt);
  const invalid = [
    subject.syncActionRequiredAt,
    subject.incrementalSyncClaimedAt,
    subject.incrementalSyncLeaseExpiresAt,
    subject.syncNextRetryAt,
    subject.syncStartedAt,
  ].some(hasInvalidInstant);
  return {
    actionAt,
    claimedAt,
    leaseExpiresAt,
    retryAt,
    invalid,
    leaseIncomplete: hasValue(subject.incrementalSyncClaimedAt)
      !== hasValue(subject.incrementalSyncLeaseExpiresAt),
  };
}

function invalidLeaseOrder(timestamps: TimestampEvidence): boolean {
  if (timestamps.claimedAt === null || timestamps.leaseExpiresAt === null) return false;
  return timestamps.leaseExpiresAt <= timestamps.claimedAt;
}

function hasExecutionEvidence(
  subject: WalletSyncSubject,
  generations: GenerationEvidence,
  timestamps: TimestampEvidence,
): boolean {
  return [
    subject.syncInProgress === true,
    hasValue(subject.syncExecutionOwner),
    hasValue(subject.syncStartedAt),
    generations.claimAhead,
    timestamps.claimedAt !== null,
    timestamps.leaseExpiresAt !== null,
    subject.lastSyncStatus === 'resyncing',
  ].some(Boolean);
}

function hasRetryEvidence(subject: WalletSyncSubject, timestamps: TimestampEvidence): boolean {
  return subject.lastSyncStatus === 'retrying' || timestamps.retryAt !== null;
}

function attentionReason(
  subject: WalletSyncSubject,
  generations: GenerationEvidence,
  timestamps: TimestampEvidence,
  now: number,
): WalletSyncAttentionReason | undefined {
  if (generations.invalid) return 'invalid_generation_evidence';
  if (timestamps.invalid) return 'invalid_timestamp_evidence';
  if (timestamps.leaseIncomplete) return 'lease_evidence_incomplete';
  if (invalidLeaseOrder(timestamps)) return 'invalid_timestamp_evidence';
  if (timestamps.leaseExpiresAt !== null && timestamps.leaseExpiresAt <= now) {
    return 'lease_evidence_expired';
  }
  if (hasExecutionEvidence(subject, generations, timestamps)) {
    return 'execution_evidence_disagrees';
  }
  if (hasRetryEvidence(subject, timestamps)) {
    return generations.pending ? undefined : 'execution_evidence_disagrees';
  }
  return undefined;
}

export function classifyWalletSyncLifecycle(
  subject: WalletSyncSubject,
  now: number = Date.now(),
): WalletSyncLifecycleClassification {
  const incremental = incrementalEvidence(subject);
  const fullResync = fullResyncEvidence(subject);
  const combined = {
    invalid: incremental.invalid || fullResync.invalid,
    pending: incremental.pending || fullResync.pending,
    claimAhead: incremental.claimAhead,
  };
  const timestamps = timestampEvidence(subject);
  const attention = attentionReason(subject, combined, timestamps, now);
  const base = {
    incrementalPending: incremental.pending,
    fullResyncPending: fullResync.pending,
  };

  if (timestamps.actionAt !== null) return { state: 'action_required', ...base };
  const activeLease = attention === 'execution_evidence_disagrees'
    && subject.syncInProgress === true
    && subject.syncExecutionOwner === 'worker'
    && incremental.claimAhead
    && timestamps.claimedAt !== null
    && timestamps.leaseExpiresAt !== null
    && timestamps.leaseExpiresAt > timestamps.claimedAt
    && timestamps.leaseExpiresAt > now;
  if (activeLease) {
    return {
      state: 'running',
      ...base,
      leaseClaimedAt: timestamps.claimedAt as number,
      leaseExpiresAt: timestamps.leaseExpiresAt as number,
    };
  }
  const retrying = !attention
    && subject.syncInProgress !== true
    && combined.pending
    && (subject.lastSyncStatus === 'retrying'
      || (timestamps.retryAt !== null && timestamps.retryAt > now));
  if (retrying) {
    return { state: 'retrying', ...base, retryAt: timestamps.retryAt ?? undefined };
  }
  if (!attention && combined.pending) return { state: 'pending', ...base };
  if (attention) return { state: 'attention', ...base, attentionReason: attention };
  return { state: 'settled', ...base };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeWalletSyncFleet(
  subjects: readonly WalletSyncSubject[],
  now: number = Date.now(),
): WalletSyncFleetSummary {
  const counts = {
    actionRequired: 0,
    syncing: 0,
    retrying: 0,
    pending: 0,
    attention: 0,
    settled: 0,
  };
  for (const subject of subjects) {
    const state = classifyWalletSyncLifecycle(subject, now).state;
    if (state === 'action_required') counts.actionRequired += 1;
    else if (state === 'running') counts.syncing += 1;
    else counts[state] += 1;
  }
  const parts = [countLabel(subjects.length, 'wallet')];
  if (counts.syncing > 0) parts.push(`${counts.syncing} syncing`);
  if (counts.retrying > 0) parts.push(`${counts.retrying} retrying`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.actionRequired > 0) {
    parts.push(countLabel(counts.actionRequired, 'action required', 'action required'));
  }
  if (counts.attention > 0) parts.push(`${counts.attention} attention`);
  return { total: subjects.length, ...counts, text: parts.join(' · ') };
}

function acceptedIntentPending(
  subject: WalletSyncSubject,
  acceptedIntent: AcceptedWalletSyncIntent | undefined,
): boolean {
  if (!acceptedIntent || !isGeneration(acceptedIntent.generation)) return false;
  const processed = acceptedIntent.kind === 'incremental'
    ? subject.processedIncrementalSyncGeneration
    : subject.processedFullResyncGeneration;
  return !isGeneration(processed) || processed < acceptedIntent.generation;
}

export function deriveWalletSyncControls(
  subject: WalletSyncSubject,
  classification: WalletSyncLifecycleClassification,
  options: WalletSyncControlOptions = {},
): WalletSyncControls {
  const acceptedPending = acceptedIntentPending(subject, options.acceptedIntent);
  const incrementalPending = classification.incrementalPending
    || (acceptedPending && options.acceptedIntent?.kind === 'incremental');
  const fullResyncPending = classification.fullResyncPending
    || (acceptedPending && options.acceptedIntent?.kind === 'full_resync');
  const requestPending = incrementalPending || fullResyncPending;
  const requestSubmitting = options.requestSubmitting === true;
  const executionRunning = classification.state === 'running';
  const actionRequired = classification.state === 'action_required' && !acceptedPending;
  const blockedByExecution = requestSubmitting || executionRunning;
  return {
    requestSubmitting,
    executionRunning,
    requestPending,
    incrementalPending,
    fullResyncPending,
    actionRequired,
    syncDisabled: blockedByExecution || (!actionRequired && requestPending),
    fullResyncDisabled: blockedByExecution || (!actionRequired && fullResyncPending),
  };
}

export function getNextWalletSyncBoundary(
  subjects: readonly WalletSyncSubject[],
  now: number = Date.now(),
): number | null {
  let nearest: number | null = null;
  for (const subject of subjects) {
    const classification = classifyWalletSyncLifecycle(subject, now);
    const candidates = [classification.leaseExpiresAt, classification.retryAt];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate <= now) continue;
      if (nearest === null || candidate < nearest) nearest = candidate;
    }
  }
  return nearest;
}

function hasValue(value: string | number | null | undefined): boolean {
  return value !== null && value !== undefined;
}
