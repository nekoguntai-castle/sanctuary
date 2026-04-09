/**
 * Database Maintenance Tasks
 *
 * Handles weekly PostgreSQL VACUUM ANALYZE and REINDEX operations,
 * and monthly orphaned record cleanup.
 */

import { maintenanceRepository, pushDeviceRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditCategory } from '../auditService';

const log = createLogger('MAINTENANCE:SVC_DB');

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
    await maintenanceRepository.vacuumAnalyze(300000);

    // Run REINDEX on heavily-updated tables
    log.info('Running REINDEX on heavily-updated tables');
    const heavyTables = await maintenanceRepository.reindexHeavyTables();

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
    const count = await maintenanceRepository.deleteOrphanedDrafts();

    if (count > 0) {
      log.info('Orphaned draft cleanup completed', {
        deleted: count,
      });
    }

    return count;
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

    const stalePushDevicesCount = await pushDeviceRepository.deleteStale(staleDate);

    if (stalePushDevicesCount > 0) {
      log.info('Stale push devices cleanup completed', {
        deleted: stalePushDevicesCount,
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
        stalePushDevices: stalePushDevicesCount,
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
