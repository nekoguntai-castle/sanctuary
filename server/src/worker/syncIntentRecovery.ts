import type { StrandedFullResyncWallet } from '../repositories/resyncRepository';
import type {
  IncrementalSyncRecoveryResult,
  RecoverIncrementalSyncOptions,
} from '../services/sync/syncIntentAdmission';
import type { enqueueReservedFullResyncWakeup } from '../services/workerSyncQueue';

const DEFAULT_RECOVERY_INTERVAL_MS = 60_000;
const DEFAULT_INCREMENTAL_PAGE_SIZE = 100;

type RecoveryPhase = 'full_resync' | 'incremental';

export interface SyncIntentRecoveryObservation {
  phase: RecoveryPhase;
  outcome: 'failed' | 'unavailable';
  count: number;
}

export interface SyncIntentRecoveryResult {
  fullResync: {
    scanned: number;
    enqueued: number;
    unavailable: number;
  };
  incremental: IncrementalSyncRecoveryResult;
  errors: RecoveryPhase[];
}

export interface SyncIntentRecoveryDependencies {
  findStrandedFullResyncWalletsPage: (
    cursor?: string,
  ) => Promise<StrandedFullResyncWallet[]>;
  enqueueReservedFullResyncWakeup: typeof enqueueReservedFullResyncWakeup;
  recoverIncrementalSync: (
    options: RecoverIncrementalSyncOptions,
  ) => Promise<IncrementalSyncRecoveryResult>;
  now?: () => Date;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  observe?: (observation: SyncIntentRecoveryObservation) => void;
}

export interface SyncIntentRecoveryOptions {
  intervalMs?: number;
  incrementalPageSize?: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function emptyIncrementalResult(): IncrementalSyncRecoveryResult {
  return { scanned: 0, enqueued: 0, unavailable: 0 };
}

function observeSafely(
  dependencies: SyncIntentRecoveryDependencies,
  observation: SyncIntentRecoveryObservation,
): void {
  try {
    dependencies.observe?.(observation);
  } catch {
    // Observability must never become recovery authority.
    return;
  }
}

async function recoverFullResyncs(
  dependencies: SyncIntentRecoveryDependencies,
  cursor?: string,
): Promise<SyncIntentRecoveryResult['fullResync'] & { nextCursor?: string }> {
  const stranded = await dependencies.findStrandedFullResyncWalletsPage(cursor);
  let enqueued = 0;
  for (const wallet of stranded) {
    try {
      const accepted = await dependencies.enqueueReservedFullResyncWakeup({
        walletId: wallet.id,
        generation: wallet.requestedFullResyncGeneration,
        reason: 'reconcile-stranded-full-resync',
      });
      if (accepted) enqueued += 1;
    } catch {
      // A later bounded pass revisits the authoritative requested generation.
      continue;
    }
  }
  return {
    scanned: stranded.length,
    enqueued,
    unavailable: stranded.length - enqueued,
    ...(stranded.length > 0 ? { nextCursor: stranded[stranded.length - 1]?.id } : {}),
  };
}

/**
 * Dormant worker recovery coordinator. Construction has no side effects; a
 * production composition root must inject its adapters and explicitly start it
 * in a later activation phase.
 */
export function createSyncIntentRecoveryCoordinator(
  dependencies: SyncIntentRecoveryDependencies,
  options: SyncIntentRecoveryOptions = {},
) {
  const intervalMs = positiveInteger(
    options.intervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS,
    'intervalMs',
  );
  const incrementalPageSize = positiveInteger(
    options.incrementalPageSize ?? DEFAULT_INCREMENTAL_PAGE_SIZE,
    'incrementalPageSize',
  );
  const now = dependencies.now ?? (() => new Date());
  const scheduleInterval = dependencies.setInterval ?? globalThis.setInterval;
  const cancelInterval = dependencies.clearInterval ?? globalThis.clearInterval;
  let cursor: string | undefined;
  let fullResyncCursor: string | undefined;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let inFlight: Promise<SyncIntentRecoveryResult> | null = null;
  let stopped = false;

  async function recoverOnce(): Promise<SyncIntentRecoveryResult> {
    const errors: RecoveryPhase[] = [];
    let fullResync: SyncIntentRecoveryResult['fullResync'] = {
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
    };
    try {
      const recovered = await recoverFullResyncs(dependencies, fullResyncCursor);
      const { nextCursor, ...summary } = recovered;
      fullResync = summary;
      fullResyncCursor = recovered.scanned === 0 ? undefined : recovered.nextCursor;
      if (fullResync.unavailable > 0) {
        observeSafely(dependencies, {
          phase: 'full_resync',
          outcome: 'unavailable',
          count: fullResync.unavailable,
        });
      }
    } catch {
      errors.push('full_resync');
      fullResyncCursor = undefined;
      observeSafely(dependencies, { phase: 'full_resync', outcome: 'failed', count: 1 });
    }

    let incremental = emptyIncrementalResult();
    try {
      incremental = await dependencies.recoverIncrementalSync({
        now: now(),
        ...(cursor ? { cursor } : {}),
        limit: incrementalPageSize,
      });
      cursor = incremental.scanned === 0 ? undefined : incremental.nextCursor;
      if (incremental.unavailable > 0) {
        observeSafely(dependencies, {
          phase: 'incremental',
          outcome: 'unavailable',
          count: incremental.unavailable,
        });
      }
    } catch {
      errors.push('incremental');
      cursor = undefined;
      observeSafely(dependencies, { phase: 'incremental', outcome: 'failed', count: 1 });
    }
    return { fullResync, incremental, errors };
  }

  function runNow(): Promise<SyncIntentRecoveryResult> {
    if (stopped) {
      return Promise.reject(new Error('Sync intent recovery coordinator is stopped'));
    }
    if (inFlight) return inFlight;
    inFlight = recoverOnce().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function start(): Promise<SyncIntentRecoveryResult> {
    if (stopped) throw new Error('Sync intent recovery coordinator is stopped');
    if (!timer) {
      timer = scheduleInterval(() => {
        if (!stopped) void runNow();
      }, intervalMs);
      timer.unref?.();
    }
    return runNow();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) {
      cancelInterval(timer);
      timer = null;
    }
    await inFlight;
  }

  return { runNow, start, stop };
}

export type SyncIntentRecoveryCoordinator = ReturnType<
  typeof createSyncIntentRecoveryCoordinator
>;
