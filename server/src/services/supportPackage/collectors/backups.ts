/**
 * Backups Collector
 *
 * Scheduled backups are written to BACKUP_DIR (default /data/backups).
 * Silent backup failures are a common "I can't recover" support scenario,
 * so this collector reports the on-disk state: file count, most recent
 * timestamp from filename, and total bytes. No file contents are read.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { BACKUP_FORMAT_VERSION } from '../../backupService/constants';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

const BACKUP_FILE_PREFIX = 'sanctuary-backup-';
const BACKUP_FILE_SUFFIX = '.json';

registerCollector('backups', async () => {
  /* v8 ignore next -- BACKUP_DIR env override is container-deployment specific */
  const backupDir = process.env.BACKUP_DIR || '/data/backups';
  const result: Record<string, unknown> = {
    formatVersion: BACKUP_FORMAT_VERSION,
    backupDir,
  };

  try {
    const entries = await fs.readdir(backupDir);
    const backupFiles = entries.filter(
      f => f.startsWith(BACKUP_FILE_PREFIX) && f.endsWith(BACKUP_FILE_SUFFIX)
    );

    if (backupFiles.length === 0) {
      return { ...result, fileCount: 0, totalBytes: 0, newestFile: null };
    }

    const stats = await Promise.all(
      backupFiles.map(async f => {
        const s = await fs.stat(path.join(backupDir, f));
        return { name: f, size: s.size, mtime: s.mtime };
      })
    );

    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const newest = stats[0];

    return {
      ...result,
      fileCount: stats.length,
      totalBytes: stats.reduce((sum, s) => sum + s.size, 0),
      newestFile: {
        /* v8 ignore next -- filename is non-sensitive metadata */
        name: newest.name,
        sizeBytes: newest.size,
        mtime: newest.mtime.toISOString(),
        ageHours: Math.floor((Date.now() - newest.mtime.getTime()) / 3_600_000),
      },
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { ...result, fileCount: 0, totalBytes: 0, newestFile: null, directoryMissing: true };
    }
    return { ...result, error: getErrorMessage(error) };
  }
});
