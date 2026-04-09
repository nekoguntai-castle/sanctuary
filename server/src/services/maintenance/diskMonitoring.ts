/**
 * Disk Usage Monitoring
 *
 * Monitors Docker volume disk usage and warns when thresholds are exceeded.
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import { auditService, AuditCategory } from '../auditService';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { MaintenanceServiceConfig } from './types';

const log = createLogger('MAINTENANCE:SVC_DISK');
const execAsync = promisify(exec);

/**
 * Check Docker volume disk usage and warn if threshold exceeded
 */
export async function checkDiskUsage(config: MaintenanceServiceConfig): Promise<void> {
  const volumes = ['sanctuary_postgres_data', 'sanctuary_ollama_data'];

  try {
    // Check if docker command is available
    const { stdout: versionOutput } = await execAsync('docker --version').catch(() => ({ stdout: '' }));
    if (!versionOutput) {
      log.debug('Docker not available for disk usage monitoring');
      return;
    }

    for (const volumeName of volumes) {
      try {
        // Use docker volume inspect to get the mountpoint
        const { stdout: inspectOutput } = await execAsync(`docker volume inspect ${volumeName}`);
        const volumeData = safeJsonParseUntyped<Array<{ Mountpoint: string }>>(inspectOutput, [], 'docker volume inspect');

        if (volumeData && volumeData.length > 0) {
          const mountpoint = volumeData[0].Mountpoint;

          // Get disk usage for the mountpoint using df
          const { stdout: dfOutput } = await execAsync(`df -h "${mountpoint}" | tail -1`);
          const parts = dfOutput.trim().split(/\s+/);

          if (parts.length >= 5) {
            const usagePercent = parseInt(parts[4].replace('%', ''), 10);
            const used = parts[2];
            const available = parts[3];
            const total = parts[1];

            if (usagePercent >= config.diskWarningThresholdPercent) {
              log.warn('Docker volume disk usage exceeds threshold', {
                volume: volumeName,
                usagePercent: `${usagePercent}%`,
                used,
                available,
                total,
                threshold: `${config.diskWarningThresholdPercent}%`,
              });

              // Log to audit for tracking
              await auditService.log({
                username: 'system',
                action: 'maintenance.disk_warning',
                category: AuditCategory.SYSTEM,
                details: {
                  volume: volumeName,
                  usagePercent,
                  used,
                  available,
                  total,
                  threshold: config.diskWarningThresholdPercent,
                },
                success: true,
              });
            } else {
              log.debug('Docker volume disk usage within threshold', {
                volume: volumeName,
                usagePercent: `${usagePercent}%`,
                used,
                available,
                total,
              });
            }
          }
        }
      } catch (volumeError) {
        // Log but don't fail - volume might not exist yet
        log.debug('Could not check disk usage for volume', {
          volume: volumeName,
          error: getErrorMessage(volumeError),
        });
      }
    }
  } catch (error) {
    // Don't throw - disk monitoring is optional and shouldn't break maintenance
    log.warn('Disk usage check failed', { error: getErrorMessage(error) });
  }
}
