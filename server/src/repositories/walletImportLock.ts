import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';

const WALLET_IMPORT_LOCK_NAMESPACE = 'sanctuary:wallet-import:v1:';

/** Serialize wallet-import admission for one user across all server processes. */
export async function lockWalletImportForUser(
  tx: PrismaTxClient,
  userId: string,
): Promise<void> {
  const lockKey = `${WALLET_IMPORT_LOCK_NAMESPACE}${userId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

/** Hold the per-user import lock until the callback commits or rolls back. */
export async function withWalletImportTransaction<T>(
  userId: string,
  operation: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  // Read Committed lets the post-lock query see the previous holder's committed wallet.
  return prisma.$transaction(async (tx) => {
    await lockWalletImportForUser(tx, userId);
    return operation(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
