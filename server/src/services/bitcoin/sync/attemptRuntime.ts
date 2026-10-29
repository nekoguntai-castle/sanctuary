import type {
  SyncExecutionStage,
  SyncProgressDetails,
} from '@sanctuary/shared/schemas/syncProgress';
import type { SyncPhaseProgress } from './phaseProgress';

export const SYNC_REMOTE_STAGE_BUDGET_MS = 5 * 60_000;
export const SYNC_REMOTE_FALLBACK_CONCURRENCY = 4;
/** Remote evidence and history are fetched sequentially, ten items per round trip. */
export const SYNC_REMOTE_BATCH_SIZE = 10;
/**
 * Allowance per sequential ten-item round trip in a work-scaled stage: a Tor
 * round trip plus the raw-hex transfer. A stage never gets less than
 * SYNC_REMOTE_STAGE_BUDGET_MS.
 */
export const SYNC_REMOTE_BATCH_ALLOWANCE_MS = 3_000;
/**
 * Ceiling on the whole address-history phase (history fetch plus its evidence
 * authentication). The window actually opened is `syncHistoryWindowMs`: never
 * more than two thirds of the time left in the attempt, so the persisting
 * phases and the receive-evidence gate keep at least a third of it whatever
 * the configured attempt length.
 */
export const SYNC_HISTORY_WINDOW_MS = 20 * 60_000;

export type SyncStageOutcome = 'completed' | 'failed' | 'budget_expired' | 'aborted';

export interface SyncAttemptTelemetry {
  beginStage(stage: SyncExecutionStage, startedAtMs?: number): boolean;
  finishStage(
    stage: SyncExecutionStage,
    outcome: SyncStageOutcome,
    finishedAtMs?: number,
  ): boolean;
  observeProgress(details: SyncProgressDetails): void;
  recordCandidates(fetched: number, rejected: number): void;
}

export interface SyncAttemptRuntime {
  signal: AbortSignal;
  deadlineAt: number;
  /** Opaque worker-owned telemetry; sync services never inspect its identity. */
  telemetry?: SyncAttemptTelemetry;
  /** Shared stage-log coordinator for this exact recursive attempt. */
  phaseProgress?: SyncPhaseProgress;
}

export interface SyncStageRuntime extends SyncAttemptRuntime {
  dispose: () => void;
}

export class SyncRemoteStageBudgetError extends Error {
  constructor(public readonly stage: string) {
    super(`Wallet sync remote stage budget exhausted: ${stage}`);
    this.name = 'SyncRemoteStageBudgetError';
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Wallet sync cancelled');
}

export function createSyncStageRuntime(
  attempt: SyncAttemptRuntime,
  stage: string,
  budgetMs = SYNC_REMOTE_STAGE_BUDGET_MS,
  now = Date.now(),
): SyncStageRuntime {
  attempt.signal.throwIfAborted();
  const deadlineAt = Math.min(attempt.deadlineAt, now + Math.max(0, budgetMs));
  const controller = new AbortController();
  const abortFromParent = (): void => {
    if (!controller.signal.aborted) controller.abort(abortReason(attempt.signal));
  };
  attempt.signal.addEventListener('abort', abortFromParent, { once: true });

  const remainingMs = Math.max(0, deadlineAt - now);
  const expire = (): void => {
    if (!controller.signal.aborted) controller.abort(new SyncRemoteStageBudgetError(stage));
  };
  const timer = remainingMs === 0 ? undefined : setTimeout(expire, remainingMs);
  timer?.unref?.();
  if (remainingMs === 0) expire();

  return {
    signal: controller.signal,
    deadlineAt,
    dispose: () => {
      if (timer) clearTimeout(timer);
      attempt.signal.removeEventListener('abort', abortFromParent);
    },
  };
}

/** A stage budget that grows with its item count: one allowance per sequential batch. */
export function workScaledStageBudgetMs(items: number): number {
  const batches = Math.ceil(Math.max(0, items) / SYNC_REMOTE_BATCH_SIZE);
  return Math.max(SYNC_REMOTE_STAGE_BUDGET_MS, batches * SYNC_REMOTE_BATCH_ALLOWANCE_MS);
}

/**
 * The address-history window for an attempt ending at `attemptDeadlineAt`:
 * SYNC_HISTORY_WINDOW_MS, or two thirds of the time left if that is shorter.
 */
export function syncHistoryWindowMs(attemptDeadlineAt: number, now = Date.now()): number {
  return Math.min(SYNC_HISTORY_WINDOW_MS, Math.max(0, Math.floor((attemptDeadlineAt - now) * 2 / 3)));
}

/** Narrows an attempt to a window; stages created from it never outlive the window. */
export function createSyncWindowRuntime(
  attempt: SyncAttemptRuntime,
  windowMs: number,
  now = Date.now(),
): SyncAttemptRuntime {
  return { ...attempt, deadlineAt: Math.min(attempt.deadlineAt, now + Math.max(0, windowMs)) };
}

export function isSyncStageBudgetError(error: unknown): error is SyncRemoteStageBudgetError {
  return error instanceof SyncRemoteStageBudgetError;
}

export function throwIfAttemptAborted(attempt: SyncAttemptRuntime): void {
  attempt.signal.throwIfAborted();
}

export async function abortableSyncDelay(ms: number, runtime: SyncAttemptRuntime): Promise<void> {
  runtime.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      runtime.signal.removeEventListener('abort', onAbort);
    };
    const finish = (): void => {
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(runtime.signal));
    };
    const timer = setTimeout(finish, Math.min(ms, Math.max(0, runtime.deadlineAt - Date.now())));
    runtime.signal.addEventListener('abort', onAbort, { once: true });
    timer.unref();
  });
  runtime.signal.throwIfAborted();
}

export async function mapWithSyncConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  runtime: Pick<SyncAttemptRuntime, 'signal'> | undefined,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      runtime?.signal.throwIfAborted();
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
      runtime?.signal.throwIfAborted();
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker(),
  ));
  return results;
}
