import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import type { IncrementalSyncIntentState } from './types';

const MAX_RECOVERY_BATCH_SIZE = 100;

const syncIntentSelect = {
  id: true,
  requestedIncrementalSyncGeneration: true,
  claimedIncrementalSyncGeneration: true,
  processedIncrementalSyncGeneration: true,
  incrementalSyncLeaseToken: true,
  incrementalSyncClaimedAt: true,
  incrementalSyncLeaseExpiresAt: true,
  syncRetryCount: true,
  syncNextRetryAt: true,
  syncActionRequiredAt: true,
  requestedFullResyncGeneration: true,
  preparedFullResyncGeneration: true,
  processedFullResyncGeneration: true,
} satisfies Prisma.WalletSelect;

function recoveryLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_RECOVERY_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Sync intent recovery limit must be a positive integer');
  }
  return Math.min(limit, MAX_RECOVERY_BATCH_SIZE);
}

export async function findIncrementalSyncIntent(
  walletId: string,
): Promise<IncrementalSyncIntentState | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    select: syncIntentSelect,
  }) as Promise<IncrementalSyncIntentState | null>;
}

/**
 * Read a bounded, stable page of unfinished intent that is due for admission
 * or whose database lease is reclaimable. The canonical service must still
 * prove the external execution lock is absent before reclaiming a claim.
 */
export async function findActionableIncrementalSyncIntents(options: {
  now: Date;
  cursor?: string;
  limit?: number;
}): Promise<IncrementalSyncIntentState[]> {
  const limit = recoveryLimit(options.limit);
  const cursor = options.cursor ?? '';

  return prisma.$queryRaw<IncrementalSyncIntentState[]>(Prisma.sql`
    SELECT
      "id",
      "requestedIncrementalSyncGeneration",
      "claimedIncrementalSyncGeneration",
      "processedIncrementalSyncGeneration",
      "incrementalSyncLeaseToken",
      "incrementalSyncClaimedAt",
      "incrementalSyncLeaseExpiresAt",
      "syncRetryCount",
      "syncNextRetryAt",
      "syncActionRequiredAt",
      "requestedFullResyncGeneration",
      "preparedFullResyncGeneration",
      "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "id" > ${cursor}
      AND "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      AND (
        "syncNextRetryAt" IS NULL
        OR "syncNextRetryAt" <= ${options.now}
      )
      AND (
        "claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"
        OR "incrementalSyncLeaseExpiresAt" <= ${options.now}
      )
    ORDER BY "id" ASC
    LIMIT ${limit}
  `);
}

export const syncIntentRepository = {
  findIncrementalSyncIntent,
  findActionableIncrementalSyncIntents,
};

export default syncIntentRepository;
