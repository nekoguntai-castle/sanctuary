/**
 * Aggregate-only database observation for wallet sync state.
 *
 * The SQL performs all grouping in PostgreSQL and returns counts per network
 * plus bounded persisted failure classes. Wallet identities, names,
 * descriptors, addresses, raw errors, and per-wallet rows never cross the
 * repository boundary.
 */
import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';

/** One row per distinct `wallets.network` value present in the database. */
export interface WalletSyncNetworkAggregate {
  network: string;
  total: number;
  success: number;
  failed: number;
  retrying: number;
  resyncing: number;
  neverSynced: number;
  otherStatus: number;
  syncInProgress: number;
  stuckCandidates: number;
  ageNever: number;
  ageUnderOneHour: number;
  ageOneToTwentyFourHours: number;
  ageOneToSevenDays: number;
  ageOverSevenDays: number;
  fullResyncPending: number;
  maxFullResyncDrift: number;
  incrementalPending: number;
  unclaimedIncrementalPending: number;
  claimedIncrementalPending: number;
  trailingIncrementalRequest: number;
  readyIncrementalPending: number;
  maxIncrementalDrift: number;
  unpreparedFullResyncPending: number;
  preparedFullResyncPending: number;
  actionRequired: number;
  actionRequiredPending: number;
  orphanedActionRequired: number;
  deferredRetryPending: number;
  dueRetryPending: number;
  activeLease: number;
  expiredLease: number;
  inProgressWithoutClaim: number;
  claimWithoutInProgress: number;
  incoherentLease: number;
  withSyncError: number;
}

/** Persisted failure class with its wallet count. */
export interface WalletSyncErrorGroup {
  failureClass: string;
  count: number;
}

export interface WalletSyncAggregates {
  networks: WalletSyncNetworkAggregate[];
  errorGroups: WalletSyncErrorGroup[];
}

const QUERY_TIMEOUT_MS = 2_000;

/**
 * The schema bounds failure classes; this cap remains a fail-safe for malformed
 * legacy databases rather than cardinality control for raw error text.
 */
const MAX_ERROR_GROUPS = 200;

/** Return only aggregate counts and bounded failure classes for wallet sync. */
export async function getWalletSyncAggregates(
  options: { staleThresholdMs: number },
): Promise<WalletSyncAggregates> {
  const staleThresholdSeconds = Math.max(0, Math.floor(options.staleThresholdMs / 1000));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, true)`,
    );
    const networks = await tx.$queryRaw<WalletSyncNetworkAggregate[]>(Prisma.sql`
      SELECT
        "network",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "lastSyncStatus" = 'success')::int AS "success",
        COUNT(*) FILTER (WHERE "lastSyncStatus" = 'failed')::int AS "failed",
        COUNT(*) FILTER (WHERE "lastSyncStatus" = 'retrying')::int AS "retrying",
        COUNT(*) FILTER (WHERE "lastSyncStatus" = 'resyncing')::int AS "resyncing",
        COUNT(*) FILTER (WHERE "lastSyncStatus" IS NULL)::int AS "neverSynced",
        COUNT(*) FILTER (
          WHERE "lastSyncStatus" IS NOT NULL
            AND "lastSyncStatus" NOT IN ('success', 'failed', 'retrying', 'resyncing')
        )::int AS "otherStatus",
        COUNT(*) FILTER (WHERE "syncInProgress")::int AS "syncInProgress",
        -- syncStartedAt is the attempt clock. Null remains a candidate for
        -- legacy active rows that predate the structured lifecycle contract.
        COUNT(*) FILTER (
          WHERE "syncInProgress"
            AND (
              "syncStartedAt" IS NULL
              OR "syncStartedAt" < NOW() - make_interval(secs => ${staleThresholdSeconds}::double precision)
            )
        )::int AS "stuckCandidates",
        COUNT(*) FILTER (WHERE "lastSyncedAt" IS NULL)::int AS "ageNever",
        COUNT(*) FILTER (
          WHERE "lastSyncedAt" >= NOW() - interval '1 hour'
        )::int AS "ageUnderOneHour",
        COUNT(*) FILTER (
          WHERE "lastSyncedAt" < NOW() - interval '1 hour'
            AND "lastSyncedAt" >= NOW() - interval '24 hours'
        )::int AS "ageOneToTwentyFourHours",
        COUNT(*) FILTER (
          WHERE "lastSyncedAt" < NOW() - interval '24 hours'
            AND "lastSyncedAt" >= NOW() - interval '7 days'
        )::int AS "ageOneToSevenDays",
        COUNT(*) FILTER (
          WHERE "lastSyncedAt" < NOW() - interval '7 days'
        )::int AS "ageOverSevenDays",
        COUNT(*) FILTER (
          WHERE "requestedFullResyncGeneration" > "processedFullResyncGeneration"
        )::int AS "fullResyncPending",
        COALESCE(
          MAX("requestedFullResyncGeneration" - "processedFullResyncGeneration"), 0
        )::int AS "maxFullResyncDrift",
        COUNT(*) FILTER (
          WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "incrementalPending",
        COUNT(*) FILTER (
          WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
            AND "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
        )::int AS "unclaimedIncrementalPending",
        COUNT(*) FILTER (
          WHERE "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "claimedIncrementalPending",
        COUNT(*) FILTER (
          WHERE "requestedIncrementalSyncGeneration" > "claimedIncrementalSyncGeneration"
            AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "trailingIncrementalRequest",
        COUNT(*) FILTER (
          WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
            AND "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
            AND "syncActionRequiredAt" IS NULL
            AND ("syncNextRetryAt" IS NULL OR "syncNextRetryAt" <= NOW())
            AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
        )::int AS "readyIncrementalPending",
        COALESCE(
          MAX("requestedIncrementalSyncGeneration" - "processedIncrementalSyncGeneration"), 0
        )::int AS "maxIncrementalDrift",
        COUNT(*) FILTER (
          WHERE "requestedFullResyncGeneration" > "preparedFullResyncGeneration"
        )::int AS "unpreparedFullResyncPending",
        COUNT(*) FILTER (
          WHERE "preparedFullResyncGeneration" > "processedFullResyncGeneration"
        )::int AS "preparedFullResyncPending",
        COUNT(*) FILTER (WHERE "syncActionRequiredAt" IS NOT NULL)::int AS "actionRequired",
        COUNT(*) FILTER (
          WHERE "syncActionRequiredAt" IS NOT NULL
            AND (
              "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
              OR "requestedFullResyncGeneration" > "processedFullResyncGeneration"
            )
        )::int AS "actionRequiredPending",
        COUNT(*) FILTER (
          WHERE "syncActionRequiredAt" IS NOT NULL
            AND "requestedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
            AND "requestedFullResyncGeneration" = "processedFullResyncGeneration"
        )::int AS "orphanedActionRequired",
        COUNT(*) FILTER (
          WHERE "syncNextRetryAt" > NOW()
            AND "syncActionRequiredAt" IS NULL
            AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "deferredRetryPending",
        COUNT(*) FILTER (
          WHERE "syncNextRetryAt" <= NOW()
            AND "syncActionRequiredAt" IS NULL
            AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "dueRetryPending",
        COUNT(*) FILTER (
          WHERE "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
            AND "incrementalSyncLeaseToken" IS NOT NULL
            AND "incrementalSyncClaimedAt" IS NOT NULL
            AND "incrementalSyncLeaseExpiresAt" > NOW()
        )::int AS "activeLease",
        COUNT(*) FILTER (
          WHERE "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
            AND "incrementalSyncLeaseToken" IS NOT NULL
            AND "incrementalSyncClaimedAt" IS NOT NULL
            AND "incrementalSyncLeaseExpiresAt" <= NOW()
        )::int AS "expiredLease",
        COUNT(*) FILTER (
          WHERE "syncInProgress"
            AND "claimedIncrementalSyncGeneration" <= "processedIncrementalSyncGeneration"
        )::int AS "inProgressWithoutClaim",
        COUNT(*) FILTER (
          WHERE NOT "syncInProgress"
            AND "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
        )::int AS "claimWithoutInProgress",
        COUNT(*) FILTER (
          WHERE "processedIncrementalSyncGeneration" > "claimedIncrementalSyncGeneration"
            OR "claimedIncrementalSyncGeneration" > "requestedIncrementalSyncGeneration"
            OR (
              "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
              AND num_nonnulls(
                "incrementalSyncLeaseToken",
                "incrementalSyncClaimedAt",
                "incrementalSyncLeaseExpiresAt"
              ) <> 3
            )
            OR (
              "claimedIncrementalSyncGeneration" <= "processedIncrementalSyncGeneration"
              AND num_nonnulls(
                "incrementalSyncLeaseToken",
                "incrementalSyncClaimedAt",
                "incrementalSyncLeaseExpiresAt"
              ) <> 0
            )
            OR "incrementalSyncLeaseExpiresAt" <= "incrementalSyncClaimedAt"
        )::int AS "incoherentLease",
        COUNT(*) FILTER (WHERE "lastSyncError" IS NOT NULL)::int AS "withSyncError"
      FROM "wallets"
      GROUP BY "network"
    `);
    const errorGroups = await tx.$queryRaw<WalletSyncErrorGroup[]>(Prisma.sql`
      SELECT COALESCE("lastSyncFailureClass", 'other') AS "failureClass",
             COUNT(*)::int AS "count"
      FROM "wallets"
      WHERE "lastSyncError" IS NOT NULL
      GROUP BY COALESCE("lastSyncFailureClass", 'other')
      ORDER BY COUNT(*) DESC, COALESCE("lastSyncFailureClass", 'other') ASC
      LIMIT ${MAX_ERROR_GROUPS}
    `);
    return { networks, errorGroups };
  }, { timeout: QUERY_TIMEOUT_MS });
}
