/**
 * Restore Admission Guards
 *
 * Non-regression coverage for the P0 fix: a legacy backup whose schemaVersion
 * predates BASELINE_RESTORE_SCHEMA_VERSION must not be able to wipe the
 * database while restoring nothing. See
 * docs/plans/iteration-14-p0-p1-remediation.md, Phase 1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAllBackupTablesExist } from './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { BackupService, type SanctuaryBackup } from '../../../../src/services/backupService';
import {
  getRequiredRestoreTables,
  LEGACY_TABLE_ORDER,
} from '../../../../src/services/backupService/constants';

export function registerBackupRestoreAdmissionTests(): void {
describe('destructive-restore admission guards', () => {
  let backupService: BackupService;

  const createLegacyBaselineBackup = (): SanctuaryBackup => {
    const data: SanctuaryBackup['data'] = {};
    for (const table of LEGACY_TABLE_ORDER) {
      data[table] = [];
    }
    data.user = [{ id: 'user-1', username: 'admin', isAdmin: true }];
    return {
      meta: {
        version: '1.0.0',
        appVersion: '0.3.0',
        schemaVersion: 0,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data,
    };
  };

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    mockPrismaClient.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);
    mockAllBackupTablesExist();
  });

  describe('getRequiredRestoreTables', () => {
    it('returns the non-empty baseline set for a legacy backup at schemaVersion 0', () => {
      const required = getRequiredRestoreTables({
        version: '1.0.0',
        schemaVersion: 0,
        includesCache: false,
      });

      expect(required.length).toBeGreaterThan(0);
      expect(required).toEqual(
        expect.arrayContaining(['hardwareDeviceModel', 'systemSetting', 'nodeConfig', 'user', 'wallet']),
      );
      // Tables whose minimum sits above the baseline stay optional below it.
      expect(required).not.toContain('mcpApiKey');
      expect(required).not.toContain('electrumServer');
      expect(required).not.toContain('walletAgent');
    });
  });

  describe('validateBackupForRestore', () => {
    it('rejects the exact P0 backup: legacy format, schemaVersion 0, empty data', async () => {
      const backup = { version: '1.0.0', schemaVersion: 0, data: {} };

      const result = await backupService.validateBackupForRestore({
        meta: backup,
        data: backup.data,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.startsWith('Missing required restore table:'))).toBe(true);
    });

    it('rejects a legacy schemaVersion-0 backup missing a baseline table', async () => {
      const backup = createLegacyBaselineBackup() as any;
      delete backup.data.wallet;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing required restore table: wallet');
    });

    it('restores a legacy schemaVersion-0 backup that carries every baseline table and a user', async () => {
      const backup = createLegacyBaselineBackup();

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid, result.issues.join('; ')).toBe(true);
    });

    it('rejects a destructive restore whose data.user is absent', async () => {
      const backup = createLegacyBaselineBackup() as any;
      delete backup.data.user;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one user for a destructive restore');
    });

    it('rejects a destructive restore whose data.user is an empty array', async () => {
      const backup = createLegacyBaselineBackup();
      backup.data.user = [];

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one user for a destructive restore');
    });

    it('rejects when the computed required-table set is empty, whatever produced that', async () => {
      vi.resetModules();
      vi.doMock('../../../../src/services/backupService/constants', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../../../src/services/backupService/constants')
        >();
        return { ...actual, getRequiredRestoreTables: vi.fn().mockReturnValue([]) };
      });

      try {
        const { validateBackupForRestore } = await import(
          '../../../../src/services/backupService/validation'
        );
        const backup = createLegacyBaselineBackup();

        const result = await validateBackupForRestore(backup);

        expect(result.valid).toBe(false);
        expect(result.issues).toContain(
          'Backup requires no tables for a destructive restore; refusing to delete existing data and restore nothing',
        );
      } finally {
        vi.doUnmock('../../../../src/services/backupService/constants');
        vi.resetModules();
      }
    });
  });

  describe('restoreFromBackup', () => {
    it('rejects the exact P0 backup before any delete is issued', async () => {
      const backup = { meta: { version: '1.0.0', schemaVersion: 0 }, data: {} } as unknown as SanctuaryBackup;

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.committed).toBe(false);
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      const client = mockPrismaClient as any;
      for (const key of Object.keys(client)) {
        if (client[key]?.deleteMany) {
          expect(client[key].deleteMany).not.toHaveBeenCalled();
        }
      }
    });

    it('rejects a destructive restore missing data.user before any delete is issued', async () => {
      const backup = createLegacyBaselineBackup() as any;
      delete backup.data.user;

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Backup must contain at least one user for a destructive restore');
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });

    it('restores a legacy schemaVersion-0 backup carrying baseline tables and a user', async () => {
      const backup = createLegacyBaselineBackup();

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      const client = mockPrismaClient as any;
      Object.keys(client).forEach((key) => {
        if (client[key]?.deleteMany) client[key].deleteMany.mockResolvedValue({ count: 0 });
        if (client[key]?.createMany) client[key].createMany.mockResolvedValue({ count: 0 });
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success, result.error).toBe(true);
    });
  });
});
}
