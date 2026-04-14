import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupNodeConfigPasswordTests(): void {
describe('Node Config Password Handling', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'node_configs' },
    ]);
  });

  it('should warn when node config password cannot be decrypted', async () => {
    // Mock isEncrypted to return true
    vi.mocked(encryption.isEncrypted).mockReturnValue(true);
    vi.mocked(encryption.decrypt).mockImplementation(() => {
      throw new Error('Decryption failed: wrong key');
    });

    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { nodeConfig: 1 },
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
        nodeConfig: [{
          id: 'node-1',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          password: 'enc:v1:someencryptedpassword', // Encrypted with different key
        }],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.nodeConfig.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.nodeConfig.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'nodeConfig' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'nodeConfig' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('password could not be restored'))).toBe(true);
    expect(capturedData[0].password).toBeNull();

    // Reset mocks
    encryption.isEncrypted.mockReturnValue(false);
    encryption.decrypt.mockImplementation((v: any) => v);
  });

  it('should preserve node config password when decryption succeeds', async () => {
    vi.mocked(encryption.isEncrypted).mockReturnValue(true);
    vi.mocked(encryption.decrypt).mockReturnValue('decrypted-password');

    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { nodeConfig: 1 },
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
        nodeConfig: [{
          id: 'node-1',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          password: 'enc:v1:validencryptedpassword',
        }],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.nodeConfig.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.nodeConfig.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'nodeConfig' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'nodeConfig' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(capturedData[0].password).toBe('enc:v1:validencryptedpassword');

    encryption.isEncrypted.mockReturnValue(false);
    encryption.decrypt.mockImplementation((v: any) => v);
  });

  it('should preserve plaintext node config passwords without decryption checks', async () => {
    vi.mocked(encryption.isEncrypted).mockReturnValue(false);

    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { nodeConfig: 1 },
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
        nodeConfig: [{
          id: 'node-plain',
          type: 'electrum',
          host: 'electrum.example.com',
          port: 50002,
          password: 'plain-text-password',
        }],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.nodeConfig.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.nodeConfig.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'nodeConfig' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'nodeConfig' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(capturedData[0].password).toBe('plain-text-password');
  });

  it('should use generic node label in warning when node type is missing', async () => {
    vi.mocked(encryption.isEncrypted).mockReturnValue(true);
    vi.mocked(encryption.decrypt).mockImplementation(() => {
      throw new Error('Decryption failed: wrong key');
    });

    const backup: SanctuaryBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { nodeConfig: 1 },
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
        nodeConfig: [{
          id: 'node-unknown-type',
          host: 'electrum.example.com',
          port: 50002,
          password: 'enc:v1:someencryptedpassword',
        }],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    mockPrismaClient.nodeConfig.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.nodeConfig.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (key !== 'nodeConfig' && client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (key !== 'nodeConfig' && client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('update your node password'))).toBe(true);
    expect(capturedData[0].password).toBeNull();

    encryption.isEncrypted.mockReturnValue(false);
    encryption.decrypt.mockImplementation((v: any) => v);
  });
});
}
