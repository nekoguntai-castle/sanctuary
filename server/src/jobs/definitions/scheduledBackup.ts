import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { JobDefinition } from '../types';
import { auditService, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';
import type { BackupService } from '../../services/backupService/backupService';
import type { SanctuaryBackup } from '../../services/backupService/types';

const log = createLogger('JOB:MAINTENANCE');
const BACKUP_FILE_PREFIX = 'sanctuary-backup-';
const BACKUP_FILE_SUFFIX = '.json';
const TEMP_FILE_PREFIX = `.${BACKUP_FILE_PREFIX}`;
const TEMP_FILE_SUFFIX = '.tmp';
const STALE_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000;

export interface ScheduledBackupData {
  /** Number of newest scheduled-backup files to retain; defaults to seven. */
  retentionCount?: number;
}

type FileSystem = typeof import('fs/promises');

async function syncDirectory(fs: FileSystem, backupDir: string): Promise<void> {
  let directory;
  try {
    directory = await fs.open(backupDir, 'r');
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR'].includes(code ?? '')) {
      throw error;
    }
    log.debug('Backup directory fsync is unsupported', { backupDir, code });
  } finally {
    await directory?.close();
  }
}

async function publishBackupAtomically(
  fs: FileSystem,
  backupDir: string,
  filename: string,
  backup: SanctuaryBackup,
  signal?: AbortSignal,
): Promise<string> {
  const path = await import('path');
  const filepath = path.join(backupDir, filename);
  const tempPath = path.join(
    backupDir,
    `${TEMP_FILE_PREFIX}${process.pid}-${randomUUID()}${TEMP_FILE_SUFFIX}`,
  );
  let file;
  let published = false;

  try {
    signal?.throwIfAborted();
    file = await fs.open(tempPath, 'wx', 0o600);
    await file.writeFile(JSON.stringify(backup), 'utf8');
    signal?.throwIfAborted();
    await file.sync();
    signal?.throwIfAborted();
    await file.close();
    file = undefined;
    signal?.throwIfAborted();
    await fs.rename(tempPath, filepath);
    published = true;
    await syncDirectory(fs, backupDir);
    return filepath;
  } finally {
    await file?.close().catch(() => undefined);
    if (!published) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }
}

async function isValidBackupFile(
  fs: FileSystem,
  backupService: BackupService,
  filepath: string,
): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(filepath, 'utf8')) as unknown;
    return (await backupService.validateBackupForRestore(parsed)).valid;
  } catch (error) {
    log.warn('Ignoring invalid scheduled backup file', { filepath, error });
    return false;
  }
}

async function removeStaleTemporaryFiles(
  fs: FileSystem,
  backupDir: string,
  files: string[],
  now = Date.now(),
): Promise<void> {
  const path = await import('path');
  for (const file of files) {
    if (!file.startsWith(TEMP_FILE_PREFIX) || !file.endsWith(TEMP_FILE_SUFFIX)) continue;
    const filepath = path.join(backupDir, file);
    try {
      const stats = await fs.stat(filepath);
      if (now - stats.mtimeMs >= STALE_TEMP_FILE_AGE_MS) {
        await fs.unlink(filepath);
        log.info('Deleted stale temporary backup', { file });
      }
    } catch (error) {
      log.warn('Could not inspect temporary backup file', { file, error });
    }
  }
}

async function enforceRetention(
  fs: FileSystem,
  backupService: BackupService,
  backupDir: string,
  files: string[],
  retentionCount: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = await import('path');
  const candidates = files
    .filter(file => file.startsWith(BACKUP_FILE_PREFIX) && file.endsWith(BACKUP_FILE_SUFFIX))
    .sort()
    .reverse();
  const validFiles: string[] = [];

  for (const file of candidates) {
    signal?.throwIfAborted();
    if (await isValidBackupFile(fs, backupService, path.join(backupDir, file))) {
      validFiles.push(file);
    }
  }

  for (const file of validFiles.slice(retentionCount)) {
    signal?.throwIfAborted();
    await fs.unlink(path.join(backupDir, file));
    log.info('Deleted old backup', { file });
  }
}

/**
 * Daily scheduled backup written to the configured backup volume.
 */
export const scheduledBackupJob: JobDefinition<ScheduledBackupData, string> = {
  name: 'backup:scheduled',
  handler: async (job: Job<ScheduledBackupData>, execution) => {
    execution?.throwIfAborted();
    const fs = await import('fs/promises');
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
    const filename = `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_SUFFIX}`;
    const filepath = await publishBackupAtomically(
      fs,
      backupDir,
      filename,
      backup,
      execution?.signal,
    );
    execution?.throwIfAborted();
    log.info('Backup written', { filepath, records: backup.meta.recordCounts });

    const files = await fs.readdir(backupDir);
    execution?.throwIfAborted();
    await removeStaleTemporaryFiles(fs, backupDir, files);
    await enforceRetention(
      fs,
      backupService,
      backupDir,
      files,
      retentionCount,
      execution?.signal,
    );

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
