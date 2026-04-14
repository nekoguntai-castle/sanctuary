import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupValidationEdgeCaseTests(): void {
describe('Backup Validation Edge Cases', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
  });

  it('should handle backup with only required tables', async () => {
    const minimalBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { user: 1 },
      },
      data: {
        user: [
          {
            id: 'user-1',
            username: 'admin',
            isAdmin: true,
          },
        ],
        // Other tables are empty arrays or missing
        wallet: [],
        device: [],
        walletUser: [],
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

    const result = await backupService.validateBackup(minimalBackup);

    expect(result.valid).toBe(true);
  });

  it('should count total records correctly', async () => {
    const backup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {
        user: [
          { id: 'u1', username: 'admin', isAdmin: true },
          { id: 'u2', username: 'user2', isAdmin: false },
        ],
        wallet: [
          { id: 'w1', name: 'Wallet 1' },
          { id: 'w2', name: 'Wallet 2' },
          { id: 'w3', name: 'Wallet 3' },
        ],
        device: [],
        walletUser: [{ walletId: 'w1', userId: 'u1', role: 'owner' }],
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

    const result = await backupService.validateBackup(backup);

    expect(result.info.totalRecords).toBe(6); // 2 users + 3 wallets + 1 walletUser
  });
});
}
