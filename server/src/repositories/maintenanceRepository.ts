/**
 * Maintenance Repository
 *
 * Abstracts database operations for maintenance tasks:
 * cleanup of price data, fee estimates, expired drafts/tokens,
 * weekly VACUUM/REINDEX, monthly stale record cleanup,
 * backup export/restore, and migration tracking.
 */

import prisma from '../models/prisma';

// Transaction client type extracted from Prisma's $transaction callback signature
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ============================================================================
// Data cleanup
// ============================================================================

/**
 * Delete price data older than a cutoff date
 */
export async function deletePriceDataBefore(cutoff: Date): Promise<number> {
  const result = await prisma.priceData.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Delete fee estimates older than a cutoff date
 */
export async function deleteFeeEstimatesBefore(cutoff: Date): Promise<number> {
  const result = await prisma.feeEstimate.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Delete expired draft transactions
 */
export async function deleteExpiredDrafts(): Promise<number> {
  const result = await prisma.draftTransaction.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

/**
 * Delete expired refresh tokens
 */
export async function deleteExpiredRefreshTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

// ============================================================================
// Database maintenance
// ============================================================================

/**
 * Run VACUUM ANALYZE with a statement timeout (milliseconds)
 */
export async function vacuumAnalyze(timeoutMs = 300000): Promise<void> {
  await prisma.$executeRaw`SET statement_timeout = ${String(timeoutMs)}`;
  try {
    await prisma.$executeRaw`VACUUM ANALYZE`;
  } finally {
    await prisma.$executeRaw`SET statement_timeout = '0'`;
  }
}

/**
 * REINDEX heavily-updated tables.
 * Each table is a separate static query for injection safety.
 */
export async function reindexHeavyTables(): Promise<string[]> {
  const tables = ['audit_logs', 'transactions', 'utxos'];
  await prisma.$executeRaw`REINDEX TABLE audit_logs`;
  await prisma.$executeRaw`REINDEX TABLE transactions`;
  await prisma.$executeRaw`REINDEX TABLE utxos`;
  return tables;
}

/**
 * Delete orphaned draft transactions (wallet no longer exists)
 */
export async function deleteOrphanedDrafts(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM draft_transactions
    WHERE "walletId" NOT IN (SELECT id FROM wallets)
  `;
}

// ============================================================================
// Maintenance stats
// ============================================================================

/**
 * Get counts for maintenance dashboard
 */
export async function getStats(): Promise<{
  auditLogCount: number;
  priceDataCount: number;
  feeEstimateCount: number;
  draftCount: number;
  expiredDraftCount: number;
}> {
  const now = new Date();
  const [auditLogCount, priceDataCount, feeEstimateCount, draftCount, expiredDraftCount] =
    await Promise.all([
      prisma.auditLog.count(),
      prisma.priceData.count(),
      prisma.feeEstimate.count(),
      prisma.draftTransaction.count(),
      prisma.draftTransaction.count({ where: { expiresAt: { lt: now } } }),
    ]);

  return { auditLogCount, priceDataCount, feeEstimateCount, draftCount, expiredDraftCount };
}

/**
 * Get active user and wallet counts for Prometheus metrics
 */
export async function getActiveStats(): Promise<{
  activeUserCount: number;
  activeWalletCount: number;
}> {
  const now = new Date();
  const [activeUserCount, activeWalletCount] = await Promise.all([
    // Users with at least one non-expired refresh token (active session)
    prisma.refreshToken.groupBy({
      by: ['userId'],
      where: { expiresAt: { gt: now } },
    }).then(groups => groups.length),
    // Total wallets
    prisma.wallet.count(),
  ]);

  return { activeUserCount, activeWalletCount };
}

// ============================================================================
// Backup export helpers
// ============================================================================

/**
 * Export a full table (small tables only)
 */
export async function exportTable(table: string) {
  // @ts-expect-error - Dynamic Prisma table access; table name validated by caller
  return prisma[table].findMany();
}

/**
 * Export a table with cursor-based pagination
 */
export async function exportTablePaginated(
  table: string,
  pageSize: number,
  cursor?: string
) {
  // @ts-expect-error - Dynamic Prisma table access; table name validated by caller
  return prisma[table].findMany({
    take: pageSize,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: 'asc' },
  });
}

/**
 * Delete all records from a table (for backup restore)
 */
export async function deleteAllFromTable(
  tx: TxClient,
  table: string
): Promise<void> {
  // @ts-expect-error - Dynamic Prisma table access; table name validated by caller
  await tx[table].deleteMany({});
}

/**
 * Insert records into a table (for backup restore)
 */
export async function insertIntoTable(
  tx: TxClient,
  table: string,
  records: Record<string, unknown>[]
): Promise<void> {
  // @ts-expect-error - Dynamic Prisma table access; table name validated by caller
  await tx[table].createMany({
    data: records,
    skipDuplicates: false,
  });
}

/**
 * Get the Prisma transaction client for multi-table operations
 */
export async function runInTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  return prisma.$transaction(fn, options);
}

/**
 * Get list of existing PostgreSQL tables (for restore validation)
 */
export async function getExistingTables(): Promise<string[]> {
  const result = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename NOT LIKE '_prisma%'
  `;
  return result.map((r) => r.tablename);
}

// ============================================================================
// Migration tracking
// ============================================================================

interface PrismaMigration {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  logs: string | null;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

/**
 * Get all successfully applied migrations
 */
export async function getAppliedMigrations(): Promise<PrismaMigration[]> {
  return prisma.$queryRaw<PrismaMigration[]>`
    SELECT * FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY finished_at ASC
  `;
}

/**
 * Get the most recently applied migration (the schema "head").
 * Returns null when the migrations table is empty or unreachable.
 */
export async function getMigrationHead(): Promise<{
  migrationName: string;
  finishedAt: Date;
} | null> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date }>>`
    SELECT migration_name, finished_at FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    migrationName: rows[0].migration_name,
    finishedAt: rows[0].finished_at,
  };
}

// ============================================================================
// Token revocation
// ============================================================================

/**
 * Upsert a revoked token entry
 */
export async function upsertRevokedToken(data: {
  jti: string;
  expiresAt: Date;
  userId?: string;
  reason?: string;
}): Promise<void> {
  await prisma.revokedToken.upsert({
    where: { jti: data.jti },
    update: {
      userId: data.userId,
      reason: data.reason,
      revokedAt: new Date(),
      expiresAt: data.expiresAt,
    },
    create: {
      jti: data.jti,
      userId: data.userId,
      reason: data.reason,
      expiresAt: data.expiresAt,
    },
  });
}

/**
 * Find a revoked token by jti
 */
export async function findRevokedToken(jti: string) {
  return prisma.revokedToken.findUnique({
    where: { jti },
    select: { jti: true },
  });
}

/**
 * Count all revoked tokens
 */
export async function countRevokedTokens(): Promise<number> {
  return prisma.revokedToken.count();
}

/**
 * Delete expired revoked tokens
 */
export async function deleteExpiredRevokedTokens(): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

/**
 * Delete all refresh tokens for a user
 */
export async function deleteAllRefreshTokensForUser(userId: string): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete all revoked tokens (for testing)
 */
export async function deleteAllRevokedTokens(): Promise<void> {
  await prisma.revokedToken.deleteMany();
}

// ============================================================================
// Support package: database stats
// ============================================================================

/**
 * Get table row counts from pg_stat_user_tables
 */
export async function getTableStats(): Promise<Array<{ relname: string; n_live_tup: bigint }>> {
  return prisma.$queryRaw<Array<{ relname: string; n_live_tup: bigint }>>`
    SELECT relname, n_live_tup
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
  `;
}

/**
 * Get push device counts grouped by platform
 */
export async function getPushDeviceCountsByPlatform(): Promise<
  Array<{ platform: string; _count: { _all: number } }>
> {
  return prisma.pushDevice.groupBy({
    by: ['platform'],
    _count: { _all: true },
  });
}

// Export as namespace
export const maintenanceRepository = {
  // Cleanup
  deletePriceDataBefore,
  deleteFeeEstimatesBefore,
  deleteExpiredDrafts,
  deleteExpiredRefreshTokens,
  // DB maintenance
  vacuumAnalyze,
  reindexHeavyTables,
  deleteOrphanedDrafts,
  // Stats
  getStats,
  getActiveStats,
  // Backup
  exportTable,
  exportTablePaginated,
  deleteAllFromTable,
  insertIntoTable,
  runInTransaction,
  getExistingTables,
  // Migrations
  getAppliedMigrations,
  getMigrationHead,
  // Token revocation
  upsertRevokedToken,
  findRevokedToken,
  countRevokedTokens,
  deleteExpiredRevokedTokens,
  deleteAllRefreshTokensForUser,
  deleteAllRevokedTokens,
  // Support package
  getTableStats,
  getPushDeviceCountsByPlatform,
};

export default maintenanceRepository;
