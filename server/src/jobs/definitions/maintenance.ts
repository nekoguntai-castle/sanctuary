/**
 * Maintenance Job Definitions
 *
 * Background jobs for database maintenance and cleanup tasks.
 * These jobs can be scheduled via cron or triggered manually.
 */

import type { Job } from 'bullmq';
import type { JobDefinition } from '../types';
import { maintenanceRepository, priceDataRepository, pushDeviceRepository } from '../../repositories';
import prisma from '../../models/prisma';
import { auditService, AuditCategory } from '../../services/auditService';
import { getCurrentFeeEstimates } from '../../services/bitcoin/feeService';
import { getPriceService } from '../../services/price';
import { expireOldTransfers } from '../../services/transferService';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { scheduledBackupJob } from './scheduledBackup';
import { reconcileSigningIntentBroadcasts } from '../../services/bitcoin/signingIntent/broadcastReconciliation';

export { scheduledBackupJob } from './scheduledBackup';

export const reconcileSigningIntentBroadcastsJob: JobDefinition<Record<string, never>, {
  examined: number;
  completed: number;
}> = {
  name: 'reconcile:signing-intent-broadcasts',
  handler: async (_job, execution) => {
    execution?.throwIfAborted();
    const result = await reconcileSigningIntentBroadcasts();
    execution?.throwIfAborted();
    return result;
  },
  options: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
};

const log = createLogger('JOB:MAINTENANCE');

// =============================================================================
// Job Data Types
// =============================================================================

interface CleanupJobData {
  retentionDays?: number;
}

interface DatabaseMaintenanceData {
  tables?: string[];
  timeout?: number;
}

interface PersistPriceFeesResult {
  pricesWritten: number;
  feesWritten: number;
}

// =============================================================================
// Cleanup Jobs
// =============================================================================

/**
 * Cleanup old audit logs
 */
export const cleanupAuditLogsJob: JobDefinition<CleanupJobData, number> = {
  name: 'cleanup:audit-logs',
  handler: async (job: Job<CleanupJobData>, execution) => {
    execution?.throwIfAborted();
    const retentionDays = job.data.retentionDays ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running audit log cleanup job', { retentionDays, cutoffDate: cutoffDate.toISOString() });

    const deleted = await auditService.cleanup(cutoffDate);
    execution?.throwIfAborted();

    if (deleted > 0) {
      log.info('Audit log cleanup completed', { deleted, olderThan: cutoffDate.toISOString() });
    }

    return deleted;
  },
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
};

/**
 * Cleanup old price data
 */
export const cleanupPriceDataJob: JobDefinition<CleanupJobData, number> = {
  name: 'cleanup:price-data',
  handler: async (job: Job<CleanupJobData>, execution) => {
    execution?.throwIfAborted();
    const retentionDays = job.data.retentionDays ?? 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running price data cleanup job', { retentionDays });

    const deleted = await maintenanceRepository.deletePriceDataBefore(cutoffDate);
    execution?.throwIfAborted();

    if (deleted > 0) {
      log.info('Price data cleanup completed', { deleted });
    }

    return deleted;
  },
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
};

/**
 * Cleanup old fee estimates
 */
export const cleanupFeeEstimatesJob: JobDefinition<CleanupJobData, number> = {
  name: 'cleanup:fee-estimates',
  handler: async (job: Job<CleanupJobData>, execution) => {
    execution?.throwIfAborted();
    const retentionDays = job.data.retentionDays ?? 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running fee estimate cleanup job', { retentionDays });

    const deleted = await maintenanceRepository.deleteFeeEstimatesBefore(cutoffDate);
    execution?.throwIfAborted();

    if (deleted > 0) {
      log.info('Fee estimate cleanup completed', { deleted });
    }

    return deleted;
  },
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
};

async function persistPriceSnapshots(signal?: AbortSignal): Promise<number> {
  const priceService = getPriceService();
  const currencies = priceService.getSupportedCurrencies();
  const prices = await priceService.getPrices(currencies);
  let pricesWritten = 0;

  for (const [currency, aggregate] of Object.entries(prices)) {
    signal?.throwIfAborted();
    await priceDataRepository.insertPriceData({
      currency: currency.trim().toUpperCase(),
      price: aggregate.price,
      source: 'aggregate',
    });
    pricesWritten += 1;
  }

  return pricesWritten;
}

async function persistFeeSnapshot(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const fees = await getCurrentFeeEstimates('mainnet');
  signal?.throwIfAborted();
  await priceDataRepository.insertFeeEstimate({
    fastest: fees.fastest,
    halfHour: fees.halfHour,
    hour: fees.hour,
  });
  return 1;
}

/**
 * Persist current price and fee snapshots for assistant cache reads
 */
export const persistPriceFeesJob: JobDefinition<void, PersistPriceFeesResult> = {
  name: 'persist:price-fees',
  handler: async (_job, execution) => {
    let pricesWritten = 0;
    let feesWritten = 0;

    try {
      pricesWritten = await persistPriceSnapshots(execution?.signal);
    } catch (error) {
      execution?.throwIfAborted();
      log.warn('Price snapshot persistence failed', { error: getErrorMessage(error) });
    }

    try {
      feesWritten = await persistFeeSnapshot(execution?.signal);
    } catch (error) {
      execution?.throwIfAborted();
      log.warn('Fee snapshot persistence failed', { error: getErrorMessage(error) });
    }

    if (pricesWritten > 0 || feesWritten > 0) {
      log.info('Price and fee snapshot persistence completed', { pricesWritten, feesWritten });
    }

    return { pricesWritten, feesWritten };
  },
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
};

/**
 * Cleanup expired draft transactions
 */
export const cleanupExpiredDraftsJob: JobDefinition<void, number> = {
  name: 'cleanup:expired-drafts',
  handler: async (_job, execution) => {
    execution?.throwIfAborted();
    log.info('Running expired drafts cleanup job');

    const deleted = await maintenanceRepository.deleteExpiredDrafts();
    execution?.throwIfAborted();

    if (deleted > 0) {
      log.info('Expired draft cleanup completed', { deleted });

      await auditService.log({
        username: 'system',
        action: 'maintenance.draft_cleanup',
        category: AuditCategory.SYSTEM,
        details: { deletedCount: deleted },
        success: true,
      });
      execution?.throwIfAborted();
    }

    return deleted;
  },
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
};

/**
 * Cleanup expired ownership transfers
 */
export const cleanupExpiredTransfersJob: JobDefinition<void, number> = {
  name: 'cleanup:expired-transfers',
  handler: async (_job, execution) => {
    execution?.throwIfAborted();
    log.info('Running expired transfers cleanup job');

    const count = await expireOldTransfers();
    execution?.throwIfAborted();

    if (count > 0) {
      log.info('Expired transfers cleanup completed', { expired: count });

      await auditService.log({
        username: 'system',
        action: 'maintenance.transfer_expiry',
        category: AuditCategory.SYSTEM,
        details: { expiredCount: count },
        success: true,
      });
      execution?.throwIfAborted();
    }

    return count;
  },
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
};

/**
 * Cleanup expired refresh tokens
 */
export const cleanupExpiredTokensJob: JobDefinition<void, number> = {
  name: 'cleanup:expired-tokens',
  handler: async (_job, execution) => {
    execution?.throwIfAborted();
    log.info('Running expired tokens cleanup job');

    const deleted = await maintenanceRepository.deleteExpiredRefreshTokens();
    execution?.throwIfAborted();

    if (deleted > 0) {
      log.info('Expired token cleanup completed', { deleted });
    }

    return deleted;
  },
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
};

// =============================================================================
// Database Maintenance Jobs
// =============================================================================

/**
 * Weekly database VACUUM ANALYZE
 */
export const weeklyVacuumJob: JobDefinition<DatabaseMaintenanceData, void> = {
  name: 'maintenance:weekly-vacuum',
  handler: async (job: Job<DatabaseMaintenanceData>, execution) => {
    execution?.throwIfAborted();
    const timeout = job.data.timeout ?? 300000; // 5 minutes default
    const startTime = Date.now();

    log.info('Running weekly VACUUM ANALYZE job');

    await job.updateProgress(10);

    // Set statement timeout
    await prisma.$executeRaw`SET statement_timeout = ${timeout}`;
    execution?.throwIfAborted();

    try {
      await prisma.$executeRaw`VACUUM ANALYZE`;
      execution?.throwIfAborted();
      await job.updateProgress(50);

      // REINDEX heavily-updated tables
      const tables = job.data.tables ?? ['audit_logs', 'Transaction', 'UTXO'];

      for (let i = 0; i < tables.length; i++) {
        execution?.throwIfAborted();
        const table = tables[i];
        log.info('Running REINDEX on table', { table });

        // Use individual queries to avoid SQL injection
        switch (table) {
          case 'audit_logs':
            await prisma.$executeRaw`REINDEX TABLE "audit_logs"`;
            break;
          case 'Transaction':
            await prisma.$executeRaw`REINDEX TABLE "Transaction"`;
            break;
          case 'UTXO':
            await prisma.$executeRaw`REINDEX TABLE "UTXO"`;
            break;
        }

        await job.updateProgress(50 + Math.floor((i + 1) / tables.length * 40));
        execution?.throwIfAborted();
      }

      const duration = Date.now() - startTime;
      log.info('Weekly database maintenance completed', { durationMs: duration });

      await auditService.log({
        username: 'system',
        action: 'maintenance.weekly_db_maintenance',
        category: AuditCategory.SYSTEM,
        details: { durationMs: duration, tablesReindexed: tables },
        success: true,
      });
      execution?.throwIfAborted();

      await job.updateProgress(100);
    } finally {
      await prisma.$executeRaw`SET statement_timeout = '0'`;
    }
  },
  options: {
    attempts: 1, // Don't retry - could cause issues
  },
};

/**
 * Monthly stale record cleanup
 */
export const monthlyCleanupJob: JobDefinition<void, { stalePushDevices: number; orphanedDrafts: number }> = {
  name: 'maintenance:monthly-cleanup',
  handler: async (job, execution) => {
    execution?.throwIfAborted();
    log.info('Running monthly stale record cleanup job');

    await job.updateProgress(10);

    // Delete push_devices that haven't been used in 90+ days
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 90);

    const stalePushDevicesCount = await pushDeviceRepository.deleteStale(staleDate);
    execution?.throwIfAborted();

    await job.updateProgress(50);

    if (stalePushDevicesCount > 0) {
      log.info('Stale push devices cleanup completed', { deleted: stalePushDevicesCount });
    }

    // Clean up orphaned drafts
    const orphanedDraftsResult = await maintenanceRepository.deleteOrphanedDrafts();
    execution?.throwIfAborted();

    await job.updateProgress(90);

    if (orphanedDraftsResult > 0) {
      log.info('Orphaned drafts cleanup completed', { deleted: orphanedDraftsResult });
    }

    await auditService.log({
      username: 'system',
      action: 'maintenance.monthly_stale_cleanup',
      category: AuditCategory.SYSTEM,
      details: {
        stalePushDevices: stalePushDevicesCount,
        orphanedDrafts: orphanedDraftsResult,
      },
      success: true,
    });
    execution?.throwIfAborted();

    await job.updateProgress(100);

    return {
      stalePushDevices: stalePushDevicesCount,
      orphanedDrafts: orphanedDraftsResult,
    };
  },
  options: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  },
};

// =============================================================================
// All Maintenance Jobs
// =============================================================================

export const maintenanceJobs = [
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
  cleanupExpiredDraftsJob,
  cleanupExpiredTransfersJob,
  cleanupExpiredTokensJob,
  weeklyVacuumJob,
  monthlyCleanupJob,
  persistPriceFeesJob,
  reconcileSigningIntentBroadcastsJob,
  scheduledBackupJob,
];
