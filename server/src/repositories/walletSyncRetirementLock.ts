import { Prisma } from '../generated/prisma/client';
import type { PrismaTxClient } from '../models/prisma';

export const WALLET_SYNC_RETIREMENT_LOCK_KEY =
  'sanctuary:wallet-sync:scheduler-retirement:v1';

/**
 * Serialize restore with the scheduler cutover that v0.8.67-v0.8.84 binaries
 * may still run against the same database during a rollback.
 */
export async function acquireWalletSyncRetirementLock(
  tx: PrismaTxClient,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${WALLET_SYNC_RETIREMENT_LOCK_KEY}, 0)
    )
  `);
}
