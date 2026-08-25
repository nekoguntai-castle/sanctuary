/**
 * Canonical confirmation refresh workflow.
 *
 * Persistence completes before publication. Publication is best-effort and its
 * failures are returned separately so callers cannot retry or reclassify an
 * already-persisted confirmation change.
 */

import { getConfig } from '../../config';
import { transactionRepository } from '../../repositories';
import {
  acquireLock,
  extendLock,
  releaseLock,
  type DistributedLock,
} from '../../infrastructure';
import { getSyncLockKey, getSyncLockTtlMs } from '../../jobs/syncJobContract';
import {
  populateMissingTransactionFields,
  updateTransactionConfirmations,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
} from '../bitcoin/blockchain';
import { updateTransactionConfirmationsAtHeight } from '../bitcoin/sync/confirmations/updateConfirmations';
import { eventService } from '../eventService';
import { getErrorMessage } from '../../utils/errors';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  runSettledSyncAttemptWithTimeout,
  runSyncAttemptWithTimeout,
  SYNC_ABORT_GRACE_MS,
} from './syncAttemptLifecycle';

const CONFIRMATION_THRESHOLD = 6;
const NOTIFICATION_MILESTONES = new Set([1, 3, 6]);
const CONFIRMATION_LOCK_WAIT_MS = 30_000;
const CONFIRMATION_LOCK_RETRY_MS = 100;
export const HEADER_CONFIRMATION_PAGE_SIZE = 100;
export const HEADER_CONFIRMATION_PAGE_TIMEOUT_MS = 20_000;

/** Reject an operation on abort without leaving an abort listener attached. */
export function raceConfirmationAbort<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => settle(() => reject(signal.reason));
    const settle = (callback: () => void) => {
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => settle(() => resolve(value)),
      error => settle(() => reject(error)),
    );
  });
}

export function assertAuthoritativeHeight(height: number): void {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error('Authoritative block height must be a non-negative safe integer');
  }
}

export interface ConfirmationPublicationFailure {
  walletId: string;
  txid: string;
  error: unknown;
}

export interface WalletConfirmationRefreshResult {
  walletId: string;
  fieldUpdates: number;
  confirmationUpdates: ConfirmationUpdate[];
  confirmationUpdateCount: number;
  milestoneCount: number;
  publicationFailures: ConfirmationPublicationFailure[];
}

export interface ConfirmationRefreshFailure {
  walletId: string;
  error: unknown;
}

export interface PendingConfirmationRefreshResult {
  /** Exact wallet identities selected by the producer, in its canonical order. */
  walletIds: string[];
  wallets: WalletConfirmationRefreshResult[];
  fieldUpdates: number;
  confirmationUpdateCount: number;
  milestoneCount: number;
  publicationFailures: ConfirmationPublicationFailure[];
  failures: ConfirmationRefreshFailure[];
}

/**
 * Bounded database-enumerated page. The producer preserves PostgreSQL order;
 * nextCursor is the final wallet ID, or the requested cursor for an empty page.
 * The repository validates this identity contract before persistence.
 */
export interface PendingConfirmationPageResult extends PendingConfirmationRefreshResult {
  nextCursor: string | null;
  enumerationComplete: boolean;
}

export class ConfirmationRefreshError extends Error {
  readonly partialResult: WalletConfirmationRefreshResult;
  readonly cause: unknown;

  constructor(
    readonly walletId: string,
    cause: unknown,
    partialResult: WalletConfirmationRefreshResult,
  ) {
    super(getErrorMessage(cause));
    this.name = 'ConfirmationRefreshError';
    this.cause = cause;
    this.partialResult = partialResult;
  }
}

/** Raised when another wallet sync owns the serialization lock. */
export class ConfirmationLockUnavailableError extends Error {
  constructor() {
    super('wallet sync lock is still held');
    this.name = 'ConfirmationLockUnavailableError';
  }
}

function publishConfirmationUpdates(
  walletId: string,
  updates: ConfirmationUpdate[],
): ConfirmationPublicationFailure[] {
  const failures: ConfirmationPublicationFailure[] = [];

  for (const update of updates) {
    try {
      eventService.emitTransactionConfirmed({
        walletId,
        txid: update.txid,
        confirmations: update.newConfirmations,
        blockHeight: 0,
        previousConfirmations: update.oldConfirmations,
      });
    } catch (error) {
      failures.push({ walletId, txid: update.txid, error });
    }
  }

  return failures;
}

interface RefreshAccumulator {
  fieldUpdates: number;
  confirmationUpdates: Map<string, ConfirmationUpdate>;
  publicationFailures: ConfirmationPublicationFailure[];
}

interface ConfirmationLockLease {
  signal: AbortSignal;
  release(): Promise<void>;
}

function startConfirmationLockLease(
  initialLock: DistributedLock,
  ttlMs: number,
): ConfirmationLockLease {
  // Renew before expiry to prevent overlapping writers. Losing renewal aborts
  // before another database chunk can commit without lock authority.
  const controller = new AbortController();
  let currentLock = initialLock;
  let stopped = false;
  let extensionInFlight = false;
  const renewalIntervalMs = Math.max(100, Math.floor(ttlMs / 3));
  const timer = setInterval(() => {
    if (extensionInFlight || stopped) return;
    extensionInFlight = true;
    void extendLock(currentLock, ttlMs)
      .then((extended) => {
        if (stopped) return;
        if (!extended) {
          controller.abort(new Error('confirmation refresh lost its wallet sync lock'));
          return;
        }
        currentLock = extended;
      })
      .catch((error) => {
        if (!stopped) controller.abort(error);
      })
      .finally(() => {
        extensionInFlight = false;
      });
  }, renewalIntervalMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    async release(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await releaseLock(currentLock);
    },
  };
}

function confirmationUpdateKey(update: ConfirmationUpdate): string {
  return `${update.txid}:${update.oldConfirmations}:${update.newConfirmations}`;
}

function recordCommittedUpdates(
  walletId: string,
  accumulator: RefreshAccumulator,
  result: PopulateFieldsResult,
): void {
  accumulator.fieldUpdates += result.updated;
  const unpublished = result.confirmationUpdates.filter((update) => {
    const key = confirmationUpdateKey(update);
    if (accumulator.confirmationUpdates.has(key)) return false;
    accumulator.confirmationUpdates.set(key, update);
    return true;
  });
  accumulator.publicationFailures.push(...publishConfirmationUpdates(walletId, unpublished));
}

function refreshResult(
  walletId: string,
  accumulator: RefreshAccumulator,
): WalletConfirmationRefreshResult {
  const confirmationUpdates = [...accumulator.confirmationUpdates.values()];
  return {
    walletId,
    fieldUpdates: accumulator.fieldUpdates,
    confirmationUpdates,
    confirmationUpdateCount: confirmationUpdates.length,
    milestoneCount: confirmationUpdates.filter(({ newConfirmations }) => (
      NOTIFICATION_MILESTONES.has(newConfirmations)
    )).length,
    publicationFailures: accumulator.publicationFailures,
  };
}

function hasCommittedRefreshWork(result: WalletConfirmationRefreshResult): boolean {
  return result.fieldUpdates > 0
    || result.confirmationUpdateCount > 0
    || result.publicationFailures.length > 0;
}

async function executeWalletConfirmationRefresh(
  walletId: string,
  signal: AbortSignal,
  accumulator: RefreshAccumulator,
): Promise<WalletConfirmationRefreshResult> {
  let populateCommittedCount = 0;

  try {
    const populateResult = await populateMissingTransactionFields(
      walletId,
      signal,
      (commit) => {
        populateCommittedCount += commit.updated;
        recordCommittedUpdates(walletId, accumulator, commit);
      },
      undefined,
      true,
    );
    recordCommittedUpdates(walletId, accumulator, {
      updated: Math.max(0, populateResult.updated - populateCommittedCount),
      confirmationUpdates: populateResult.confirmationUpdates,
    });
    const updatedConfirmations = await updateTransactionConfirmations(
      walletId,
      signal,
      (commit) => recordCommittedUpdates(walletId, accumulator, commit),
    );
    recordCommittedUpdates(walletId, accumulator, {
      updated: 0,
      confirmationUpdates: updatedConfirmations,
    });
    return refreshResult(walletId, accumulator);
  } catch (error) {
    throw new ConfirmationRefreshError(walletId, error, refreshResult(walletId, accumulator));
  }
}

async function executeWalletHeightConfirmationRefresh(
  walletId: string,
  authoritativeHeight: number,
  signal: AbortSignal,
  accumulator: RefreshAccumulator,
): Promise<WalletConfirmationRefreshResult> {
  try {
    const updates = await updateTransactionConfirmationsAtHeight(
      walletId,
      authoritativeHeight,
      signal,
      commit => recordCommittedUpdates(walletId, accumulator, commit),
    );
    recordCommittedUpdates(walletId, accumulator, {
      updated: 0,
      confirmationUpdates: updates,
    });
    return refreshResult(walletId, accumulator);
  } catch (error) {
    throw new ConfirmationRefreshError(walletId, error, refreshResult(walletId, accumulator));
  }
}

type WalletRefreshExecutor = (
  signal: AbortSignal,
  accumulator: RefreshAccumulator,
) => Promise<WalletConfirmationRefreshResult>;

async function refreshWalletWithLock(
  walletId: string,
  lockWaitTimeMs: number,
  execute: WalletRefreshExecutor,
  externalSignal?: AbortSignal,
  awaitExecutionSettlement = false,
): Promise<WalletConfirmationRefreshResult> {
  const ttlMs = getSyncLockTtlMs();
  const lock = await acquireLock(getSyncLockKey({ walletId }), {
    ttlMs,
    waitTimeMs: lockWaitTimeMs,
    retryIntervalMs: CONFIRMATION_LOCK_RETRY_MS,
  });
  const accumulator: RefreshAccumulator = {
    fieldUpdates: 0,
    confirmationUpdates: new Map(),
    publicationFailures: [],
  };
  if (!lock) {
    throw new ConfirmationRefreshError(
      walletId,
      new ConfirmationLockUnavailableError(),
      refreshResult(walletId, accumulator),
    );
  }

  const lease = startConfirmationLockLease(lock, ttlMs);
  try {
    try {
      const parentSignal = externalSignal
        ? AbortSignal.any([lease.signal, externalSignal])
        : lease.signal;
      const executeAttempt = (signal: AbortSignal) => execute(signal, accumulator);
      if (awaitExecutionSettlement) {
        return await runSettledSyncAttemptWithTimeout(
          executeAttempt,
          getConfig().sync.maxSyncDurationMs,
          parentSignal,
        );
      }
      return await runSyncAttemptWithTimeout(
        executeAttempt,
        getConfig().sync.maxSyncDurationMs,
        SYNC_ABORT_GRACE_MS,
        parentSignal,
      );
    } catch (error) {
      if (error instanceof ConfirmationRefreshError) throw error;
      throw new ConfirmationRefreshError(walletId, error, refreshResult(walletId, accumulator));
    }
  } finally {
    await lease.release();
  }
}

export async function refreshWalletConfirmations(
  walletId: string,
  lockWaitTimeMs = CONFIRMATION_LOCK_WAIT_MS,
): Promise<WalletConfirmationRefreshResult> {
  return refreshWalletWithLock(
    walletId,
    lockWaitTimeMs,
    (signal, accumulator) => executeWalletConfirmationRefresh(walletId, signal, accumulator),
  );
}

export function refreshWalletConfirmationsAtHeight(
  walletId: string,
  authoritativeHeight: number,
  lockWaitTimeMs: number,
  signal?: AbortSignal,
): Promise<WalletConfirmationRefreshResult> {
  return refreshWalletWithLock(
    walletId,
    lockWaitTimeMs,
    (signal, accumulator) => executeWalletHeightConfirmationRefresh(
      walletId,
      authoritativeHeight,
      signal,
      accumulator,
    ),
    signal,
    true,
  );
}

/**
 * Refresh a stable wallet set and accumulate per-wallet failures. When a page
 * signal aborts, every not-yet-attempted wallet is returned as failed so a
 * durable caller can advance its cursor and retry those identities later.
 */
export async function refreshPendingConfirmationWallets(
  pendingWalletIds: string[],
  refreshWallet: (walletId: string) => Promise<WalletConfirmationRefreshResult> = walletId => (
    refreshWalletConfirmations(walletId, 0)
  ),
  signal?: AbortSignal,
): Promise<PendingConfirmationRefreshResult> {
  const walletIds = [...new Set(pendingWalletIds)].sort();
  const wallets: WalletConfirmationRefreshResult[] = [];
  const failures: ConfirmationRefreshFailure[] = [];

  for (let index = 0; index < walletIds.length; index += 1) {
    const walletId = walletIds[index];
    if (signal?.aborted) {
      const error: unknown = signal.reason;
      failures.push(...walletIds.slice(index).map(remainingWalletId => ({
        walletId: remainingWalletId,
        error,
      })));
      break;
    }
    try {
      // Sweeps must skip contended wallets immediately so one active sync does
      // not hold up confirmation refreshes for every later wallet.
      wallets.push(await refreshWallet(walletId));
    } catch (error) {
      if (error instanceof ConfirmationRefreshError) {
        if (hasCommittedRefreshWork(error.partialResult)) {
          wallets.push(error.partialResult);
        }
        failures.push({ walletId, error: error.cause });
      } else {
        failures.push({ walletId, error });
      }
    }
  }

  return {
    walletIds,
    wallets,
    fieldUpdates: wallets.reduce((total, result) => total + result.fieldUpdates, 0),
    confirmationUpdateCount: wallets.reduce(
      (total, result) => total + result.confirmationUpdateCount,
      0,
    ),
    milestoneCount: wallets.reduce((total, result) => total + result.milestoneCount, 0),
    publicationFailures: wallets.flatMap(({ publicationFailures }) => publicationFailures),
    failures,
  };
}

/** Refresh only wallets on the network that emitted a new block. */
export async function refreshPendingConfirmations(
  network: NetworkType,
): Promise<PendingConfirmationRefreshResult> {
  const pendingWalletIds = await transactionRepository.findWalletIdsWithPendingConfirmations(
    CONFIRMATION_THRESHOLD,
    network,
  );
  return refreshPendingConfirmationWallets(pendingWalletIds);
}

/** Scheduled maintenance intentionally refreshes pending wallets across all networks. */
export async function refreshAllPendingConfirmations(): Promise<PendingConfirmationRefreshResult> {
  const pendingWalletIds = await transactionRepository.findWalletIdsWithPendingConfirmations(
    CONFIRMATION_THRESHOLD,
  );
  return refreshPendingConfirmationWallets(pendingWalletIds);
}
