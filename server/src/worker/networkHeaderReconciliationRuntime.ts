import { randomUUID } from 'node:crypto';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  claimNetworkHeaderReconciliation,
  finalizeNetworkHeaderReconciliation,
  findDueNetworkHeaderReconciliations,
  findNetworkHeaderConfirmationRetries,
  findNetworkHeaderHistory,
  observeNetworkHeader,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
  recordNetworkHeaderCursor,
  recordNetworkHeaderReconciliationFailure,
  resetNetworkHeaderCursor,
} from '../repositories/networkHeaderReconciliationRepository';
import type { NetworkHeaderReconciliationState } from '../repositories/networkHeaderReconciliationTypes';
import { setAuthoritativeBlockHeight } from '../services/bitcoin/blockchain';
import {
  refreshConfirmationRetryWalletsAtHeight,
  refreshPendingConfirmationsAtHeight,
} from '../services/sync/headerConfirmationUpdater';
import {
  createNetworkHeaderReconciler,
  type HeaderRangeFetcher,
  type HeaderReconciliationAttemptResult,
  type NetworkHeaderReconciler,
  type RawHeaderObservation,
} from '../services/sync/networkHeaderReconciler';
const DUE_SCAN_LIMIT = 20;

interface ReconciliationRuntimeDependencies {
  ownerToken: string;
  reconciler: NetworkHeaderReconciler;
  claim(
    network: NetworkType,
    ownerToken: string,
  ): Promise<NetworkHeaderReconciliationState | null>;
  findDue(limit: number): Promise<NetworkHeaderReconciliationState[]>;
  activityEpoch(): number | null;
}

interface NetworkWork {
  activityEpoch: number;
  fetchHeaders: HeaderRangeFetcher;
  tail: Promise<HeaderReconciliationAttemptResult | null>;
  pendingOperations: number;
}

export function createNetworkHeaderReconciliationRuntime(
  dependencies: ReconciliationRuntimeDependencies,
) {
  const work = new Map<NetworkType, NetworkWork>();
  let stopped = false;
  let recoveryScan: Promise<void> | null = null;

  function active(activityEpoch?: number): boolean {
    const currentEpoch = dependencies.activityEpoch();
    return !stopped
      && currentEpoch !== null
      && (activityEpoch === undefined || currentEpoch === activityEpoch);
  }

  function queue(
    network: NetworkType,
    activityEpoch: number,
    operation: () => Promise<HeaderReconciliationAttemptResult>,
  ): Promise<HeaderReconciliationAttemptResult | null> {
    const current = work.get(network)!;
    current.pendingOperations += 1;
    const previous = current.tail;
    const tail = previous
      .catch(() => null)
      .then(async () => active(activityEpoch) ? operation() : null)
      .finally(() => {
        current.pendingOperations -= 1;
      });
    current.tail = tail;
    return tail;
  }

  async function observe(
    network: NetworkType,
    observation: RawHeaderObservation,
    fetchHeaders: HeaderRangeFetcher,
  ): Promise<HeaderReconciliationAttemptResult | null> {
    const activityEpoch = dependencies.activityEpoch();
    if (stopped || activityEpoch === null) return null;
    const existing = work.get(network);
    if (existing) {
      existing.activityEpoch = activityEpoch;
      existing.fetchHeaders = fetchHeaders;
    } else {
      work.set(network, {
        activityEpoch,
        fetchHeaders,
        tail: Promise.resolve(null),
        pendingOperations: 0,
      });
    }
    return queue(network, activityEpoch, () => dependencies.reconciler.observe(
      network,
      dependencies.ownerToken,
      observation,
      fetchHeaders,
      () => active(activityEpoch),
    ));
  }

  async function recoverState(
    state: NetworkHeaderReconciliationState,
  ): Promise<HeaderReconciliationAttemptResult | null> {
    const current = work.get(state.network);
    if (!current || !active(current.activityEpoch) || current.pendingOperations > 0) return null;
    const activityEpoch = current.activityEpoch;
    return queue(state.network, activityEpoch, async () => {
      const claimed = await dependencies.claim(state.network, dependencies.ownerToken);
      if (!claimed) return { status: 'deferred', failureClass: 'ownership_lost' };
      return dependencies.reconciler.attempt(
        claimed,
        current.fetchHeaders,
        () => active(activityEpoch),
      );
    });
  }

  async function runRecoveryScan(): Promise<void> {
    const states = await dependencies.findDue(DUE_SCAN_LIMIT);
    await Promise.all(states.map(recoverState));
  }

  function recoverDue(): Promise<void> {
    if (!active()) return Promise.resolve();
    if (recoveryScan) return recoveryScan;
    recoveryScan = runRecoveryScan().finally(() => {
      recoveryScan = null;
    });
    return recoveryScan;
  }

  async function stop(): Promise<void> {
    stopped = true;
    const tails = [...work.values()].map(({ tail }) => tail);
    if (recoveryScan) tails.push(recoveryScan.then(() => null));
    await Promise.allSettled(tails);
    work.clear();
  }

  return { observe, recoverDue, stop };
}

export type NetworkHeaderReconciliationRuntime = ReturnType<
  typeof createNetworkHeaderReconciliationRuntime
>;

export function createProductionNetworkHeaderReconciliationRuntime(
  activityEpoch: () => number | null,
): NetworkHeaderReconciliationRuntime {
  const repository = {
    observe: observeNetworkHeader,
    recordCursor: recordNetworkHeaderCursor,
    recordNetworkHeaderConfirmationPage,
    findNetworkHeaderConfirmationRetries,
    recordNetworkHeaderConfirmationRetryResult,
    resetCursor: resetNetworkHeaderCursor,
    recordFailure: recordNetworkHeaderReconciliationFailure,
    findHistory: findNetworkHeaderHistory,
    finalize: finalizeNetworkHeaderReconciliation,
  };
  const reconciler = createNetworkHeaderReconciler({
    repository,
    refreshConfirmations: (network, height, afterWalletId, isActive) => (
      refreshPendingConfirmationsAtHeight(network, height, isActive, afterWalletId)
    ),
    refreshConfirmationRetryWallets: (_network, height, walletIds, isActive) => (
      refreshConfirmationRetryWalletsAtHeight(walletIds, height, isActive)
    ),
    setAuthoritativeHeight: setAuthoritativeBlockHeight,
  });
  return createNetworkHeaderReconciliationRuntime({
    ownerToken: randomUUID(),
    reconciler,
    claim: claimNetworkHeaderReconciliation,
    findDue: findDueNetworkHeaderReconciliations,
    activityEpoch,
  });
}
