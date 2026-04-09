/**
 * Polling Mode Manager
 *
 * Manages the dynamic switching between in-process polling and worker-delegated polling.
 * When the background worker is healthy, polling is delegated to it.
 * When the worker is unhealthy, the API server takes over with in-process intervals.
 */

import { getConfig } from '../../config';
import { createLogger } from '../../utils/logger';
import { getWorkerHealthStatus } from '../workerHealth';
import { syncPollingModeTransitions } from '../../observability/metrics';
import type { SyncState, PollingMode } from './types';

const log = createLogger('SYNC:POLL');

/**
 * Mutable references to interval handles, owned by the caller (SyncService).
 * The polling manager reads and writes these so the class instance stays in sync
 * with what the tests inspect via bracket notation.
 */
export interface PollingIntervalRefs {
  syncInterval: NodeJS.Timeout | null;
  confirmationInterval: NodeJS.Timeout | null;
}

/**
 * Start in-process polling intervals (stale wallet checks + confirmation updates).
 * Guarded against double-start via the refs.
 *
 * @param refs - Mutable interval handle references owned by the caller.
 * @param state - Shared sync state (pollingMode is updated).
 * @param onCheckStale - Callback invoked on each stale-wallet check tick.
 * @param onUpdateConfirmations - Callback invoked on each confirmation update tick.
 */
export function startPollingIntervals(
  refs: PollingIntervalRefs,
  state: SyncState,
  onCheckStale: () => void,
  onUpdateConfirmations: () => void,
): void {
  if (refs.syncInterval) return; // already running

  const syncConfig = getConfig().sync;

  refs.syncInterval = setInterval(onCheckStale, syncConfig.intervalMs);
  refs.confirmationInterval = setInterval(onUpdateConfirmations, syncConfig.confirmationUpdateIntervalMs);

  const previousMode = state.pollingMode;
  state.pollingMode = 'in-process';
  if (previousMode !== 'in-process') {
    syncPollingModeTransitions.inc({ from: previousMode, to: 'in-process' });
  }
  log.warn('[SYNC] Worker unhealthy — in-process polling intervals started');
}

/**
 * Stop in-process polling intervals (worker is handling them).
 *
 * @param refs - Mutable interval handle references owned by the caller.
 * @param state - Shared sync state (pollingMode is updated).
 */
export function stopPollingIntervals(
  refs: PollingIntervalRefs,
  state: SyncState,
): void {
  if (refs.syncInterval) {
    clearInterval(refs.syncInterval);
    refs.syncInterval = null;
  }
  if (refs.confirmationInterval) {
    clearInterval(refs.confirmationInterval);
    refs.confirmationInterval = null;
  }

  const previousMode = state.pollingMode;
  state.pollingMode = 'worker-delegated';
  if (previousMode !== 'worker-delegated') {
    syncPollingModeTransitions.inc({ from: previousMode, to: 'worker-delegated' });
  }
  log.info('[SYNC] Worker recovered — polling delegated to worker');
}

/**
 * Re-evaluate whether to run sync/confirmation intervals in-process
 * based on the current worker health status.
 *
 * @param refs - Mutable interval handle references owned by the caller.
 * @param state - Shared sync state.
 * @param onCheckStale - Callback for stale-wallet check (forwarded to startPollingIntervals).
 * @param onUpdateConfirmations - Callback for confirmation updates (forwarded to startPollingIntervals).
 */
export function evaluatePollingMode(
  refs: PollingIntervalRefs,
  state: SyncState,
  onCheckStale: () => void,
  onUpdateConfirmations: () => void,
): void {
  if (!state.isRunning) return;

  const workerHealthy = getWorkerHealthStatus().healthy;
  const currentMode: PollingMode = state.pollingMode;

  if (workerHealthy && currentMode === 'in-process') {
    // Worker recovered — hand off polling
    stopPollingIntervals(refs, state);
  } else if (!workerHealthy && currentMode === 'worker-delegated') {
    // Worker went down — take over polling
    startPollingIntervals(refs, state, onCheckStale, onUpdateConfirmations);
  }
}
