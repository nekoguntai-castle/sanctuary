import { getRedisClient } from '../infrastructure';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';
import { findStrandedFullResyncWalletsPage } from '../repositories/resyncRepository';
import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';
import {
  walletSyncActivationGate,
  type WalletSyncActivationState,
} from '../services/sync/walletSyncActivationGate';
import {
  createSyncIntentRecoveryCoordinator,
  type SyncIntentRecoveryCoordinator,
} from './syncIntentRecovery';

const ACTIVATION_RECONCILIATION_INTERVAL_MS = 10_000;

export interface WalletSyncRecoveryRuntimeDependencies {
  activate: () => Promise<WalletSyncActivationState>;
  coordinator: SyncIntentRecoveryCoordinator;
  redis: {
    on(event: 'ready', listener: () => void): unknown;
    removeListener(event: 'ready', listener: () => void): unknown;
  };
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

/**
 * Owns the process-local activation/recovery loop. Calls are coalesced so a
 * Redis reconnect that arrives during a periodic activation check is retained
 * as one follow-up recovery request instead of starting concurrent scans.
 */
export function createWalletSyncRecoveryRuntime(
  dependencies: WalletSyncRecoveryRuntimeDependencies,
) {
  const scheduleInterval = dependencies.setInterval ?? globalThis.setInterval;
  const cancelInterval = dependencies.clearInterval ?? globalThis.clearInterval;
  let state: WalletSyncActivationState = {
    status: 'dormant',
    requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  };
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let recoveryRequested = false;
  let recoveryStarted = false;
  let stopped = false;

  async function reconcile(runRecovery: boolean): Promise<void> {
    try {
      state = await dependencies.activate();
    } catch {
      state = {
        status: 'unavailable',
        requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        reason: 'policy_unavailable',
      };
      return;
    }
    if (stopped || state.status !== 'active') return;
    try {
      if (!recoveryStarted) {
        await dependencies.coordinator.start();
        recoveryStarted = true;
        return;
      }
      if (runRecovery) await dependencies.coordinator.runNow();
    } catch {
      state = {
        status: 'unavailable',
        requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        reason: 'recovery_unavailable',
      };
    }
  }

  async function drainReconciliation(): Promise<void> {
    // A boolean latch collapses any number of reconnect events during one pass
    // into a single follow-up. New events during that follow-up remain latched,
    // so recovery is never concurrent and no requested repair is lost.
    do {
      const runRecovery = recoveryRequested;
      recoveryRequested = false;
      await reconcile(runRecovery);
    } while (!stopped && recoveryRequested);
  }

  function run(runRecovery: boolean): Promise<void> {
    if (stopped) return Promise.resolve();
    recoveryRequested ||= runRecovery;
    if (inFlight) return inFlight;
    inFlight = drainReconciliation().finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const onRedisReady = (): void => {
    void run(true);
  };

  async function start(): Promise<void> {
    if (stopped) throw new Error('Wallet-sync recovery runtime is stopped');
    if (!timer) {
      dependencies.redis.on('ready', onRedisReady);
      timer = scheduleInterval(() => void run(false), ACTIVATION_RECONCILIATION_INTERVAL_MS);
      timer.unref?.();
    }
    await run(true);
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    dependencies.redis.removeListener('ready', onRedisReady);
    if (timer) {
      cancelInterval(timer);
      timer = null;
    }
    // Let the current activation check observe `stopped` before the coordinator
    // and its queue dependencies are drained by worker shutdown.
    await inFlight;
    await dependencies.coordinator.stop();
  }

  function getActivationState(): WalletSyncActivationState {
    return state;
  }

  return { getActivationState, start, stop };
}

export type WalletSyncRecoveryRuntime = ReturnType<
  typeof createWalletSyncRecoveryRuntime
>;

/**
 * Compose the sole production recovery authority. Construction fails closed
 * without Redis, and each full-resync wake-up plus both incremental adapters
 * re-enter the live activation gate before touching queue or reclaim state.
 */
export function createProductionWalletSyncRecoveryRuntime(
): WalletSyncRecoveryRuntime {
  const authorize = async (): Promise<boolean> => (
    (await walletSyncActivationGate.inspect()).status === 'active'
  );
  const coordinator = createSyncIntentRecoveryCoordinator({
    authorize,
    findStrandedFullResyncWalletsPage,
    enqueueReservedFullResyncWakeup: async (wakeup) => {
      if (!await authorize()) return { status: 'blocked' };
      const enqueued = await syncIntentAdmission.wakeReservedFullResync(wakeup);
      return { status: enqueued ? 'enqueued' : 'unavailable' };
    },
    recoverIncrementalSync: (options) => syncIntentAdmission.recover(options),
    recoverExpiredIncrementalSync: (options) => syncIntentAdmission.recoverExpired(options),
  });
  const redis = getRedisClient();
  if (!redis) throw new Error('Wallet-sync recovery requires Redis');
  return createWalletSyncRecoveryRuntime({
    activate: () => walletSyncActivationGate.activate(),
    coordinator,
    redis,
  });
}
