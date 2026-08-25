import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';

export const WALLET_SYNC_RETIREMENT_LOCK_KEY =
  'sanctuary:wallet-sync:scheduler-retirement:v1';

/** Serialize irreversible scheduler cutover, stale admission, and restore. */
export async function acquireWalletSyncRetirementLock(
  tx: PrismaTxClient,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${WALLET_SYNC_RETIREMENT_LOCK_KEY}, 0)
    )
  `);
}

/** Hold the retirement lock across a bounded cross-store compatibility action. */
export async function withWalletSyncRetirementLock<T>(
  operation: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await acquireWalletSyncRetirementLock(tx);
    return operation(tx);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 60_000,
  });
}
