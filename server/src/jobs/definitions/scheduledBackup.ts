import type { Job } from 'bullmq';
import type { JobDefinition } from '../types';
import { auditService, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';

const log = createLogger('JOB:MAINTENANCE');

export interface ScheduledBackupData {
  /** Number of newest scheduled-backup files to retain; defaults to seven. */
  retentionCount?: number;
}

/**
 * Daily scheduled backup written to the configured backup volume.
 */
export const scheduledBackupJob: JobDefinition<ScheduledBackupData, string> = {
  name: 'backup:scheduled',
  handler: async (job: Job<ScheduledBackupData>, execution) => {
    execution?.throwIfAborted();
    const fs = await import('fs/promises');
    const path = await import('path');
    const backupDir = process.env.BACKUP_DIR || '/data/backups';
    const retentionCount = job.data.retentionCount ?? 7;

    log.info('Running scheduled backup', { backupDir, retentionCount });
    await fs.mkdir(backupDir, { recursive: true });
    execution?.throwIfAborted();

    const { BackupService } = await import('../../services/backupService/backupService');
    const backupService = new BackupService();
    const backup = await backupService.createBackup('system-scheduled', {
      description: 'Automated daily backup',
      signal: execution?.signal,
    });
    execution?.throwIfAborted();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sanctuary-backup-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);
    await fs.writeFile(filepath, JSON.stringify(backup), 'utf-8');
    execution?.throwIfAborted();
    log.info('Backup written', { filepath, records: backup.meta.recordCounts });

    const files = await fs.readdir(backupDir);
    execution?.throwIfAborted();
    const backupFiles = files
      .filter(file => file.startsWith('sanctuary-backup-') && file.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of backupFiles.slice(retentionCount)) {
      execution?.throwIfAborted();
      await fs.unlink(path.join(backupDir, file));
      log.info('Deleted old backup', { file });
    }

    await auditService.log({
      username: 'system',
      action: 'maintenance.scheduled_backup',
      category: AuditCategory.SYSTEM,
      details: { filename, records: backup.meta.recordCounts },
      success: true,
    });
    execution?.throwIfAborted();
    return filename;
  },
  options: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  },
};
