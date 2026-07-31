import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockDb, mockExecSync, mockLog } = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
  },
  mockExecSync: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockDb,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import {
  getExpectedSchemaVersion,
  loadPackagedMigrationNames,
  migrationService,
} from '../../../src/services/migrationService';

const temporaryDirectories: string[] = [];

function makeMigrationManifest(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-migrations-'));
  temporaryDirectories.push(root);

  for (const name of names) {
    const migrationDirectory = join(root, name);
    mkdirSync(migrationDirectory);
    writeFileSync(join(migrationDirectory, 'migration.sql'), '-- migration\n');
  }

  return root;
}

function migration(
  migrationName: string,
  options: {
    finishedAt?: Date | null;
    rolledBackAt?: Date | null;
  } = {}
) {
  return {
    id: migrationName,
    checksum: 'checksum',
    finished_at: options.finishedAt === undefined ? new Date('2026-01-01T00:00:00Z') : options.finishedAt,
    migration_name: migrationName,
    logs: null,
    rolled_back_at: options.rolledBackAt ?? null,
    started_at: new Date('2026-01-01T00:00:00Z'),
    applied_steps_count: 1,
  };
}

describe('migrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$queryRaw.mockResolvedValue([]);
    mockExecSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads a sorted manifest from packaged migration directories', () => {
    const root = makeMigrationManifest([
      'manual_fix_txid_unique',
      '20251210175307_initial_setup',
    ]);
    writeFileSync(join(root, 'migration_lock.toml'), 'provider = "postgresql"\n');

    expect(loadPackagedMigrationNames(root)).toEqual([
      '20251210175307_initial_setup',
      'manual_fix_txid_unique',
    ]);
  });

  it('fails closed for missing, invalid, or empty packaged manifests', () => {
    const missing = join(tmpdir(), `missing-migrations-${Date.now()}`);
    const invalid = makeMigrationManifest([]);
    mkdirSync(join(invalid, 'missing-sql'));
    mkdirSync(join(invalid, 'missing-sql', 'migration.sql'));
    const empty = makeMigrationManifest([]);

    expect(() => loadPackagedMigrationNames(missing)).toThrow(/migration manifest/i);
    expect(() => loadPackagedMigrationNames(invalid)).toThrow(/migration\.sql/i);
    expect(() => loadPackagedMigrationNames(empty)).toThrow(/empty/i);
  });

  it('derives the expected schema version from the packaged runtime manifest', () => {
    expect(getExpectedSchemaVersion()).toBe(
      loadPackagedMigrationNames().length
    );
    expect(getExpectedSchemaVersion()).toBeGreaterThan(28);
  });

  it('queries every migration state and returns only successful migrations', async () => {
    const successful = migration('successful');
    const failed = migration('failed', { finishedAt: null });
    const rolledBack = migration('rolled-back', {
      rolledBackAt: new Date('2026-01-02T00:00:00Z'),
    });
    mockDb.$queryRaw.mockResolvedValueOnce([successful, failed, rolledBack]);

    await expect(migrationService.getAppliedMigrations()).resolves.toEqual([successful]);
  });

  it('handles a missing migrations table as no applied migrations', async () => {
    mockDb.$queryRaw.mockRejectedValueOnce(new Error('missing table'));

    await expect(migrationService.getAppliedMigrations()).resolves.toEqual([]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Could not query migrations table',
      expect.objectContaining({ error: 'missing table' })
    );
  });

  it('does not let extra historical rows hide a missing packaged migration', async () => {
    const expected = loadPackagedMigrationNames();
    const missingName = expected.at(-1)!;
    const applied = expected
      .slice(0, -1)
      .map((name) => migration(name));

    for (let index = 0; index < 40; index += 1) {
      applied.push(migration(`historical_${index}`));
    }
    mockDb.$queryRaw.mockResolvedValue(applied);

    const info = await migrationService.getSchemaVersionInfo();
    const verification = await migrationService.verifyMigrations();

    expect(info.version).toBe(applied.length);
    expect(info.pendingMigrations).toBe(1);
    expect(verification).toEqual(expect.objectContaining({
      valid: false,
      missing: [missingName],
      expected: expected.length,
    }));
  });

  it('treats failed and rolled-back packaged migrations as pending', async () => {
    const expected = loadPackagedMigrationNames();
    const failedName = expected[0];
    const rolledBackName = expected[1];
    mockDb.$queryRaw.mockResolvedValue([
      ...expected.slice(2).map((name) => migration(name)),
      migration(failedName, { finishedAt: null }),
      migration(rolledBackName, {
        rolledBackAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ]);

    const verification = await migrationService.verifyMigrations();

    expect(verification.valid).toBe(false);
    expect(verification.missing).toEqual([failedName, rolledBackName]);
  });

  it('accepts a fully current database with unrelated historical rows', async () => {
    const expected = loadPackagedMigrationNames();
    mockDb.$queryRaw.mockResolvedValue([
      migration('historical_before_packaging'),
      ...expected.map((name) => migration(name)),
    ]);

    const verification = await migrationService.verifyMigrations();

    expect(verification.valid).toBe(true);
    expect(verification.missing).toEqual([]);
    expect(verification.applied).toBe(expected.length + 1);
  });

  it('preserves successful-row count as the backup-facing schema version', async () => {
    mockDb.$queryRaw.mockResolvedValue([
      migration('successful'),
      migration('failed', { finishedAt: null }),
    ]);

    await expect(migrationService.getSchemaVersion()).resolves.toBe(1);
  });

  it('reports empty database details and checks individual migration presence', async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([]);

    await expect(migrationService.getSchemaVersionInfo()).resolves.toEqual({
      version: 0,
      latestMigration: null,
      appliedAt: null,
      totalMigrations: getExpectedSchemaVersion(),
      pendingMigrations: getExpectedSchemaVersion(),
    });

    mockDb.$queryRaw.mockResolvedValueOnce([migration('migration_a')]);
    await expect(migrationService.isMigrationApplied('migration_a')).resolves.toBe(true);

    mockDb.$queryRaw.mockResolvedValueOnce([migration('migration_a')]);
    await expect(migrationService.isMigrationApplied('migration_b')).resolves.toBe(false);
  });

  it('skips deploy only when exact packaged migrations are current', async () => {
    const expected = loadPackagedMigrationNames();
    mockDb.$queryRaw.mockResolvedValue(expected.map((name) => migration(name)));

    await expect(migrationService.runMigrations()).resolves.toEqual({
      success: true,
      applied: 0,
    });
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('runs deploy for an exact-name gap and verifies the post-deploy state', async () => {
    const expected = loadPackagedMigrationNames();
    mockDb.$queryRaw
      .mockResolvedValueOnce(expected.slice(0, -1).map((name) => migration(name)))
      .mockResolvedValueOnce(expected.map((name) => migration(name)));

    await expect(migrationService.runMigrations()).resolves.toEqual({
      success: true,
      applied: 1,
    });
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prisma migrate deploy',
      expect.objectContaining({ cwd: process.cwd() })
    );
  });

  it('fails when deploy returns without applying every packaged migration', async () => {
    const expected = loadPackagedMigrationNames();
    const incomplete = expected.slice(0, -1).map((name) => migration(name));
    mockDb.$queryRaw
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(incomplete);

    const result = await migrationService.runMigrations();

    expect(result.success).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.error).toMatch(/still missing/i);
  });

  it('reports deploy execution failures', async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('deploy failed');
    });

    await expect(migrationService.runMigrations()).resolves.toEqual({
      success: false,
      applied: 0,
      error: 'deploy failed',
    });
  });

  it('logs both pending and fully current migration states', async () => {
    const expected = loadPackagedMigrationNames();
    mockDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(expected.map((name) => migration(name)));

    await migrationService.logMigrationStatus();
    await migrationService.logMigrationStatus();

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Database schema is behind',
      expect.objectContaining({ pendingMigrations: expected.length })
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      'Database schema is up to date',
      expect.objectContaining({ version: expected.length })
    );
  });
});
