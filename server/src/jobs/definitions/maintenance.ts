/**
 * Maintenance Job Definitions
 *
 * Background jobs for database maintenance and cleanup tasks.
 * These jobs can be scheduled via cron or triggered manually.
 */

import type { Job } from 'bullmq';
import type { JobDefinition } from '../types';
import { maintenanceRepository, pushDeviceRepository } from '../../repositories';
import prisma from '../../models/prisma';
import { auditService, AuditCategory } from '../../services/auditService';
import { expireOldTransfers } from '../../services/transferService';
import { createLogger } from '../../utils/logger';

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

// =============================================================================
// Cleanup Jobs
// =============================================================================

/**
 * Cleanup old audit logs
 */
export const cleanupAuditLogsJob: JobDefinition<CleanupJobData, number> = {
  name: 'cleanup:audit-logs',
  handler: async (job: Job<CleanupJobData>) => {
    const retentionDays = job.data.retentionDays ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running audit log cleanup job', { retentionDays, cutoffDate: cutoffDate.toISOString() });

    const deleted = await auditService.cleanup(cutoffDate);

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
  handler: async (job: Job<CleanupJobData>) => {
    const retentionDays = job.data.retentionDays ?? 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running price data cleanup job', { retentionDays });

    const deleted = await maintenanceRepository.deletePriceDataBefore(cutoffDate);

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
  handler: async (job: Job<CleanupJobData>) => {
    const retentionDays = job.data.retentionDays ?? 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    log.info('Running fee estimate cleanup job', { retentionDays });

    const deleted = await maintenanceRepository.deleteFeeEstimatesBefore(cutoffDate);

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

/**
 * Cleanup expired draft transactions
 */
export const cleanupExpiredDraftsJob: JobDefinition<void, number> = {
  name: 'cleanup:expired-drafts',
  handler: async () => {
    log.info('Running expired drafts cleanup job');

    const deleted = await maintenanceRepository.deleteExpiredDrafts();

    if (deleted > 0) {
      log.info('Expired draft cleanup completed', { deleted });

      await auditService.log({
        username: 'system',
        action: 'maintenance.draft_cleanup',
        category: AuditCategory.SYSTEM,
        details: { deletedCount: deleted },
        success: true,
      });
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
  handler: async () => {
    log.info('Running expired transfers cleanup job');

    const count = await expireOldTransfers();

    if (count > 0) {
      log.info('Expired transfers cleanup completed', { expired: count });

      await auditService.log({
        username: 'system',
        action: 'maintenance.transfer_expiry',
        category: AuditCategory.SYSTEM,
        details: { expiredCount: count },
        success: true,
      });
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
  handler: async () => {
    log.info('Running expired tokens cleanup job');

    const deleted = await maintenanceRepository.deleteExpiredRefreshTokens();

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
  handler: async (job: Job<DatabaseMaintenanceData>) => {
    const timeout = job.data.timeout ?? 300000; // 5 minutes default
    const startTime = Date.now();

    log.info('Running weekly VACUUM ANALYZE job');

    await job.updateProgress(10);

    // Set statement timeout
    await prisma.$executeRaw`SET statement_timeout = ${timeout}`;

    try {
      await prisma.$executeRaw`VACUUM ANALYZE`;
      await job.updateProgress(50);

      // REINDEX heavily-updated tables
      const tables = job.data.tables ?? ['audit_logs', 'Transaction', 'UTXO'];

      for (let i = 0; i < tables.length; i++) {
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
  handler: async (job) => {
    log.info('Running monthly stale record cleanup job');

    await job.updateProgress(10);

    // Delete push_devices that haven't been used in 90+ days
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 90);

    const stalePushDevicesCount = await pushDeviceRepository.deleteStale(staleDate);

    await job.updateProgress(50);

    if (stalePushDevicesCount > 0) {
      log.info('Stale push devices cleanup completed', { deleted: stalePushDevicesCount });
    }

    // Clean up orphaned drafts
    const orphanedDraftsResult = await maintenanceRepository.deleteOrphanedDrafts();

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
// Scheduled Backup Job
// =============================================================================

interface ScheduledBackupData {
  retentionCount?: number;
}

/**
 * Daily scheduled backup
 * Creates a JSON backup and writes it to /data/backups/ (Docker volume).
 * Retains the most recent N backups (default 7).
 */
export const scheduledBackupJob: JobDefinition<ScheduledBackupData, string> = {
  name: 'backup:scheduled',
  handler: async (job: Job<ScheduledBackupData>) => {
    const fs = await import('fs/promises');
    const path = await import('path');

    const backupDir = process.env.BACKUP_DIR || '/data/backups';
    const retentionCount = job.data.retentionCount ?? 7;

    log.info('Running scheduled backup', { backupDir, retentionCount });

    // Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // Create backup via backup service
    const { BackupService } = await import('../../services/backupService/backupService');
    const backupService = new BackupService();
    const backup = await backupService.createBackup('system-scheduled', {
      description: `Automated daily backup`,
    });

    // Write to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sanctuary-backup-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);
    await fs.writeFile(filepath, JSON.stringify(backup), 'utf-8');

    log.info('Backup written', { filepath, records: backup.meta.recordCounts });

    // Enforce retention: delete oldest files beyond retentionCount
    const files = await fs.readdir(backupDir);
    const backupFiles = files
      .filter(f => f.startsWith('sanctuary-backup-') && f.endsWith('.json'))
      .sort()
      .reverse(); // newest first

    if (backupFiles.length > retentionCount) {
      const toDelete = backupFiles.slice(retentionCount);
      for (const file of toDelete) {
        await fs.unlink(path.join(backupDir, file));
        log.info('Deleted old backup', { file });
      }
    }

    await auditService.log({
      username: 'system',
      action: 'maintenance.scheduled_backup',
      category: AuditCategory.SYSTEM,
      details: { filename, records: backup.meta.recordCounts },
      success: true,
    });

    return filename;
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
  scheduledBackupJob,
];
