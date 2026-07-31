import { beforeEach, describe, expect, it, vi } from 'vitest';
import { basename } from 'node:path';

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn(),
  backup: {
    meta: {
      version: '1.1.0',
      recordCounts: { user: 1 },
    },
    data: { user: [{ id: 'user-1' }] },
  },
  createBackup: vi.fn(),
  validateBackupForRestore: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  fileWrite: vi.fn(),
  fileSync: vi.fn(),
  fileClose: vi.fn(),
  directorySync: vi.fn(),
  directoryClose: vi.fn(),
  events: [] as string[],
}));

vi.mock('fs/promises', () => ({
  mkdir: mocks.mkdir,
  open: mocks.open,
  rename: mocks.rename,
  readdir: mocks.readdir,
  readFile: mocks.readFile,
  stat: mocks.stat,
  unlink: mocks.unlink,
}));

vi.mock('../../../src/services/backupService/backupService', () => ({
  BackupService: class {
    createBackup = mocks.createBackup;
    validateBackupForRestore = mocks.validateBackupForRestore;
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: { log: mocks.auditLog },
  AuditCategory: { SYSTEM: 'SYSTEM' },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { scheduledBackupJob } from '../../../src/jobs/definitions/scheduledBackup';

describe('scheduled backup atomic publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.createBackup.mockResolvedValue(mocks.backup);
    mocks.validateBackupForRestore.mockImplementation(async (backup: {
      meta?: { complete?: boolean };
    }) => ({ valid: backup.meta?.complete !== false }));
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.rename.mockImplementation(async () => {
      mocks.events.push('rename');
    });
    mocks.readdir.mockResolvedValue([]);
    mocks.readFile.mockResolvedValue(JSON.stringify(mocks.backup));
    mocks.stat.mockResolvedValue({ mtimeMs: 0 });
    mocks.unlink.mockResolvedValue(undefined);
    mocks.fileWrite.mockImplementation(async () => {
      mocks.events.push('file-write');
    });
    mocks.fileSync.mockImplementation(async () => {
      mocks.events.push('file-sync');
    });
    mocks.fileClose.mockImplementation(async () => {
      mocks.events.push('file-close');
    });
    mocks.directorySync.mockImplementation(async () => {
      mocks.events.push('directory-sync');
    });
    mocks.directoryClose.mockResolvedValue(undefined);
    mocks.open.mockImplementation(async (_path: string, flags: string) => (
      flags === 'wx'
        ? {
            writeFile: mocks.fileWrite,
            sync: mocks.fileSync,
            close: mocks.fileClose,
          }
        : {
            sync: mocks.directorySync,
            close: mocks.directoryClose,
          }
    ));
  });

  it('syncs and closes a unique temporary file before rename and directory sync', async () => {
    const filename = await scheduledBackupJob.handler({ data: {} } as never);

    expect(filename).toMatch(/^sanctuary-backup-.*\.json$/);
    expect(mocks.open).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
      'wx',
      0o600,
    );
    expect(mocks.events).toEqual([
      'file-write',
      'file-sync',
      'file-close',
      'rename',
      'directory-sync',
    ]);
    expect(mocks.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
      expect.stringMatching(/\/sanctuary-backup-.*\.json$/),
    );
    expect(mocks.auditLog).toHaveBeenCalledOnce();
  });

  it('removes only its temporary file when publication fails', async () => {
    mocks.fileWrite.mockRejectedValueOnce(new Error('disk full'));

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .rejects.toThrow('disk full');

    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
    );
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it('cleans the temporary file when cancellation arrives before rename', async () => {
    const controller = new AbortController();
    mocks.fileSync.mockImplementationOnce(async () => {
      mocks.events.push('file-sync');
      controller.abort();
    });

    await expect(scheduledBackupJob.handler(
      { data: {} } as never,
      { signal: controller.signal, throwIfAborted: () => controller.signal.throwIfAborted() },
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
    );
  });

  it('cleans the temporary file when atomic rename fails', async () => {
    mocks.rename.mockRejectedValueOnce(new Error('rename failed'));

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .rejects.toThrow('rename failed');

    expect(mocks.unlink).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
    );
  });

  it('accepts unsupported directory fsync after publishing the final file', async () => {
    mocks.directorySync.mockRejectedValueOnce(
      Object.assign(new Error('unsupported'), { code: 'EINVAL' }),
    );

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .resolves.toMatch(/^sanctuary-backup-/);

    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.directoryClose).toHaveBeenCalledOnce();
  });

  it('fails after rename on a real directory sync error without deleting the final file', async () => {
    mocks.directorySync.mockRejectedValueOnce(new Error('directory sync failed'));

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .rejects.toThrow('directory sync failed');

    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('preserves the publication error when temporary close and unlink cleanup also fail', async () => {
    mocks.fileWrite.mockRejectedValueOnce(new Error('write failed'));
    mocks.fileClose.mockRejectedValueOnce(new Error('close failed'));
    mocks.unlink.mockRejectedValueOnce(new Error('unlink failed'));

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .rejects.toThrow('write failed');
  });

  it('ignores corrupt final files for retention and separately removes stale temp files', async () => {
    mocks.readdir.mockImplementation(async () => [
      basename(mocks.rename.mock.calls[0][1] as string),
      'sanctuary-backup-2026-07-03.json',
      'sanctuary-backup-2026-07-02.json',
      'sanctuary-backup-2026-07-01.json',
      '.sanctuary-backup-stale.tmp',
    ]);
    mocks.readFile.mockImplementation(async (filepath: string) => (
      filepath.endsWith('2026-07-03.json')
        ? '{"truncated":'
        : JSON.stringify(mocks.backup)
    ));
    mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 25 * 60 * 60 * 1000 });

    await scheduledBackupJob.handler({ data: { retentionCount: 2 } } as never);

    expect(mocks.unlink).toHaveBeenCalledTimes(2);
    expect(mocks.unlink).toHaveBeenCalledWith('/data/backups/.sanctuary-backup-stale.tmp');
    expect(mocks.unlink).toHaveBeenCalledWith(
      '/data/backups/sanctuary-backup-2026-07-01.json',
    );
    expect(mocks.unlink).not.toHaveBeenCalledWith(
      '/data/backups/sanctuary-backup-2026-07-02.json',
    );
    expect(mocks.unlink).not.toHaveBeenCalledWith(
      '/data/backups/sanctuary-backup-2026-07-03.json',
    );
  });

  it('does not count a parseable but incomplete current-format backup for retention', async () => {
    mocks.readdir.mockImplementation(async () => [
      basename(mocks.rename.mock.calls[0][1] as string),
      'sanctuary-backup-2026-07-03.json',
      'sanctuary-backup-2026-07-02.json',
    ]);
    mocks.readFile.mockImplementation(async (filepath: string) => (
      filepath.endsWith('2026-07-03.json')
        ? JSON.stringify({ meta: { complete: false }, data: { user: [] } })
        : JSON.stringify(mocks.backup)
    ));

    await scheduledBackupJob.handler({ data: { retentionCount: 2 } } as never);

    expect(mocks.validateBackupForRestore).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { complete: false } }),
    );
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('preserves recent temporary files', async () => {
    mocks.readdir.mockResolvedValue(['.sanctuary-backup-recent.tmp']);
    mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 60_000 });

    await scheduledBackupJob.handler({ data: {} } as never);

    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('continues when a stale temporary file cannot be inspected', async () => {
    mocks.readdir.mockResolvedValue(['.sanctuary-backup-unreadable.tmp']);
    mocks.stat.mockRejectedValueOnce(new Error('stat failed'));

    await expect(scheduledBackupJob.handler({ data: {} } as never))
      .resolves.toMatch(/^sanctuary-backup-/);

    expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
