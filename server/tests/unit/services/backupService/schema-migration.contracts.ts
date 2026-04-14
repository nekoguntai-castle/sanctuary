import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupSchemaMigrationTests(): void {
describe('Schema Version and Migration Handling', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();

    mockPrismaClient.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);
  });

  it('should restore older schema version with migration', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.3.0',
        schemaVersion: 0, // Older schema
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { user: 1 },
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
  });

  it('should reject schema version too far ahead', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '99.0.0',
        schemaVersion: 999, // Way ahead
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    const validation = await backupService.validateBackup(backup);

    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.includes('too far ahead'))).toBe(true);
  });

  it('should warn about slightly newer schema version', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.5.0',
        schemaVersion: 5, // Slightly ahead (within 10)
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    const validation = await backupService.validateBackup(backup);

    // Should be valid but with warning
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.includes('newer than current'))).toBe(true);
  });
});
}
