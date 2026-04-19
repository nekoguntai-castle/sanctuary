import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const { collectorMap } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/backupService/constants', () => ({
  BACKUP_FORMAT_VERSION: '1.0.0',
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

// Set BACKUP_DIR before importing the collector so its module-level constant
// resolves to the test directory.
const tmpDir = path.join(os.tmpdir(), `sanctuary-backup-test-${Date.now()}`);
process.env.BACKUP_DIR = tmpDir;

import '../../../../src/services/supportPackage/collectors/backups';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('backups collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('backups');
    if (!c) throw new Error('backups collector not registered');
    return c;
  };

  beforeEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers itself as backups', () => {
    expect(collectorMap.has('backups')).toBe(true);
  });

  it('flags missing directory cleanly', async () => {
    const result = await getCollector()(makeContext());
    expect(result.directoryMissing).toBe(true);
    expect(result.fileCount).toBe(0);
    expect(result.newestFile).toBeNull();
  });

  it('counts backup files and reports newest metadata', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'sanctuary-backup-2026-01-01.json'), 'a');
    await fs.writeFile(path.join(tmpDir, 'sanctuary-backup-2026-04-01.json'), 'bbb');
    await fs.writeFile(path.join(tmpDir, 'sanctuary-backup-2026-04-10.json'), 'ccccc');
    await fs.writeFile(path.join(tmpDir, 'not-a-backup.log'), 'ignored');

    const result = await getCollector()(makeContext());
    expect(result.fileCount).toBe(3);
    expect(result.totalBytes).toBe(1 + 3 + 5);
    expect(result.newestFile).toMatchObject({
      name: expect.stringMatching(/^sanctuary-backup-.+\.json$/),
      sizeBytes: expect.any(Number),
      mtime: expect.any(String),
      ageHours: expect.any(Number),
    });
  });

  it('returns empty shape for empty backup dir', async () => {
    await fs.mkdir(tmpDir, { recursive: true });

    const result = await getCollector()(makeContext());
    expect(result.fileCount).toBe(0);
    expect(result.totalBytes).toBe(0);
    expect(result.newestFile).toBeNull();
  });

  it('returns formatVersion always', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const result = await getCollector()(makeContext());
    expect(result.formatVersion).toBe('1.0.0');
  });

  it('surfaces non-ENOENT readdir errors as error field', async () => {
    // Create a file at tmpDir so readdir fails with ENOTDIR instead of ENOENT
    await fs.mkdir(path.dirname(tmpDir), { recursive: true });
    await fs.writeFile(tmpDir, 'not-a-directory');

    const result = await getCollector()(makeContext());
    expect(typeof result.error).toBe('string');
    expect(result.directoryMissing).toBeUndefined();
  });
});
