import type { Job } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import type { JobDefinition } from '../types';
import { auditService, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { BackupService } from '../../services/backupService/backupService';
import type { BackupMeta } from '../../services/backupService/types';

const log = createLogger('JOB:MAINTENANCE');
const BACKUP_FILE_PREFIX = 'sanctuary-backup-';
const BACKUP_FILE_SUFFIX = '.json';
const TEMP_FILE_PREFIX = `.${BACKUP_FILE_PREFIX}`;
const TEMP_FILE_SUFFIX = '.tmp';
const STALE_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Published names carry the SHA-256 of their bytes, so retention can prove a
 * file is the complete one this job wrote by streaming a hash instead of
 * parsing it (a full parse of a large backup exhausts the worker's heap).
 */
const DIGEST_FILE_PATTERN = /^sanctuary-backup-.+-([0-9a-f]{64})\.json$/;
/**
 * Files written before digest names are parsed and validated in full, which is
 * only safe while they are small. Larger ones are kept but not counted.
 */
const HASH_READ_CHUNK_BYTES = 1024 * 1024;
export const LEGACY_VALIDATION_MAX_BYTES = 64 * 1024 * 1024;

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
  timestamp: string,
  writeBackup: (write: (chunk: string) => Promise<void>) => Promise<BackupMeta>,
  signal?: AbortSignal,
): Promise<{ filename: string; meta: BackupMeta }> {
  const path = await import('path');
  const tempPath = path.join(
    backupDir,
    `${TEMP_FILE_PREFIX}${process.pid}-${randomUUID()}${TEMP_FILE_SUFFIX}`,
  );
  let file;
  let published = false;

  try {
    signal?.throwIfAborted();
    file = await fs.open(tempPath, 'wx', 0o600);
    const handle = file;
    const hash = createHash('sha256');
    const meta = await writeBackup(async (chunk) => {
      signal?.throwIfAborted();
      const bytes = Buffer.from(chunk, 'utf8');
      hash.update(bytes);
      // FileHandle.writeFile writes from the current position, so successive
      // calls append; it also retries short writes until the chunk is out.
      await handle.writeFile(bytes);
    });
    signal?.throwIfAborted();
    await file.sync();
    signal?.throwIfAborted();
    await file.close();
    file = undefined;
    signal?.throwIfAborted();
    const filename = `${BACKUP_FILE_PREFIX}${timestamp}-${hash.digest('hex')}${BACKUP_FILE_SUFFIX}`;
    await fs.rename(tempPath, path.join(backupDir, filename));
    published = true;
    await syncDirectory(fs, backupDir);
    return { filename, meta };
  } finally {
    await file?.close().catch(() => undefined);
    if (!published) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }
}

async function hashFile(fs: FileSystem, filepath: string): Promise<string> {
  const file = await fs.open(filepath, 'r');
  try {
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: HASH_READ_CHUNK_BYTES })) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}

async function isValidBackupFile(
  fs: FileSystem,
  backupService: BackupService,
  filepath: string,
  file: string,
): Promise<boolean> {
  try {
    const digest = DIGEST_FILE_PATTERN.exec(file)?.[1];
    if (digest) {
      if (await hashFile(fs, filepath) === digest) return true;
      log.warn('Ignoring scheduled backup whose bytes do not match its name', { filepath });
      return false;
    }
    const { size } = await fs.stat(filepath);
    if (size > LEGACY_VALIDATION_MAX_BYTES) {
      log.warn('Keeping a large legacy backup without counting it toward retention', { filepath, size });
      return false;
    }
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
  publishedFile: string,
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
    // The file this run just published was hashed as it was written.
    if (file === publishedFile
      || await isValidBackupFile(fs, backupService, path.join(backupDir, file), file)) {
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
 * Fail in milliseconds, with an operator-actionable message, when the volume is
 * not writable by this process instead of after a full database export.
 */
async function assertBackupDirWritable(
  fs: typeof import('fs/promises'),
  backupDir: string,
): Promise<void> {
  try {
    await fs.access(backupDir, fs.constants.W_OK);
  } catch (error) {
    throw new Error(
      `Backup directory ${backupDir} is not writable by uid ${process.getuid?.() ?? 'unknown'}; ` +
      `restart the stack so the backup-volume-init repair runs, or chown the volume: ${getErrorMessage(error)}`,
    );
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
    await assertBackupDirWritable(fs, backupDir);
    execution?.throwIfAborted();

    const { BackupService } = await import('../../services/backupService/backupService.js');
    const backupService = new BackupService();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const { filename, meta } = await publishBackupAtomically(
      fs,
      backupDir,
      timestamp,
      (write) => backupService.writeBackup('system-scheduled', write, {
        description: 'Automated daily backup',
        signal: execution?.signal,
      }),
      execution?.signal,
    );
    execution?.throwIfAborted();
    log.info('Backup written', { filename, records: meta.recordCounts });

    const files = await fs.readdir(backupDir);
    execution?.throwIfAborted();
    await removeStaleTemporaryFiles(fs, backupDir, files);
    await enforceRetention(
      fs,
      backupService,
      backupDir,
      files,
      retentionCount,
      filename,
      execution?.signal,
    );

    await auditService.log({
      username: 'system',
      action: 'maintenance.scheduled_backup',
      category: AuditCategory.SYSTEM,
      details: { filename, records: meta.recordCounts },
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
