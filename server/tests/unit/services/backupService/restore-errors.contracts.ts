import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupRestoreErrorTests(): void {
describe('Restore Error Handling', () => {
  let backupService: BackupService;

  const createValidBackup = (): SanctuaryBackup => ({
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
  });

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'wallets' },
    ]);
  });

  it('should rollback on createMany failure', async () => {
    const backup = createValidBackup();

    // Transaction throws error to simulate rollback
    mockPrismaClient.$transaction.mockRejectedValue(new Error('Unique constraint violation'));

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unique constraint violation');
    expect(result.tablesRestored).toBe(0);
    expect(result.recordsRestored).toBe(0);
  });

  it('should handle database connection failure', async () => {
    const backup = createValidBackup();

    mockPrismaClient.$transaction.mockRejectedValue(new Error('Connection refused'));

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('should handle foreign key constraint violations', async () => {
    const backup = createValidBackup();
    backup.data.walletUser = [
      { walletId: 'nonexistent-wallet', userId: 'user-1', role: 'owner' },
    ];

    mockPrismaClient.$transaction.mockRejectedValue(
      new Error('Foreign key constraint failed on field walletId')
    );

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Foreign key constraint');
  });

  it('should handle timeout on large restores', async () => {
    const backup = createValidBackup();

    mockPrismaClient.$transaction.mockRejectedValue(
      new Error('Transaction timeout exceeded')
    );

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should skip non-existent tables gracefully', async () => {
    const backup = createValidBackup();
    backup.data.newFutureTable = [{ id: 'item-1', data: 'test' }];

    // Table doesn't exist in database
    mockPrismaClient.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);

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

    // Should succeed but skip the unknown table
    expect(result.success).toBe(true);
  });

  it('should continue restore when deleting an existing table fails', async () => {
    const backup = createValidBackup();

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'wallets' },
      { tablename: 'wallet_users' },
    ]);
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    const client = mockPrismaClient as any;
    Object.keys(client).forEach((key) => {
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    client.wallet.deleteMany.mockRejectedValueOnce(new Error('delete failed'));

    const result = await backupService.restoreFromBackup(backup);
    expect(result.success).toBe(true);
  });

  it('should return wrapped table restore errors from createMany failures', async () => {
    const backup = createValidBackup();

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
    ]);
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    const client = mockPrismaClient as any;
    Object.keys(client).forEach((key) => {
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    client.user.createMany.mockRejectedValueOnce(new Error('insert exploded'));

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to restore table user');
  });
});
}
