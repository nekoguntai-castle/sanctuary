import {
  isSyncExecutionOwner,
  isWalletSyncFailureClass,
  type SyncExecutionOwner,
  type SyncLifecycleTransitionKind,
} from '@sanctuary/shared/constants/sync';
import type {
  Wallet,
  WalletSyncState,
  WalletSyncStatePatch,
} from '../../repositories/types';
import { withTimeout } from '../../utils/async';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { classifyWalletSyncFailure } from './failureClassification';

const log = createLogger('SYNC:ATTEMPT_LIFECYCLE');

/**
 * Maximum cooperative unwind window after cancellation before an adapter may
 * reclaim its lock. A call blocked below the pipeline's abort checkpoints must
 * not hold the lock — and therefore the wallet — forever.
 */
export const SYNC_ABORT_GRACE_MS = 30_000;

/** Backoff between persistence attempts; its length plus one is the attempt count. */
const PERSISTENCE_RETRY_BACKOFF_MS = [250, 1_000, 3_000] as const;

type WalletSyncStateRecord = Pick<Wallet, keyof WalletSyncState>;

export interface SyncAttemptWriter {
  updateSyncState: (
    walletId: string,
    state: WalletSyncStatePatch,
  ) => Promise<WalletSyncStateRecord>;
  completeSyncSuccess: (
    walletId: string,
    syncedAt: Date,
    lastSyncedBlockHeight: number,
  ) => Promise<WalletSyncStateRecord>;
}

export type SyncStatePersister = (
  walletId: string,
  state: WalletSyncStatePatch,
  writer: SyncAttemptWriter,
) => Promise<WalletSyncState | null>;

/** Exact database snapshot produced by one persisted lifecycle transition. */
export interface PersistedSyncTransition {
  walletId: string;
  transition: SyncLifecycleTransitionKind;
  state: WalletSyncState;
}

export interface StartSyncAttemptInput {
  owner: SyncExecutionOwner;
  retryCount: number;
  startedAt: Date;
}

export interface SyncSuccessInput {
  syncedAt: Date;
  lastSyncedBlockHeight?: number;
}

export interface SyncRetryInput {
  owner: SyncExecutionOwner;
  retryCount: number;
  nextRetryAt: Date;
  error: unknown;
}

export interface SyncFailureInput {
  error: unknown;
}

export interface SyncLockContentionInput {
  error: unknown;
  isFinalAttempt: boolean;
}

function persistedTransition(
  walletId: string,
  transition: SyncLifecycleTransitionKind,
  state: WalletSyncState,
): PersistedSyncTransition {
  return { walletId, transition, state };
}

function persistedSyncStateError(record: WalletSyncStateRecord): string | null {
  if (
    record.syncExecutionOwner !== null
    && !isSyncExecutionOwner(record.syncExecutionOwner)
  ) {
    return `Invalid persisted sync execution owner: ${record.syncExecutionOwner}`;
  }
  if (
    record.lastSyncFailureClass !== null
    && !isWalletSyncFailureClass(record.lastSyncFailureClass)
  ) {
    return `Invalid persisted sync failure class: ${record.lastSyncFailureClass}`;
  }
  return null;
}

function projectSyncState(record: WalletSyncStateRecord): WalletSyncState {
  return {
    syncInProgress: record.syncInProgress,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncStatus: record.lastSyncStatus,
    lastSyncError: record.lastSyncError,
    lastSyncFailureClass:
      record.lastSyncFailureClass as WalletSyncState['lastSyncFailureClass'],
    syncExecutionOwner:
      record.syncExecutionOwner as WalletSyncState['syncExecutionOwner'],
    syncRetryCount: record.syncRetryCount,
    syncNextRetryAt: record.syncNextRetryAt,
    syncStartedAt: record.syncStartedAt,
    syncStateVersion: record.syncStateVersion,
  };
}

function requirePersistedSyncState(record: WalletSyncStateRecord): WalletSyncState {
  const validationError = persistedSyncStateError(record);
  if (validationError) throw new Error(validationError);
  return projectSyncState(record);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Sync attempt was cancelled');
}

/**
 * Run one sync attempt with a cooperative duration cap and bounded unwind.
 *
 * The adapter retains ownership of its outer lock and cancellation policy. This
 * helper only composes that cancellation with the per-attempt timeout, then
 * gives the operation a bounded window to observe the abort. To preserve the
 * established inline contract, a cooperative operation that finishes during
 * that grace window still wins; otherwise the original cancellation reason is
 * returned to the adapter.
 */
export async function runSyncAttemptWithTimeout<T>(
  execute: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  abortGraceMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let notifyAborted!: (reason: unknown) => void;
  const aborted = new Promise<unknown>((resolve) => {
    notifyAborted = resolve;
  });
  const abort = (reason: unknown): void => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    notifyAborted(abortReason(controller.signal));
  };
  const onParentAbort = (): void => abort(abortReason(parentSignal!));

  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timeoutError = new Error(`Sync attempt timed out after ${timeoutMs}ms`);
  const timeoutHandle = setTimeout(() => abort(timeoutError), timeoutMs);
  timeoutHandle?.unref?.();
  const execution = Promise.resolve().then(() => execute(controller.signal));

  try {
    const first = await Promise.race([
      execution.then(
        (value) => ({ kind: 'completed' as const, value }),
        (error: unknown) => ({ kind: 'failed' as const, error }),
      ),
      aborted.then((reason) => ({ kind: 'aborted' as const, reason })),
    ]);
    if (first.kind === 'completed') return first.value;
    if (first.kind === 'failed') throw first.error;

    try {
      return await withTimeout(
        execution,
        abortGraceMs,
        `Sync attempt did not stop within ${abortGraceMs}ms of cancellation`,
      );
    } catch {
      throw first.reason;
    }
  } finally {
    clearTimeout(timeoutHandle);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Persist sync state through a short, bounded database outage.
 *
 * This never throws because callers are already handling a sync failure and
 * must not replace the original error with a bookkeeping error.
 */
export async function persistSyncStateWithRetry(
  walletId: string,
  state: WalletSyncStatePatch,
  writer: SyncAttemptWriter,
): Promise<WalletSyncState | null> {
  for (
    let attempt = 0;
    attempt <= PERSISTENCE_RETRY_BACKOFF_MS.length;
    attempt += 1
  ) {
    try {
      const record = await writer.updateSyncState(walletId, state);
      const validationError = persistedSyncStateError(record);
      if (validationError) {
        log.error(`Could not use recorded sync state for wallet ${walletId}`, {
          error: validationError,
        });
        return null;
      }
      const persisted = projectSyncState(record);
      if (attempt > 0) {
        log.info(
          `Recorded sync state for wallet ${walletId} after ${attempt} retries`,
        );
      }
      return persisted;
    } catch (error) {
      if (attempt === PERSISTENCE_RETRY_BACKOFF_MS.length) {
        log.error(
          `Could not record sync state for wallet ${walletId}; the row is now stale`,
          {
            error: getErrorMessage(error),
            attempts: attempt + 1,
            intended: state,
          },
        );
        return null;
      }
      log.warn(`Sync state write failed for wallet ${walletId}; retrying`, {
        error: getErrorMessage(error),
        attempt: attempt + 1,
      });
      await delay(PERSISTENCE_RETRY_BACKOFF_MS[attempt]);
    }
  }
  /* v8 ignore next -- the loop returns on every path */
  return null;
}

/** Mark an attempt active before its adapter starts wallet synchronization. */
export async function startSyncAttempt(
  walletId: string,
  input: StartSyncAttemptInput,
  writer: SyncAttemptWriter,
): Promise<PersistedSyncTransition> {
  const state = requirePersistedSyncState(await writer.updateSyncState(walletId, {
    syncInProgress: true,
    lastSyncStatus: 'syncing',
    syncExecutionOwner: input.owner,
    syncRetryCount: input.retryCount,
    syncNextRetryAt: null,
    syncStartedAt: input.startedAt,
  }));
  return persistedTransition(walletId, 'started', state);
}

/** Persist the canonical successful terminal state for an executed attempt. */
export async function recordSyncSuccess(
  walletId: string,
  input: SyncSuccessInput,
  writer: SyncAttemptWriter,
): Promise<PersistedSyncTransition> {
  if (input.lastSyncedBlockHeight !== undefined) {
    const state = requirePersistedSyncState(await writer.completeSyncSuccess(
      walletId,
      input.syncedAt,
      input.lastSyncedBlockHeight,
    ));
    return persistedTransition(walletId, 'succeeded', state);
  }

  const state = requirePersistedSyncState(await writer.updateSyncState(walletId, {
    lastSyncedAt: input.syncedAt,
    lastSyncStatus: 'success',
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncInProgress: false,
    syncExecutionOwner: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncStartedAt: null,
  }));
  return persistedTransition(walletId, 'succeeded', state);
}

/** Persist a retry-pending transition without masking the execution error. */
export async function recordSyncRetry(
  walletId: string,
  input: SyncRetryInput,
  writer: SyncAttemptWriter,
  persist: SyncStatePersister = persistSyncStateWithRetry,
): Promise<PersistedSyncTransition | null> {
  const errorMessage = getErrorMessage(input.error, 'Unknown error');
  const state = await persist(
    walletId,
    {
      lastSyncStatus: 'retrying',
      lastSyncError: errorMessage,
      lastSyncFailureClass: classifyWalletSyncFailure(errorMessage),
      syncInProgress: false,
      syncExecutionOwner: input.owner,
      syncRetryCount: input.retryCount,
      syncNextRetryAt: input.nextRetryAt,
      syncStartedAt: null,
    },
    writer,
  );
  return state && persistedTransition(walletId, 'retrying', state);
}

/** Persist the canonical failed terminal state without masking the execution error. */
export async function recordSyncFailure(
  walletId: string,
  input: SyncFailureInput,
  writer: SyncAttemptWriter,
  persist: SyncStatePersister = persistSyncStateWithRetry,
): Promise<PersistedSyncTransition | null> {
  const errorMessage = getErrorMessage(input.error, 'Unknown error');
  const state = await persist(
    walletId,
    {
      lastSyncStatus: 'failed',
      lastSyncError: errorMessage,
      lastSyncFailureClass: classifyWalletSyncFailure(errorMessage),
      syncInProgress: false,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    },
    writer,
  );
  return state && persistedTransition(walletId, 'failed', state);
}

/**
 * Record terminal pre-attempt lock contention without clearing another
 * holder's `syncInProgress` flag. A non-final BullMQ attempt has another chance
 * to acquire the lock and therefore must not publish durable terminal state.
 */
export async function recordSyncLockContention(
  walletId: string,
  input: SyncLockContentionInput,
  writer: SyncAttemptWriter,
  persist: SyncStatePersister = persistSyncStateWithRetry,
): Promise<PersistedSyncTransition | null> {
  if (!input.isFinalAttempt) return null;
  const state = await persist(
    walletId,
    {
      lastSyncStatus: 'failed',
      lastSyncError: getErrorMessage(input.error, 'Sync lock contention'),
      lastSyncFailureClass: 'lock_contention',
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    },
    writer,
  );
  return state && persistedTransition(walletId, 'failed', state);
}

/** Best-effort safety transition that clears an abandoned attempt coherently. */
export async function clearActiveSyncAttempt(
  walletId: string,
  writer: SyncAttemptWriter,
): Promise<PersistedSyncTransition> {
  const state = requirePersistedSyncState(await writer.updateSyncState(walletId, {
    syncInProgress: false,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncStartedAt: null,
  }));
  return persistedTransition(walletId, 'cleared', state);
}
