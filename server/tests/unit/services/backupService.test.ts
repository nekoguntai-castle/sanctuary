import { vi } from 'vitest';
/**
 * Backup Service Tests
 *
 * Tests for backup validation logic, serialization, and migration handling.
 * These tests focus on the validation and data transformation logic,
 * not actual database operations.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../fixtures/bitcoin';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock migration service
vi.mock('../../../src/services/migrationService', () => ({
  migrationService: {
    getSchemaVersion: vi.fn().mockResolvedValue(1),
  },
  getExpectedSchemaVersion: vi.fn().mockReturnValue(1),
}));

// Mock encryption
vi.mock('../../../src/utils/encryption', () => ({
  isEncrypted: vi.fn().mockReturnValue(false),
  decrypt: vi.fn().mockImplementation((v) => v),
}));

import { BackupService, SanctuaryBackup, BackupMeta } from '../../../src/services/backupService';
import { camelToSnakeCase } from '../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../src/services/backupService/migration';
import * as encryption from '../../../src/utils/encryption';

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

describe('Backup Data Structure', () => {
  describe('BigInt serialization format', () => {
    it('should use __bigint__ prefix for identification', () => {
      const marker = '__bigint__';
      const value = '12345';
      const serialized = `${marker}${value}`;

      expect(serialized.startsWith(marker)).toBe(true);
      expect(serialized.replace(marker, '')).toBe(value);
    });
  });

  describe('Date serialization format', () => {
    it('should use ISO 8601 format', () => {
      const date = new Date('2024-06-15T14:30:00Z');
      const serialized = date.toISOString();

      expect(serialized).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});

describe('restoreFromBackup', () => {
  let backupService: BackupService;

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
      wallet: [
        {
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          createdAt: new Date().toISOString(),
        },
      ],
      walletUser: [
        {
          id: 'wu-1',
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'owner',
        },
      ],
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

    // Mock getExistingTables to return common tables
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'wallets' },
      { tablename: 'wallet_users' },
      { tablename: 'devices' },
      { tablename: 'addresses' },
      { tablename: 'transactions' },
      { tablename: 'utxos' },
      { tablename: 'labels' },
      { tablename: 'groups' },
      { tablename: 'group_members' },
      { tablename: 'node_configs' },
      { tablename: 'system_settings' },
      { tablename: 'audit_logs' },
      { tablename: 'hardware_device_models' },
      { tablename: 'push_devices' },
      { tablename: 'draft_transactions' },
      { tablename: 'wallet_devices' },
      { tablename: 'transaction_labels' },
      { tablename: 'address_labels' },
    ]);
  });

  describe('successful restore', () => {
    it('should restore a minimal backup successfully', async () => {
      const backup = createValidBackup();

      // Mock transaction to execute the callback
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => {
        return fn(mockPrismaClient);
      });

      // Mock deleteMany and createMany for all tables
      const tables = [
        'user', 'wallet', 'walletUser', 'device', 'address', 'transaction',
        'uTXO', 'label', 'group', 'groupMember', 'nodeConfig', 'systemSetting',
        'auditLog', 'hardwareDeviceModel', 'pushDevice', 'draftTransaction',
        'walletDevice', 'transactionLabel', 'addressLabel',
      ];

      const client = mockPrismaClient as any;
      tables.forEach((table) => {
        if (client[table]) {
          client[table].deleteMany.mockResolvedValue({ count: 0 });
          client[table].createMany.mockResolvedValue({ count: 0 });
        }
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should restore with correct record counts', async () => {
      const backup = createValidBackup();
      backup.data.user.push({
        id: 'user-2',
        username: 'regular',
        password: '$2a$10$hash2',
        isAdmin: false,
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      // Setup mocks
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
      expect(result.recordsRestored).toBeGreaterThan(0);
    });

    it('should restore in dependency order', async () => {
      const backup = createValidBackup();
      const callOrder: string[] = [];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      // Track createMany call order
      const client = mockPrismaClient as any;
      ['user', 'wallet', 'walletUser'].forEach((table) => {
        if (client[table]) {
          client[table].deleteMany.mockResolvedValue({ count: 0 });
          client[table].createMany.mockImplementation(async () => {
            callOrder.push(table);
            return { count: 1 };
          });
        }
      });

      await backupService.restoreFromBackup(backup);

      // User should be restored before wallet, wallet before walletUser
      const userIdx = callOrder.indexOf('user');
      const walletIdx = callOrder.indexOf('wallet');
      const walletUserIdx = callOrder.indexOf('walletUser');

      expect(userIdx).toBeLessThan(walletIdx);
      expect(walletIdx).toBeLessThan(walletUserIdx);
    });

    it('should restore cache tables when backup includes cache data', async () => {
      const backup = createValidBackup();
      backup.meta.includesCache = true;
      backup.data.priceData = [
        { symbol: 'BTC', currency: 'USD', price: 50000, timestamp: new Date().toISOString() },
      ];
      backup.data.feeEstimate = [
        { network: 'mainnet', priority: 'normal', satsPerVbyte: 12, timestamp: new Date().toISOString() },
      ];

      mockPrismaClient.$queryRaw.mockResolvedValue([
        { tablename: 'users' },
        { tablename: 'wallets' },
        { tablename: 'wallet_users' },
        { tablename: 'price_data' },
        { tablename: 'fee_estimates' },
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

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(mockPrismaClient.priceData.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.feeEstimate.createMany).toHaveBeenCalled();
    });
  });

  describe('BigInt deserialization', () => {
    it('should restore BigInt values correctly', async () => {
      const backup = createValidBackup();
      backup.data.uTXO = [
        {
          id: 'utxo-1',
          walletId: 'wallet-1',
          txid: 'abc123',
          vout: 0,
          amount: '__bigint__1000000',
          scriptPubKey: 'script',
          spent: false,
        },
      ];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      let capturedData: any = null;
      mockPrismaClient.uTXO.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.uTXO.createMany.mockImplementation(async ({ data }) => {
        capturedData = data;
        return { count: 1 };
      });

      // Mock other tables
      Object.keys(mockPrismaClient).forEach((key) => {
        const client = mockPrismaClient as any;
        if (key !== 'uTXO' && client[key]?.deleteMany) {
          client[key].deleteMany.mockResolvedValue({ count: 0 });
        }
        if (key !== 'uTXO' && client[key]?.createMany) {
          client[key].createMany.mockResolvedValue({ count: 0 });
        }
      });

      await backupService.restoreFromBackup(backup);

      expect(capturedData).toBeDefined();
      expect(typeof capturedData[0].amount).toBe('bigint');
      expect(capturedData[0].amount).toBe(BigInt(1000000));
    });
  });

  describe('Date deserialization', () => {
    it('should restore Date values correctly', async () => {
      const backup = createValidBackup();
      const testDate = '2024-06-15T10:30:00.000Z';
      backup.data.user[0].createdAt = testDate;

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

      await backupService.restoreFromBackup(backup);

      expect(capturedData).toBeDefined();
      expect(capturedData[0].createdAt instanceof Date).toBe(true);
      expect(capturedData[0].createdAt.toISOString()).toBe(testDate);
    });
  });
});

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
