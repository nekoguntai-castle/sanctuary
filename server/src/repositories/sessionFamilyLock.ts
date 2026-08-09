import type { PrismaTxClient } from '../models/prisma';

/** Serialize all mutation decisions for one stable refresh-session family. */
export async function lockRefreshSessionFamily(
  tx: PrismaTxClient,
  sessionFamilyId: string
): Promise<void> {
  // The Prisma PostgreSQL driver cannot deserialize the function's `void`
  // result through `$queryRaw`. Execute it as a statement so only the command
  // count crosses the adapter boundary while the transaction retains the lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionFamilyId}, 0))`;
}
