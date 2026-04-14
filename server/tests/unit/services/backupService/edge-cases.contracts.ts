import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupEdgeCaseTests(): void {
describe('Backup Edge Cases', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();

    mockPrismaClient.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);
  });

  it('should handle special characters in string fields', async () => {
    const backup: SanctuaryBackup = {
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
        user: [{
          id: 'user-1',
          username: 'admin',
          isAdmin: true,
          // Special characters
          displayName: 'Test ñ ü ö 日本語 🎉 <script>alert(1)</script>',
        }],
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

    let capturedData: any = null;
    mockPrismaClient.user.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.user.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'user' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'user' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(capturedData[0].displayName).toBe('Test ñ ü ö 日本語 🎉 <script>alert(1)</script>');
  });

  it('should handle null and undefined values', async () => {
    const backup: SanctuaryBackup = {
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
        user: [{
          id: 'user-1',
          username: 'admin',
          isAdmin: true,
          twoFactorSecret: null,
          displayName: undefined,
        }],
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

    let capturedData: any = null;
    mockPrismaClient.user.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.user.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'user' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'user' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(capturedData[0].twoFactorSecret).toBeNull();
    expect(capturedData[0].displayName).toBeUndefined();
  });

  it('should handle empty arrays for all tables', async () => {
    const backup: SanctuaryBackup = {
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
    expect(result.tablesRestored).toBeGreaterThanOrEqual(1); // At least user table
  });

  it('should handle nested objects in JSON fields', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { systemSetting: 1 },
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
        systemSetting: [{
          key: 'complex.setting',
          value: JSON.stringify({
            nested: {
              deep: {
                value: 42,
                array: [1, 2, 3],
              },
            },
          }),
        }],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.systemSetting.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.systemSetting.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'systemSetting' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'systemSetting' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    // Verify restore completed without errors for deeply nested JSON data
  });

  it('should handle array fields that were serialized as objects', async () => {
    // Test legacy format where arrays might be {0: "a", 1: "b"}
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { device: 1 },
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [{
          id: 'device-1',
          userId: 'user-1',
          label: 'Test Device',
          fingerprint: 'aabbccdd',
          type: 'ledger',
          // Legacy format: array as object with numeric keys
          connectionTypes: { '0': 'usb', '1': 'bluetooth' },
        }],
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

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'devices' },
    ]);
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.device.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.device.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'device' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'device' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(capturedData[0].connectionTypes).toEqual(['usb', 'bluetooth']);
  });

  it('should preserve real array fields during restore processing', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { device: 1 },
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [{
          id: 'device-1',
          userId: 'user-1',
          label: 'Array Device',
          fingerprint: 'ffeeddcc',
          type: 'ledger',
          connectionTypes: ['usb', 'bluetooth'],
        }],
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

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'devices' },
    ]);
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.device.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.device.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'device' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'device' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(capturedData[0].connectionTypes).toEqual(['usb', 'bluetooth']);
  });

  it('should recursively process non-numeric nested objects during restore', async () => {
    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { device: 1 },
      },
      data: {
        user: [{ id: 'user-1', username: 'admin', isAdmin: true }],
        wallet: [],
        walletUser: [],
        device: [{
          id: 'device-1',
          userId: 'user-1',
          label: 'Nested Device',
          fingerprint: 'abcdef12',
          type: 'ledger',
          metadata: {
            transport: 'usb',
            capabilities: {
              taproot: true,
            },
          },
        }],
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

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'devices' },
    ]);
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.device.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.device.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'device' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'device' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(capturedData[0].metadata).toEqual({
      transport: 'usb',
      capabilities: { taproot: true },
    });
  });

  it('should handle very long string values', async () => {
    const longString = 'x'.repeat(100000); // 100KB string

    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { draftTransaction: 1 },
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
        draftTransaction: [{
          id: 'draft-1',
          walletId: 'wallet-1',
          psbt: longString,
          status: 'pending',
        }],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.draftTransaction.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.draftTransaction.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'draftTransaction' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'draftTransaction' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    // Verify restore completed successfully with very long string values (100KB)
  });
});
}
