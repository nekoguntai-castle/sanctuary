import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupServiceCoreTests(): void {
describe('BackupService', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('validateBackup', () => {
    const createValidBackup = (): SanctuaryBackup => ({
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { user: 1, wallet: 1 },
      },
      data: {
        user: [
          {
            id: 'user-1',
            username: 'admin',
            password: '$2a$10$hash',
            isAdmin: true,
            twoFactorEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
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

    it('should validate a properly structured backup', async () => {
      const backup = createValidBackup();
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject backup without meta section', async () => {
      const backup = { data: {} };
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing meta section');
    });

    it('should reject backup without data section', async () => {
      const backup = { meta: { version: '1.0.0' } };
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing data section');
    });

    it('should reject backup without version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).version;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing backup format version');
    });

    it('should reject backup without schema version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).schemaVersion;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing schema version');
    });

    it('should reject backup from future schema version', async () => {
      const backup = createValidBackup();
      backup.meta.schemaVersion = 999;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('too far ahead'))).toBe(true);
    });

    it('should reject backup without any users', async () => {
      const backup = createValidBackup();
      backup.data.user = [];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one user');
    });

    it('should reject backup without admin user', async () => {
      const backup = createValidBackup();
      backup.data.user = [
        {
          id: 'user-1',
          username: 'regular',
          password: '$2a$10$hash',
          isAdmin: false, // Not an admin
          twoFactorEnabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one admin user');
    });

    it('should detect referential integrity issues for devices', async () => {
      const backup = createValidBackup();
      backup.data.device = [
        {
          id: 'device-1',
          userId: 'nonexistent-user', // References non-existent user
          type: 'ledger',
          label: 'My Ledger',
          fingerprint: 'aabbccdd',
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('references non-existent user'))).toBe(true);
    });

    it('should accept devices that reference existing users', async () => {
      const backup = createValidBackup();
      backup.data.device = [
        {
          id: 'device-1',
          userId: 'user-1',
          type: 'ledger',
          label: 'Valid Device',
          fingerprint: 'ddccbbaa',
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.includes('references non-existent user'))).toBe(false);
    });

    it('should detect referential integrity issues for walletUser', async () => {
      const backup = createValidBackup();
      backup.data.wallet = [
        {
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          createdAt: new Date().toISOString(),
        },
      ];
      backup.data.walletUser = [
        {
          walletId: 'nonexistent-wallet',
          userId: 'user-1',
          role: 'owner',
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('references non-existent wallet'))).toBe(true);
    });

    it('should detect walletUser entries that reference non-existent users', async () => {
      const backup = createValidBackup();
      backup.data.wallet = [
        {
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          createdAt: new Date().toISOString(),
        },
      ];
      backup.data.walletUser = [
        {
          walletId: 'wallet-1',
          userId: 'non-existent-user',
          role: 'owner',
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('references non-existent user'))).toBe(true);
    });

    it('should warn about missing tables', async () => {
      const backup = createValidBackup();
      delete (backup.data as any).label;

      const result = await backupService.validateBackup(backup);

      expect(result.warnings.some((w) => w.includes('Missing table'))).toBe(true);
    });

    it('should reject non-array table data', async () => {
      const backup = createValidBackup();
      (backup.data as any).wallet = 'not an array';

      // The validation currently doesn't catch this gracefully - it throws when
      // trying to .map() on non-array. This test documents current behavior.
      // In a future improvement, validation should catch this earlier.
      await expect(backupService.validateBackup(backup)).rejects.toThrow();
    });

    it('should include info in result', async () => {
      const backup = createValidBackup();
      const result = await backupService.validateBackup(backup);

      expect(result.info.createdAt).toBeDefined();
      expect(result.info.appVersion).toBe('0.4.0');
      expect(result.info.schemaVersion).toBe(1);
      expect(result.info.totalRecords).toBeGreaterThan(0);
      expect(result.info.tables.length).toBeGreaterThan(0);
    });

    it('should reject null input', async () => {
      const result = await backupService.validateBackup(null);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid backup format: not an object');
    });

    it('should reject non-object input', async () => {
      const result = await backupService.validateBackup('not an object');

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid backup format: not an object');
    });

    it('should warn about missing app version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).appVersion;

      const result = await backupService.validateBackup(backup);

      expect(result.warnings).toContain('Missing app version');
    });

    it('should handle missing user table and missing createdAt metadata gracefully', async () => {
      const backup = createValidBackup() as any;
      delete backup.data.user;
      delete backup.data.device;
      delete backup.meta.createdAt;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('Missing table: user'))).toBe(true);
      expect(result.info.createdAt).toBe('');
    });

    it('should ignore non-array extra tables when calculating total records', async () => {
      const backup = createValidBackup() as any;
      backup.data.extraTable = 'not-an-array';

      const result = await backupService.validateBackup(backup);
      expect(result.valid).toBe(true);
      expect(result.info.totalRecords).toBeGreaterThan(0);
    });
  });

  describe('getFormatVersion', () => {
    it('should return the current format version', () => {
      const version = backupService.getFormatVersion();

      expect(version).toBe('1.0.0');
    });
  });

  describe('createBackup', () => {
    beforeEach(() => {
      // Setup default mock returns for all tables
      // Using type assertion to access dynamic properties
      const client = mockPrismaClient as any;
      const tables = [
        'hardwareDeviceModel', 'systemSetting', 'nodeConfig', 'user', 'group',
        'groupMember', 'device', 'wallet', 'pushDevice', 'walletUser',
        'walletDevice', 'address', 'label', 'draftTransaction', 'transaction',
        'uTXO', 'transactionLabel', 'addressLabel', 'auditLog',
      ];

      tables.forEach((table) => {
        if (client[table]) {
          client[table].findMany.mockResolvedValue([]);
        }
      });

      // Return at least one admin user
      mockPrismaClient.user.findMany.mockResolvedValue([
        { ...sampleUsers.admin, id: 'admin-1' },
      ]);
    });

    it('should create backup with meta information', async () => {
      const backup = await backupService.createBackup('admin');

      expect(backup.meta).toBeDefined();
      expect(backup.meta.version).toBe('1.0.0');
      expect(backup.meta.createdBy).toBe('admin');
      expect(backup.meta.createdAt).toBeDefined();
      expect(backup.meta.includesCache).toBe(false);
    });

    it('should include description when provided', async () => {
      const backup = await backupService.createBackup('admin', {
        description: 'Pre-upgrade backup',
      });

      expect(backup.meta.description).toBe('Pre-upgrade backup');
    });

    it('should include record counts', async () => {
      mockPrismaClient.user.findMany.mockResolvedValue([
        { ...sampleUsers.admin, id: 'admin-1' },
        { ...sampleUsers.regularUser, id: 'user-1' },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.meta.recordCounts.user).toBe(2);
    });

    it('should serialize BigInt values', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          id: 'utxo-1',
          txid: 'abc123',
          vout: 0,
          amount: BigInt(1000000),
        },
      ]);

      const backup = await backupService.createBackup('admin');

      const utxoData = backup.data.uTXO[0];
      expect(utxoData.amount).toBe('__bigint__1000000');
    });

    it('should serialize Date values as ISO strings', async () => {
      const testDate = new Date('2024-01-15T10:30:00Z');
      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          ...sampleUsers.admin,
          id: 'admin-1',
          createdAt: testDate,
        },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.user[0].createdAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle tables that fail to export', async () => {
      mockPrismaClient.wallet.findMany.mockRejectedValue(new Error('DB error'));

      const backup = await backupService.createBackup('admin');

      expect(backup.data.wallet).toEqual([]);
      expect(backup.meta.recordCounts.wallet).toBe(0);
    });

    it('should include cache tables when requested', async () => {
      const backup = await backupService.createBackup('admin', { includeCache: true });

      expect(backup.meta.includesCache).toBe(true);
      expect(backup.data).toHaveProperty('priceData');
      expect(backup.data).toHaveProperty('feeEstimate');
    });

    it('should paginate large tables using cursor when exporting', async () => {
      const firstPage = Array.from({ length: 1000 }, (_, i) => ({
        id: `tx-${i}`,
        txid: `hash-${i}`,
      }));
      const secondPage = [
        { id: 'tx-1000', txid: 'hash-1000' },
      ];

      mockPrismaClient.transaction.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const backup = await backupService.createBackup('admin');

      expect(mockPrismaClient.transaction.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          take: 1000,
          orderBy: { id: 'asc' },
        })
      );
      expect(mockPrismaClient.transaction.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          take: 1000,
          skip: 1,
          cursor: { id: 'tx-999' },
          orderBy: { id: 'asc' },
        })
      );
      expect(backup.data.transaction).toHaveLength(1001);
    });

    it('should serialize array fields recursively', async () => {
      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          ...sampleUsers.admin,
          id: 'admin-1',
          tags: [BigInt(1), { nested: BigInt(2) }],
        },
      ]);

      const backup = await backupService.createBackup('admin');
      expect(backup.data.user[0].tags).toEqual(['__bigint__1', { nested: '__bigint__2' }]);
    });
  });

  describe('serialization helpers', () => {
    it('should correctly handle nested objects with BigInt', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          amount: BigInt(500000),
          fee: BigInt(1000),
          nested: {
            value: BigInt(100),
          },
        },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.transaction[0].amount).toBe('__bigint__500000');
      expect(backup.data.transaction[0].fee).toBe('__bigint__1000');
      expect(backup.data.transaction[0].nested.value).toBe('__bigint__100');
    });
  });
});
}
