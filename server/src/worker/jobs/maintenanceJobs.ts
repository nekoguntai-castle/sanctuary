/**
 * Maintenance Jobs for Worker
 *
 * Wraps shared maintenance job definitions so the worker can execute them.
 * Each job has a distributed lock to prevent concurrent execution across
 * multiple server instances.
 */

import type { Job } from 'bullmq';
import type { WorkerJobHandler } from './types';
import {
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
  cleanupExpiredDraftsJob,
  cleanupExpiredTransfersJob,
  cleanupExpiredTokensJob,
  weeklyVacuumJob,
  monthlyCleanupJob,
  scheduledBackupJob,
} from '../../jobs/definitions/maintenance';

// Type for handlers that accept any job data
type AnyJobHandler = (job: Job<unknown>) => Promise<unknown>;

// Lock TTLs: job timeout (from backoff * attempts) + 60s grace period
// Cleanup jobs: ~30s typical + 60s grace = 90s
const CLEANUP_LOCK_TTL_MS = 90_000;
// Weekly vacuum: 5 min timeout + 60s grace
const VACUUM_LOCK_TTL_MS = 6 * 60_000;
// Monthly cleanup: ~60s typical + 60s grace
const MONTHLY_LOCK_TTL_MS = 2 * 60_000;
// Backup: large DB could take several minutes
const BACKUP_LOCK_TTL_MS = 30 * 60_000;

export const maintenanceJobs: WorkerJobHandler<unknown, unknown>[] = [
  {
    name: cleanupAuditLogsJob.name,
    queue: 'maintenance',
    handler: cleanupAuditLogsJob.handler as AnyJobHandler,
    options: cleanupAuditLogsJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupAuditLogsJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: cleanupPriceDataJob.name,
    queue: 'maintenance',
    handler: cleanupPriceDataJob.handler as AnyJobHandler,
    options: cleanupPriceDataJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupPriceDataJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: cleanupFeeEstimatesJob.name,
    queue: 'maintenance',
    handler: cleanupFeeEstimatesJob.handler as AnyJobHandler,
    options: cleanupFeeEstimatesJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupFeeEstimatesJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: cleanupExpiredDraftsJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredDraftsJob.handler as AnyJobHandler,
    options: cleanupExpiredDraftsJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupExpiredDraftsJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: cleanupExpiredTransfersJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTransfersJob.handler as AnyJobHandler,
    options: cleanupExpiredTransfersJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupExpiredTransfersJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: cleanupExpiredTokensJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTokensJob.handler as AnyJobHandler,
    options: cleanupExpiredTokensJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${cleanupExpiredTokensJob.name}`,
      lockTtlMs: CLEANUP_LOCK_TTL_MS,
    },
  },
  {
    name: weeklyVacuumJob.name,
    queue: 'maintenance',
    handler: weeklyVacuumJob.handler as AnyJobHandler,
    options: weeklyVacuumJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${weeklyVacuumJob.name}`,
      lockTtlMs: VACUUM_LOCK_TTL_MS,
    },
  },
  {
    name: monthlyCleanupJob.name,
    queue: 'maintenance',
    handler: monthlyCleanupJob.handler as AnyJobHandler,
    options: monthlyCleanupJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${monthlyCleanupJob.name}`,
      lockTtlMs: MONTHLY_LOCK_TTL_MS,
    },
  },
  {
    name: scheduledBackupJob.name,
    queue: 'maintenance',
    handler: scheduledBackupJob.handler as AnyJobHandler,
    options: scheduledBackupJob.options,
    lockOptions: {
      lockKey: () => `maintenance:${scheduledBackupJob.name}`,
      lockTtlMs: BACKUP_LOCK_TTL_MS,
    },
  },
];
