import { z } from 'zod';
import { BITCOIN_NETWORKS, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  WALLET_SYNC_FAILURE_CLASS_VALUES,
  type WalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';

/** Upper bound on every exported count; larger populations are clamped, not leaked. */
export const MAX_WALLET_SYNC_COUNT = 1_000_000;

/**
 * Fixed privacy-safe failure taxonomy. Classification is persisted beside the
 * raw error so support aggregation exports only these labels, never error text.
 */
export const WALLET_SYNC_ERROR_CLASSES = WALLET_SYNC_FAILURE_CLASS_VALUES;

export const fullResyncDriftBucketSchema = z.enum([
  'none',
  'one',
  'two_to_five',
  'six_plus',
]);

const boundedCountSchema = z.number().int().min(0).max(MAX_WALLET_SYNC_COUNT);

/** `other` retains 'partial' and any future legacy status with no current writer. */
const statusCountsSchema = z.object({
  success: boundedCountSchema,
  failed: boundedCountSchema,
  retrying: boundedCountSchema,
  resyncing: boundedCountSchema,
  never_synced: boundedCountSchema,
  other: boundedCountSchema,
}).strict();

const networkSectionSchema = z.object({
  total: boundedCountSchema,
  byStatus: statusCountsSchema,
  syncInProgressCount: boundedCountSchema,
  stuckCandidatesCount: boundedCountSchema,
  fullResyncPendingCount: boundedCountSchema,
  incrementalPendingCount: boundedCountSchema,
  actionRequiredCount: boundedCountSchema,
  activeLeaseCount: boundedCountSchema,
  expiredLeaseCount: boundedCountSchema,
}).strict();

const byNetworkSchema = z.object(
  Object.fromEntries(
    BITCOIN_NETWORKS.map((network) => [network, networkSectionSchema]),
  ) as Record<NetworkType, typeof networkSectionSchema>,
).strict();

const errorClassesSchema = z.object(
  Object.fromEntries(
    WALLET_SYNC_ERROR_CLASSES.map((errorClass) => [errorClass, boundedCountSchema]),
  ) as Record<WalletSyncErrorClass, typeof boundedCountSchema>,
).strict();

export const walletSyncSchema = z.discriminatedUnion('observation', [
  z.object({
    observation: z.literal('observed'),
    unit: z.literal('wallet_rows'),
    /** Context for stuckCandidatesCount; without it the count is uninterpretable. */
    staleThresholdMinutes: z.number().int().min(0).max(100_000),
    totalWallets: boundedCountSchema,
    byStatus: statusCountsSchema,
    byNetwork: byNetworkSchema,
    syncInProgressCount: boundedCountSchema,
    stuckCandidatesCount: boundedCountSchema,
    lastSyncAgeBuckets: z.object({
      never: boundedCountSchema,
      lt_one_hour: boundedCountSchema,
      one_to_twenty_four_hours: boundedCountSchema,
      one_to_seven_days: boundedCountSchema,
      gte_seven_days: boundedCountSchema,
    }).strict(),
    fullResync: z.object({
      pendingCount: boundedCountSchema,
      maxDrift: fullResyncDriftBucketSchema,
      unpreparedPendingCount: boundedCountSchema,
      preparedAwaitingCompletionCount: boundedCountSchema,
    }).strict(),
    incremental: z.object({
      pendingCount: boundedCountSchema,
      unclaimedPendingCount: boundedCountSchema,
      claimedPendingCount: boundedCountSchema,
      trailingRequestCount: boundedCountSchema,
      readyUnclaimedCount: boundedCountSchema,
      maxDrift: fullResyncDriftBucketSchema,
    }).strict(),
    actionRequired: z.object({
      totalCount: boundedCountSchema,
      pendingIntentCount: boundedCountSchema,
      orphanedCount: boundedCountSchema,
    }).strict(),
    retry: z.object({
      deferredPendingCount: boundedCountSchema,
      duePendingCount: boundedCountSchema,
    }).strict(),
    leaseAuthority: z.object({
      activeCount: boundedCountSchema,
      expiredCount: boundedCountSchema,
      inProgressWithoutClaimCount: boundedCountSchema,
      claimWithoutInProgressCount: boundedCountSchema,
      incoherentCount: boundedCountSchema,
    }).strict(),
    errorClasses: errorClassesSchema,
  }).strict(),
  z.object({ observation: z.literal('unavailable') }).strict(),
]);

export type WalletSyncErrorClass = WalletSyncFailureClass;
export type FullResyncDriftBucket = z.infer<typeof fullResyncDriftBucketSchema>;
