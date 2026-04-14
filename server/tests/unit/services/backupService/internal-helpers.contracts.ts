import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupInternalHelperTests(): void {
describe('BackupService internal helpers', () => {
  it('should pluralize snake_case words ending in y', () => {
    expect(camelToSnakeCase('category')).toBe('categories');
  });

  it('should skip migrations when backup start version is already at/above migration targets', () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 5,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {
        user: [],
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

    const migrated = migrateBackup(backup, 6) as SanctuaryBackup;
    expect(migrated.meta.schemaVersion).toBe(6);
  });

  it('should proxy getSchemaVersion through migration service', async () => {
    const service = new BackupService();
    const schemaVersion = await service.getSchemaVersion();
    expect(schemaVersion).toBe(1);
  });
});
}
