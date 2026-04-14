import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupUser2faSecretTests(): void {
describe('User 2FA Secret Handling', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();

    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
    ]);
  });

  it('should warn and clear 2FA when secret cannot be decrypted', async () => {
    // Mock isEncrypted to return true for 2FA secret
    vi.mocked(encryption.isEncrypted).mockReturnValue(true);
    vi.mocked(encryption.decrypt).mockImplementation(() => {
      throw new Error('Decryption failed: wrong key/salt');
    });

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
          twoFactorEnabled: true,
          twoFactorSecret: 'enc:v1:someencryptedsecret', // Encrypted with different key/salt
          twoFactorBackupCodes: '["$2b$10$hashedcode1","$2b$10$hashedcode2"]',
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

    let capturedUserData: any = null;
    mockPrismaClient.user.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.user.createMany.mockImplementation(async ({ data }) => {
      capturedUserData = data;
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
    expect(result.warnings.some((w) => w.includes('2FA') && w.includes('could not be restored'))).toBe(true);
    expect(capturedUserData[0].twoFactorEnabled).toBe(false);
    expect(capturedUserData[0].twoFactorSecret).toBeNull();
    expect(capturedUserData[0].twoFactorBackupCodes).toBeNull();

    // Reset mocks
    vi.mocked(encryption.isEncrypted).mockReturnValue(false);
    vi.mocked(encryption.decrypt).mockImplementation((v: any) => v);
  });

  it('should preserve 2FA when secret can be decrypted', async () => {
    // Mock isEncrypted to return true, but decrypt succeeds
    vi.mocked(encryption.isEncrypted).mockReturnValue(true);
    vi.mocked(encryption.decrypt).mockReturnValue('decrypted-secret');

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
          twoFactorEnabled: true,
          twoFactorSecret: 'enc:v1:validencryptedsecret',
          twoFactorBackupCodes: '["$2b$10$hashedcode1"]',
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

    let capturedUserData: any = null;
    mockPrismaClient.user.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.user.createMany.mockImplementation(async ({ data }) => {
      capturedUserData = data;
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
    expect(result.warnings.length).toBe(0);
    expect(capturedUserData[0].twoFactorEnabled).toBe(true);
    expect(capturedUserData[0].twoFactorSecret).toBe('enc:v1:validencryptedsecret');

    // Reset mocks
    encryption.isEncrypted.mockReturnValue(false);
    encryption.decrypt.mockImplementation((v: any) => v);
  });
});
}
