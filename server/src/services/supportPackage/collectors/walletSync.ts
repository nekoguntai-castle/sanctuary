/**
 * Privacy-safe database-backed wallet sync collector.
 *
 * The legacy `wallets` collector is per-wallet, anonymized-id and raw-error
 * shaped, so admitting it would fail the final byte scan and reject the whole
 * package. This collector emits aggregate counts and fixed enum labels only.
 */
import { getConfig } from '../../../config';
import {
  getWalletSyncAggregates,
  type WalletSyncAggregates,
} from '../../../repositories/supportWalletSyncDiagnosticsRepository';
import { BITCOIN_NETWORKS, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { isWalletSyncFailureClass } from '@sanctuary/shared/constants/sync';
import { registerShareableCollector } from './registry';
import {
  MAX_WALLET_SYNC_COUNT,
  WALLET_SYNC_ERROR_CLASSES,
  walletSyncSchema,
  type FullResyncDriftBucket,
  type WalletSyncErrorClass,
} from './walletSyncSchema';

const MAX_STALE_THRESHOLD_MINUTES = 100_000;

type StatusKey = 'success' | 'failed' | 'retrying' | 'resyncing' | 'never_synced' | 'other';
type StatusCounts = Record<StatusKey, number>;
type AgeKey =
  | 'never'
  | 'lt_one_hour'
  | 'one_to_twenty_four_hours'
  | 'one_to_seven_days'
  | 'gte_seven_days';

interface NetworkSection {
  total: number;
  byStatus: StatusCounts;
  syncInProgressCount: number;
  stuckCandidatesCount: number;
  fullResyncPendingCount: number;
  incrementalPendingCount: number;
  actionRequiredCount: number;
  activeLeaseCount: number;
  expiredLeaseCount: number;
}

/** Bucket `requested - processed` full resync generations without exporting either. */
export function toFullResyncDriftBucket(drift: number): FullResyncDriftBucket {
  if (!Number.isFinite(drift) || drift <= 0) return 'none';
  if (drift === 1) return 'one';
  if (drift <= 5) return 'two_to_five';
  return 'six_plus';
}

function boundedCount(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 0), MAX_WALLET_SYNC_COUNT);
}

function boundedCounts<Key extends string>(counts: Record<Key, number>): Record<Key, number> {
  return Object.fromEntries(
    Object.entries<number>(counts).map(([key, value]) => [key, boundedCount(value)]),
  ) as Record<Key, number>;
}

function emptyStatusCounts(): StatusCounts {
  return { success: 0, failed: 0, retrying: 0, resyncing: 0, never_synced: 0, other: 0 };
}

function emptyNetworkSection(): NetworkSection {
  return {
    total: 0,
    byStatus: emptyStatusCounts(),
    syncInProgressCount: 0,
    stuckCandidatesCount: 0,
    fullResyncPendingCount: 0,
    incrementalPendingCount: 0,
    actionRequiredCount: 0,
    activeLeaseCount: 0,
    expiredLeaseCount: 0,
  };
}

function summarize(aggregates: WalletSyncAggregates, staleThresholdMs: number) {
  const byNetwork = Object.fromEntries(
    BITCOIN_NETWORKS.map((network) => [network, emptyNetworkSection()]),
  ) as Record<NetworkType, NetworkSection>;
  const byStatus = emptyStatusCounts();
  const lastSyncAgeBuckets: Record<AgeKey, number> = {
    never: 0,
    lt_one_hour: 0,
    one_to_twenty_four_hours: 0,
    one_to_seven_days: 0,
    gte_seven_days: 0,
  };
  const errorClasses = Object.fromEntries(
    WALLET_SYNC_ERROR_CLASSES.map((errorClass) => [errorClass, 0]),
  ) as Record<WalletSyncErrorClass, number>;
  let totalWallets = 0;
  let syncInProgressCount = 0;
  let stuckCandidatesCount = 0;
  let fullResyncPendingCount = 0;
  let maxFullResyncDrift = 0;
  let incrementalPendingCount = 0;
  let unclaimedIncrementalPendingCount = 0;
  let claimedIncrementalPendingCount = 0;
  let trailingIncrementalRequestCount = 0;
  let readyIncrementalPendingCount = 0;
  let maxIncrementalDrift = 0;
  let unpreparedFullResyncPendingCount = 0;
  let preparedFullResyncPendingCount = 0;
  let actionRequiredCount = 0;
  let actionRequiredPendingCount = 0;
  let orphanedActionRequiredCount = 0;
  let deferredRetryPendingCount = 0;
  let dueRetryPendingCount = 0;
  let activeLeaseCount = 0;
  let expiredLeaseCount = 0;
  let inProgressWithoutClaimCount = 0;
  let claimWithoutInProgressCount = 0;
  let incoherentLeaseCount = 0;
  let withSyncError = 0;

  for (const row of aggregates.networks) {
    totalWallets += row.total;
    byStatus.success += row.success;
    byStatus.failed += row.failed;
    byStatus.retrying += row.retrying;
    byStatus.resyncing += row.resyncing;
    byStatus.never_synced += row.neverSynced;
    byStatus.other += row.otherStatus;
    lastSyncAgeBuckets.never += row.ageNever;
    lastSyncAgeBuckets.lt_one_hour += row.ageUnderOneHour;
    lastSyncAgeBuckets.one_to_twenty_four_hours += row.ageOneToTwentyFourHours;
    lastSyncAgeBuckets.one_to_seven_days += row.ageOneToSevenDays;
    lastSyncAgeBuckets.gte_seven_days += row.ageOverSevenDays;
    syncInProgressCount += row.syncInProgress;
    stuckCandidatesCount += row.stuckCandidates;
    fullResyncPendingCount += row.fullResyncPending;
    maxFullResyncDrift = Math.max(maxFullResyncDrift, row.maxFullResyncDrift);
    incrementalPendingCount += row.incrementalPending;
    unclaimedIncrementalPendingCount += row.unclaimedIncrementalPending;
    claimedIncrementalPendingCount += row.claimedIncrementalPending;
    trailingIncrementalRequestCount += row.trailingIncrementalRequest;
    readyIncrementalPendingCount += row.readyIncrementalPending;
    maxIncrementalDrift = Math.max(maxIncrementalDrift, row.maxIncrementalDrift);
    unpreparedFullResyncPendingCount += row.unpreparedFullResyncPending;
    preparedFullResyncPendingCount += row.preparedFullResyncPending;
    actionRequiredCount += row.actionRequired;
    actionRequiredPendingCount += row.actionRequiredPending;
    orphanedActionRequiredCount += row.orphanedActionRequired;
    deferredRetryPendingCount += row.deferredRetryPending;
    dueRetryPendingCount += row.dueRetryPending;
    activeLeaseCount += row.activeLease;
    expiredLeaseCount += row.expiredLease;
    inProgressWithoutClaimCount += row.inProgressWithoutClaim;
    claimWithoutInProgressCount += row.claimWithoutInProgress;
    incoherentLeaseCount += row.incoherentLease;
    withSyncError += row.withSyncError;

    // `wallets.network` is enum-constrained on write, so an unrecognized value
    // is retained in the totals rather than given an axis it cannot belong to.
    const section = byNetwork[row.network as NetworkType];
    if (!section) continue;
    section.total += row.total;
    section.byStatus.success += row.success;
    section.byStatus.failed += row.failed;
    section.byStatus.retrying += row.retrying;
    section.byStatus.resyncing += row.resyncing;
    section.byStatus.never_synced += row.neverSynced;
    section.byStatus.other += row.otherStatus;
    section.syncInProgressCount += row.syncInProgress;
    section.stuckCandidatesCount += row.stuckCandidates;
    section.fullResyncPendingCount += row.fullResyncPending;
    section.incrementalPendingCount += row.incrementalPending;
    section.actionRequiredCount += row.actionRequired;
    section.activeLeaseCount += row.activeLease;
    section.expiredLeaseCount += row.expiredLease;
  }

  let classified = 0;
  for (const group of aggregates.errorGroups) {
    const failureClass = isWalletSyncFailureClass(group.failureClass)
      ? group.failureClass
      : 'other';
    errorClasses[failureClass] += group.count;
    classified += group.count;
  }
  // Wallets whose failure text fell outside the bounded grouping are still
  // reported, as unclassified rather than as no failure at all.
  errorClasses.other += Math.max(0, withSyncError - classified);

  return {
    observation: 'observed' as const,
    unit: 'wallet_rows' as const,
    staleThresholdMinutes: Math.min(
      Math.max(Math.round(staleThresholdMs / 60_000), 0),
      MAX_STALE_THRESHOLD_MINUTES,
    ),
    totalWallets: boundedCount(totalWallets),
    byStatus: boundedCounts(byStatus),
    byNetwork: Object.fromEntries(
      Object.entries(byNetwork).map(([network, section]) => [network, {
        total: boundedCount(section.total),
        byStatus: boundedCounts(section.byStatus),
        syncInProgressCount: boundedCount(section.syncInProgressCount),
        stuckCandidatesCount: boundedCount(section.stuckCandidatesCount),
        fullResyncPendingCount: boundedCount(section.fullResyncPendingCount),
        incrementalPendingCount: boundedCount(section.incrementalPendingCount),
        actionRequiredCount: boundedCount(section.actionRequiredCount),
        activeLeaseCount: boundedCount(section.activeLeaseCount),
        expiredLeaseCount: boundedCount(section.expiredLeaseCount),
      }]),
    ),
    syncInProgressCount: boundedCount(syncInProgressCount),
    stuckCandidatesCount: boundedCount(stuckCandidatesCount),
    lastSyncAgeBuckets: boundedCounts(lastSyncAgeBuckets),
    fullResync: {
      pendingCount: boundedCount(fullResyncPendingCount),
      maxDrift: toFullResyncDriftBucket(maxFullResyncDrift),
      unpreparedPendingCount: boundedCount(unpreparedFullResyncPendingCount),
      preparedAwaitingCompletionCount: boundedCount(preparedFullResyncPendingCount),
    },
    incremental: {
      pendingCount: boundedCount(incrementalPendingCount),
      unclaimedPendingCount: boundedCount(unclaimedIncrementalPendingCount),
      claimedPendingCount: boundedCount(claimedIncrementalPendingCount),
      trailingRequestCount: boundedCount(trailingIncrementalRequestCount),
      readyUnclaimedCount: boundedCount(readyIncrementalPendingCount),
      maxDrift: toFullResyncDriftBucket(maxIncrementalDrift),
    },
    actionRequired: {
      totalCount: boundedCount(actionRequiredCount),
      pendingIntentCount: boundedCount(actionRequiredPendingCount),
      orphanedCount: boundedCount(orphanedActionRequiredCount),
    },
    retry: {
      deferredPendingCount: boundedCount(deferredRetryPendingCount),
      duePendingCount: boundedCount(dueRetryPendingCount),
    },
    leaseAuthority: {
      activeCount: boundedCount(activeLeaseCount),
      expiredCount: boundedCount(expiredLeaseCount),
      inProgressWithoutClaimCount: boundedCount(inProgressWithoutClaimCount),
      claimWithoutInProgressCount: boundedCount(claimWithoutInProgressCount),
      incoherentCount: boundedCount(incoherentLeaseCount),
    },
    errorClasses: boundedCounts(errorClasses),
  };
}

async function collectWalletSync() {
  return Promise.resolve()
    .then(() => getConfig().sync.staleThresholdMs)
    .then(async (staleThresholdMs) => walletSyncSchema.parse(
      summarize(await getWalletSyncAggregates({ staleThresholdMs }), staleThresholdMs),
    ))
    // A degraded section keeps the rest of the package generatable.
    .catch(() => ({ observation: 'unavailable' as const }));
}

registerShareableCollector('walletSync', {
  collect: collectWalletSync,
  schema: walletSyncSchema,
  sourceProcess: 'database_shared',
  sourceKind: 'aggregate_query',
  authoritativeFor: [
    'wallet_sync_state',
    'wallet_incremental_sync_intent',
    'wallet_full_resync_intent',
    'wallet_sync_lease_row',
  ],
  notAuthoritativeFor: ['wallet_sync_execution'],
});
