/**
 * Database Maintenance Tasks
 *
 * Handles weekly PostgreSQL VACUUM ANALYZE and REINDEX operations,
 * and monthly orphaned record cleanup.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditCategory } from '../auditService';

const log = createLogger('MAINTENANCE');

/**
 * Run weekly database maintenance tasks
 * - VACUUM ANALYZE with timeout protection
 * - REINDEX on heavily-updated tables
 */
export async function runWeeklyMaintenance(): Promise<void> {
  log.info('Running weekly database maintenance');

  const startTime = Date.now();

  try {
    // Run VACUUM ANALYZE with timeout protection (5 minute limit)
    log.info('Running VACUUM ANALYZE on database');
    await prisma.$executeRaw`SET statement_timeout = '300000'`;
    try {
      await prisma.$executeRaw`VACUUM ANALYZE`;
    } finally {
      await prisma.$executeRaw`SET statement_timeout = '0'`;
    }

    // Run REINDEX on heavily-updated tables
    // SECURITY: Use individual static queries - no string interpolation
    // Note: Use actual PostgreSQL table names from @@map(), not Prisma model names
    log.info('Running REINDEX on table: audit_logs');
    await prisma.$executeRaw`REINDEX TABLE audit_logs`;

    log.info('Running REINDEX on table: transactions');
    await prisma.$executeRaw`REINDEX TABLE transactions`;

    log.info('Running REINDEX on table: utxos');
    await prisma.$executeRaw`REINDEX TABLE utxos`;

    const heavyTables = ['audit_logs', 'transactions', 'utxos'];

    const duration = Date.now() - startTime;
    log.info('Weekly database maintenance completed', {
      durationMs: duration,
      tablesReindexed: heavyTables.length
    });

    // Log to audit for tracking
    await auditService.log({
      username: 'system',
      action: 'maintenance.weekly_db_maintenance',
      category: AuditCategory.SYSTEM,
      details: {
        durationMs: duration,
        tablesReindexed: heavyTables
      },
      success: true,
    });
  } catch (error) {
    log.error('Weekly database maintenance failed', { error: getErrorMessage(error) });

    // Log failure to audit
    await auditService.log({
      username: 'system',
      action: 'maintenance.weekly_db_maintenance',
      category: AuditCategory.SYSTEM,
      details: { error: getErrorMessage(error) },
      success: false,
    });

    throw error;
  }
}

/**
 * Clean up orphaned draft transactions (wallet no longer exists)
 */
export async function cleanupOrphanedDrafts(): Promise<number> {
  try {
    // Delete drafts where wallet no longer exists using raw SQL for efficiency
    // Note: Use actual PostgreSQL table names from @@map(), not Prisma model names
    const result = await prisma.$executeRaw`
      DELETE FROM draft_transactions
      WHERE "walletId" NOT IN (SELECT id FROM wallets)
    `;

    if (result > 0) {
      log.info('Orphaned draft cleanup completed', {
        deleted: result,
      });
    }

    return result;
  } catch (error) {
    log.error('Orphaned draft cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Run monthly cleanup of stale records
 * - Stale push devices (90+ days unused)
 * - Orphaned draft transactions
 */
export async function runMonthlyMaintenance(): Promise<void> {
  log.info('Running monthly stale record cleanup');

  try {
    // Delete push_devices that haven't been used in 90+ days
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 90);

    const stalePushDevicesResult = await prisma.pushDevice.deleteMany({
      where: {
        lastUsedAt: {
          lt: staleDate,
        },
      },
    });

    if (stalePushDevicesResult.count > 0) {
      log.info('Stale push devices cleanup completed', {
        deleted: stalePushDevicesResult.count,
      });
    }

    // Clean up orphaned drafts (wallet no longer exists)
    const orphanedDrafts = await cleanupOrphanedDrafts();

    // Log to audit for tracking
    await auditService.log({
      username: 'system',
      action: 'maintenance.monthly_stale_cleanup',
      category: AuditCategory.SYSTEM,
      details: {
        stalePushDevices: stalePushDevicesResult.count,
        orphanedDrafts,
      },
      success: true,
    });
  } catch (error) {
    log.error('Monthly stale record cleanup failed', { error: getErrorMessage(error) });

    // Log failure to audit
    await auditService.log({
      username: 'system',
      action: 'maintenance.monthly_stale_cleanup',
      category: AuditCategory.SYSTEM,
      details: { error: getErrorMessage(error) },
      success: false,
    });

    throw error;
  }
}
