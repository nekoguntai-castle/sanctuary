/**
 * Aggregate-only database observation for wallet sync state.
 *
 * The SQL performs all grouping in PostgreSQL and returns counts per network
 * plus deduplicated failure text. Wallet identities, names, descriptors,
 * addresses, and per-wallet rows never cross the repository boundary. The
 * failure text returned here is classified into fixed labels by the collector
 * and is never itself exported.
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
  withSyncError: number;
}

/** Deduplicated failure text with its wallet count, bounded by MAX_ERROR_GROUPS. */
export interface WalletSyncErrorGroup {
  message: string;
  count: number;
}

export interface WalletSyncAggregates {
  networks: WalletSyncNetworkAggregate[];
  errorGroups: WalletSyncErrorGroup[];
}

const QUERY_TIMEOUT_MS = 2_000;

/**
 * Distinct failure strings are unbounded in principle. The collector treats the
 * difference between `withSyncError` and the returned counts as unclassified,
 * so a truncated grouping under-reports classes rather than losing wallets.
 */
const MAX_ERROR_GROUPS = 200;

/** Return only aggregate counts and deduplicated failure text for wallet sync. */
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
        -- A wallet whose reset cleared lastSyncedAt is indistinguishable from one
        -- that has been in flight since before the cutoff, so both are candidates.
        COUNT(*) FILTER (
          WHERE "syncInProgress"
            AND (
              "lastSyncedAt" IS NULL
              OR "lastSyncedAt" < NOW() - make_interval(secs => ${staleThresholdSeconds}::double precision)
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
        COUNT(*) FILTER (WHERE "lastSyncError" IS NOT NULL)::int AS "withSyncError"
      FROM "wallets"
      GROUP BY "network"
    `);
    const errorGroups = await tx.$queryRaw<WalletSyncErrorGroup[]>(Prisma.sql`
      SELECT "lastSyncError" AS "message", COUNT(*)::int AS "count"
      FROM "wallets"
      WHERE "lastSyncError" IS NOT NULL
      GROUP BY "lastSyncError"
      ORDER BY COUNT(*) DESC, "lastSyncError" ASC
      LIMIT ${MAX_ERROR_GROUPS}
    `);
    return { networks, errorGroups };
  }, { timeout: QUERY_TIMEOUT_MS });
}
