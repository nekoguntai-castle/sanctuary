/**
 * Maintenance Service
 *
 * Handles scheduled cleanup and maintenance tasks to ensure
 * the application can run perpetually without resource exhaustion.
 *
 * Tasks:
 *   - Audit log cleanup (configurable retention, default 90 days)
 *   - Price data cleanup (30 days retention)
 *   - Fee estimate cleanup (7 days retention)
 *   - Expired draft transaction cleanup
 *   - Expired ownership transfer cleanup
 *   - Stale session cleanup
 *   - Docker volume disk usage monitoring
 *   - Weekly PostgreSQL VACUUM ANALYZE and REINDEX
 *   - Monthly orphaned record cleanup
 */

import { maintenanceRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import type { MaintenanceServiceConfig } from './types';
import {
  cleanupAuditLogs,
  cleanupPriceData,
  cleanupFeeEstimates,
  cleanupExpiredDrafts,
  cleanupExpiredTransfers,
  cleanupExpiredRefreshTokens,
} from './dataCleanup';
import { checkDiskUsage } from './diskMonitoring';
import { runWeeklyMaintenance, runMonthlyMaintenance } from './databaseMaintenance';

const log = createLogger('MAINTENANCE:SVC');

/**
 * Get maintenance config from centralized config
 */
function getMaintenanceConfig(): MaintenanceServiceConfig {
  const cfg = getConfig();
  return {
    auditLogRetentionDays: cfg.maintenance.auditLogRetentionDays,
    priceDataRetentionDays: cfg.maintenance.priceDataRetentionDays,
    feeEstimateRetentionDays: cfg.maintenance.feeEstimateRetentionDays,
    dailyCleanupInterval: cfg.maintenance.dailyCleanupIntervalMs,
    hourlyCleanupInterval: cfg.maintenance.hourlyCleanupIntervalMs,
    initialDelayMs: cfg.maintenance.initialDelayMs,
    weeklyMaintenanceInterval: cfg.maintenance.weeklyMaintenanceIntervalMs,
    monthlyMaintenanceInterval: cfg.maintenance.monthlyMaintenanceIntervalMs,
    diskWarningThresholdPercent: cfg.maintenance.diskWarningThresholdPercent,
  };
}

/**
 * Maintenance Service class
 */
export class MaintenanceService {
  private config: MaintenanceServiceConfig;
  private dailyTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private weeklyTimer: NodeJS.Timeout | null = null;
  private monthlyTimer: NodeJS.Timeout | null = null;
  private running = false;

  // Track last run times for weekly/monthly tasks
  private lastWeeklyRun: Date | null = null;
  private lastMonthlyRun: Date | null = null;

  constructor(overrides: Partial<MaintenanceServiceConfig> = {}) {
    // Load from centralized config, allow overrides for testing
    this.config = { ...getMaintenanceConfig(), ...overrides };
  }

  /**
   * Start the maintenance service
   */
  start(): void {
    if (this.running) {
      log.warn('Maintenance service already running');
      return;
    }

    this.running = true;
    log.info('Maintenance service starting', {
      auditLogRetention: `${this.config.auditLogRetentionDays} days`,
      priceDataRetention: `${this.config.priceDataRetentionDays} days`,
      feeEstimateRetention: `${this.config.feeEstimateRetentionDays} days`,
    });

    // Run initial cleanup after a short delay
    this.initialTimer = setTimeout(() => {
      this.runAllCleanups().catch((err) => {
        log.error('Initial cleanup failed', { error: getErrorMessage(err) });
      });
    }, this.config.initialDelayMs);

    // Schedule daily cleanup tasks
    this.dailyTimer = setInterval(() => {
      this.runDailyCleanups().catch((err) => {
        log.error('Daily cleanup failed', { error: getErrorMessage(err) });
      });
    }, this.config.dailyCleanupInterval);

    // Schedule hourly cleanup tasks
    this.hourlyTimer = setInterval(() => {
      this.runHourlyCleanups().catch((err) => {
        log.error('Hourly cleanup failed', { error: getErrorMessage(err) });
      });
    }, this.config.hourlyCleanupInterval);

    // Schedule weekly maintenance tasks
    this.weeklyTimer = setInterval(() => {
      this.checkAndRunWeeklyMaintenance().catch((err) => {
        log.error('Weekly maintenance check failed', { error: getErrorMessage(err) });
      });
    }, this.config.dailyCleanupInterval); // Check daily, run weekly

    // Schedule monthly maintenance tasks
    this.monthlyTimer = setInterval(() => {
      this.checkAndRunMonthlyMaintenance().catch((err) => {
        log.error('Monthly maintenance check failed', { error: getErrorMessage(err) });
      });
    }, this.config.dailyCleanupInterval); // Check daily, run monthly
  }

  /**
   * Stop the maintenance service
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    log.info('Maintenance service stopping');

    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }

    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }

    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }

    if (this.weeklyTimer) {
      clearInterval(this.weeklyTimer);
      this.weeklyTimer = null;
    }

    if (this.monthlyTimer) {
      clearInterval(this.monthlyTimer);
      this.monthlyTimer = null;
    }
  }

  /**
   * Run all cleanup tasks
   */
  async runAllCleanups(): Promise<void> {
    log.info('Running all maintenance cleanups');
    await this.runDailyCleanups();
    await this.runHourlyCleanups();
  }

  /**
   * Run daily cleanup tasks
   */
  async runDailyCleanups(): Promise<void> {
    log.info('Running daily maintenance tasks');

    const results = await Promise.allSettled([
      cleanupAuditLogs(this.config),
      cleanupPriceData(this.config),
      cleanupFeeEstimates(this.config),
      cleanupExpiredRefreshTokens(),
      checkDiskUsage(this.config),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Daily cleanup task failed', { error: getErrorMessage(result.reason) });
      }
    }
  }

  /**
   * Run hourly cleanup tasks
   */
  async runHourlyCleanups(): Promise<void> {
    log.debug('Running hourly maintenance tasks');

    const results = await Promise.allSettled([
      cleanupExpiredDrafts(),
      cleanupExpiredTransfers(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Hourly cleanup task failed', { error: getErrorMessage(result.reason) });
      }
    }
  }

  /**
   * Check and run weekly maintenance if needed
   */
  async checkAndRunWeeklyMaintenance(): Promise<void> {
    const now = new Date();

    // Run if we've never run, or if it's been more than a week
    if (!this.lastWeeklyRun ||
        (now.getTime() - this.lastWeeklyRun.getTime()) >= this.config.weeklyMaintenanceInterval) {
      await runWeeklyMaintenance();
      this.lastWeeklyRun = now;
    }
  }

  /**
   * Check and run monthly maintenance if needed
   */
  async checkAndRunMonthlyMaintenance(): Promise<void> {
    const now = new Date();

    // Run if we've never run, or if it's been more than a month
    if (!this.lastMonthlyRun ||
        (now.getTime() - this.lastMonthlyRun.getTime()) >= this.config.monthlyMaintenanceInterval) {
      await runMonthlyMaintenance();
      this.lastMonthlyRun = now;
    }
  }

  /**
   * Get maintenance statistics
   */
  async getStats(): Promise<{
    auditLogCount: number;
    priceDataCount: number;
    feeEstimateCount: number;
    draftCount: number;
    expiredDraftCount: number;
  }> {
    return maintenanceRepository.getStats();
  }

  /**
   * Manually trigger cleanup (for admin API or testing)
   */
  async triggerCleanup(task: 'all' | 'audit' | 'price' | 'fees' | 'drafts' | 'transfers' | 'weekly' | 'monthly'): Promise<number> {
    switch (task) {
      case 'all':
        await this.runAllCleanups();
        return 0;
      case 'audit':
        return cleanupAuditLogs(this.config);
      case 'price':
        return cleanupPriceData(this.config);
      case 'fees':
        return cleanupFeeEstimates(this.config);
      case 'drafts':
        return cleanupExpiredDrafts();
      case 'transfers':
        return cleanupExpiredTransfers();
      case 'weekly':
        await runWeeklyMaintenance();
        return 0;
      case 'monthly':
        await runMonthlyMaintenance();
        return 0;
      default:
        throw new Error(`Unknown cleanup task: ${task}`);
    }
  }
}
