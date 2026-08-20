import { z } from 'zod';
import { BITCOIN_NETWORKS, type NetworkType } from '@sanctuary/shared/constants/bitcoin';

/** Upper bound on every exported count; larger populations are clamped, not leaked. */
export const MAX_WALLET_SYNC_COUNT = 1_000_000;

/**
 * Fixed failure taxonomy. Only these labels are exported; the `lastSyncError`
 * text they are derived from can carry relayed server output and never leaves
 * the collector.
 */
export const WALLET_SYNC_ERROR_CLASSES = [
  'electrum_unavailable',
  'node_rpc_unavailable',
  'descriptor_policy_missing',
  'canonical_evidence_missing',
  'evidence_authentication_failed',
  'lock_contention',
  'timeout',
  'sync_cancelled',
  'database_unavailable',
  'other',
] as const;

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
    }).strict(),
    errorClasses: errorClassesSchema,
  }).strict(),
  z.object({ observation: z.literal('unavailable') }).strict(),
]);

export type WalletSyncErrorClass = typeof WALLET_SYNC_ERROR_CLASSES[number];
export type FullResyncDriftBucket = z.infer<typeof fullResyncDriftBucketSchema>;
