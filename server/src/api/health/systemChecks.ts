/**
 * System Health Checks
 *
 * Checks for database connectivity, disk space, and memory usage.
 */

import { statfs } from 'node:fs/promises';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import config from '../../config';
import type { ComponentHealth, HealthStatus } from './types';

const log = createLogger('HEALTH');

/**
 * Check database connectivity
 */
export async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      latency: Date.now() - start,
    };
  } catch (error) {
    log.error('Database health check failed', { error });
    return {
      status: 'unhealthy',
      message: getErrorMessage(error, 'Database unreachable'),
      latency: Date.now() - start,
    };
  }
}

// Disk space thresholds
const DISK_CRITICAL_THRESHOLD_PERCENT = 95;

/**
 * Check disk space usage using fs.statfs
 */
export async function checkDiskSpace(): Promise<ComponentHealth> {
  try {
    const stats = await statfs('/');
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - availableBytes;
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);

    const warningThreshold = config.maintenance.diskWarningThresholdPercent;

    let status: HealthStatus = 'healthy';
    let message: string | undefined;

    if (usedPercent >= DISK_CRITICAL_THRESHOLD_PERCENT) {
      status = 'unhealthy';
      message = `Disk usage critical: ${usedPercent}% used`;
    } else if (usedPercent >= warningThreshold) {
      status = 'degraded';
      message = `Disk usage elevated: ${usedPercent}% used (warning at ${warningThreshold}%)`;
    }

    return {
      status,
      message,
      details: {
        usedPercent: `${usedPercent}%`,
        totalGB: `${(totalBytes / 1024 / 1024 / 1024).toFixed(1)}GB`,
        availableGB: `${(availableBytes / 1024 / 1024 / 1024).toFixed(1)}GB`,
        warningThreshold: `${warningThreshold}%`,
        criticalThreshold: `${DISK_CRITICAL_THRESHOLD_PERCENT}%`,
      },
    };
  } catch (error) {
    log.warn('Disk space check failed', { error: getErrorMessage(error) });
    return {
      status: 'healthy',
      message: 'Disk space check unavailable',
    };
  }
}

// Memory threshold for degraded status (500MB heap usage)
const MEMORY_THRESHOLD_DEGRADED = 500 * 1024 * 1024; // 500MB
// Memory threshold for unhealthy status (1GB heap usage)
const MEMORY_THRESHOLD_UNHEALTHY = 1024 * 1024 * 1024; // 1GB

/**
 * Check memory usage
 */
export function checkMemory(): ComponentHealth {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);

  let status: HealthStatus = 'healthy';
  let message: string | undefined;

  if (mem.heapUsed >= MEMORY_THRESHOLD_UNHEALTHY) {
    status = 'unhealthy';
    message = `High memory usage: ${heapUsedMB}MB heap`;
  } else if (mem.heapUsed >= MEMORY_THRESHOLD_DEGRADED) {
    status = 'degraded';
    message = `Elevated memory usage: ${heapUsedMB}MB heap`;
  }

  return {
    status,
    message,
    details: {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      rss: `${rssMB}MB`,
      external: `${externalMB}MB`,
      heapPercent: `${Math.round((mem.heapUsed / mem.heapTotal) * 100)}%`,
    },
  };
}
