/**
 * Data Cleanup Tasks
 *
 * Handles cleanup of time-sensitive data: audit logs, price data,
 * fee estimates, expired drafts, expired transfers, and expired refresh tokens.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditCategory } from '../auditService';
import { expireOldTransfers } from '../transferService';
import type { MaintenanceServiceConfig } from './types';

const log = createLogger('MAINTENANCE');

/**
 * Clean up old audit logs
 */
export async function cleanupAuditLogs(config: MaintenanceServiceConfig): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.auditLogRetentionDays);

  try {
    const deleted = await auditService.cleanup(cutoffDate);

    if (deleted > 0) {
      log.info('Audit log cleanup completed', {
        deleted,
        olderThan: cutoffDate.toISOString(),
      });
    }

    return deleted;
  } catch (error) {
    log.error('Audit log cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Clean up old price data
 */
export async function cleanupPriceData(config: MaintenanceServiceConfig): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.priceDataRetentionDays);

  try {
    const result = await prisma.priceData.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    if (result.count > 0) {
      log.info('Price data cleanup completed', {
        deleted: result.count,
        olderThan: cutoffDate.toISOString(),
      });
    }

    return result.count;
  } catch (error) {
    log.error('Price data cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Clean up old fee estimates
 */
export async function cleanupFeeEstimates(config: MaintenanceServiceConfig): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.feeEstimateRetentionDays);

  try {
    const result = await prisma.feeEstimate.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    if (result.count > 0) {
      log.info('Fee estimate cleanup completed', {
        deleted: result.count,
        olderThan: cutoffDate.toISOString(),
      });
    }

    return result.count;
  } catch (error) {
    log.error('Fee estimate cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Clean up expired draft transactions
 */
export async function cleanupExpiredDrafts(): Promise<number> {
  const now = new Date();

  try {
    const result = await prisma.draftTransaction.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });

    if (result.count > 0) {
      log.info('Expired draft cleanup completed', {
        deleted: result.count,
      });

      // Log to audit for tracking
      await auditService.log({
        username: 'system',
        action: 'maintenance.draft_cleanup',
        category: AuditCategory.SYSTEM,
        details: { deletedCount: result.count },
        success: true,
      });
    }

    return result.count;
  } catch (error) {
    log.error('Expired draft cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Clean up expired ownership transfers
 */
export async function cleanupExpiredTransfers(): Promise<number> {
  try {
    const count = await expireOldTransfers();

    if (count > 0) {
      log.info('Expired ownership transfers cleanup completed', {
        expired: count,
      });

      // Log to audit for tracking
      await auditService.log({
        username: 'system',
        action: 'maintenance.transfer_expiry',
        category: AuditCategory.SYSTEM,
        details: { expiredCount: count },
        success: true,
      });
    }

    return count;
  } catch (error) {
    log.error('Expired ownership transfers cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Clean up expired refresh tokens
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const now = new Date();

  try {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });

    if (result.count > 0) {
      log.info('Expired refresh token cleanup completed', {
        deleted: result.count,
      });
    }

    return result.count;
  } catch (error) {
    log.error('Expired refresh token cleanup failed', { error: getErrorMessage(error) });
    throw error;
  }
}
