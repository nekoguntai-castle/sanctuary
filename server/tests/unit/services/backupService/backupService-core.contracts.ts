import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getBackupOnlyModelMock } from './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';
import { migrationService } from '../../../../src/services/migrationService';
import {
  CACHE_TABLES,
  COMPLETE_TABLE_POLICY_HASH,
  COMPLETE_TABLE_POLICY,
  COMPLETE_TABLE_POLICY_VERSION,
  PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH,
  PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH,
  EPHEMERAL_TABLES,
  getRestoreTables,
  LARGE_TABLE_CURSOR_FIELDS,
  LEGACY_TABLE_ORDER,
  PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH,
  PREVIOUS_COMPLETE_TABLE_POLICY_HASH,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import {
  deserializeRecordForTable,
  RESTORE_BIGINT_FIELDS,
  RESTORE_DATE_FIELDS,
} from '../../../../src/services/backupService/restoreDeserialization';
import {
  processNodeConfigRecords,
  processUserRecords,
  processWebhookDeliveryRecords,
  processWebhookEndpointRecords,
} from '../../../../src/services/backupService/restoreTransforms';

export function registerBackupServiceCoreTests(): void {
describe('BackupService', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    vi.clearAllMocks();
    vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(1);
  });

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

  describe('validateBackup', () => {
    it('should validate a properly structured backup', async () => {
      const backup = createValidBackup();
      const result = await backupService.validateBackup(backup);

      expect(result.valid, result.issues.join('; ')).toBe(true);
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

      expect(result.valid, result.issues.join('; ')).toBe(true);
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

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Table wallet is not an array');
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

  describe('validateBackupForRestore', () => {
    const createSameSchemaLegacyBackup = (): SanctuaryBackup => {
      const backup = createValidBackup();
      for (const table of LEGACY_TABLE_ORDER) {
        backup.data[table] ??= [];
      }
      backup.meta.schemaVersion = 61;
      return backup;
    };

    const createCompleteBackup = (): SanctuaryBackup => {
      const backup = createSameSchemaLegacyBackup();
      for (const table of TABLE_ORDER) {
        backup.data[table] ??= [];
      }
      backup.meta.version = '1.1.0';
      backup.meta.tablePolicy = {
        version: COMPLETE_TABLE_POLICY_VERSION,
        hash: COMPLETE_TABLE_POLICY_HASH,
      };
      backup.meta.recordCounts = Object.fromEntries(
        Object.entries(backup.data).map(([table, records]) => [table, records.length])
      );
      return backup;
    };

    const addSubscriptionCheckpointGraph = (
      backup: SanctuaryBackup,
      options: { includeWallet?: boolean; includeAddress?: boolean; checkpointNetwork?: string } = {},
    ): void => {
      if (options.includeWallet !== false) {
        backup.data.wallet.push({ id: 'wallet-mainnet', network: 'mainnet' });
      }
      if (options.includeAddress !== false) {
        backup.data.address.push({
          id: 'address-mainnet',
          walletId: 'wallet-mainnet',
          address: 'bc1qcheckpoint',
        });
      }
      backup.data.addressSubscriptionCheckpoint.push({
        addressId: 'address-mainnet',
        network: options.checkpointNetwork ?? 'mainnet',
      });
      backup.meta.recordCounts.wallet = backup.data.wallet.length;
      backup.meta.recordCounts.address = backup.data.address.length;
      backup.meta.recordCounts.addressSubscriptionCheckpoint = 1;
    };

    it.each([
      [PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH, true],
      [PREVIOUS_COMPLETE_TABLE_POLICY_HASH, false],
      [PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH, true],
      [PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH, true],
    ])('accepts recognized prior complete policy %s', async (hash, includesRepairQueue) => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      backup.meta.tablePolicy!.hash = hash;
      if (!includesRepairQueue) {
        delete backup.data.transactionOwnershipRepair;
        delete backup.meta.recordCounts.transactionOwnershipRepair;
      }

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid, result.issues.join('; ')).toBe(true);
      expect(getRestoreTables(backup.meta).includes('transactionOwnershipRepair')).toBe(
        includesRepairQueue
      );
      expect(getRestoreTables(backup.meta).includes('addressSubscriptionCheckpoint')).toBe(false);
    });

    it('should return structure validation for non-object restore input', async () => {
      const result = await backupService.validateBackupForRestore(null);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid backup format: not an object');
    });

    it('should return metadata validation before restore completeness checks', async () => {
      const backup = createValidBackup() as any;
      delete backup.meta.schemaVersion;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing schema version');
      expect(result.issues).not.toContain('Missing required restore table: wallet');
    });

    it('should reject a partial destructive restore backup missing a baseline table', async () => {
      const backup = createValidBackup() as any;
      delete backup.data.wallet;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing required restore table: wallet');
    });

    it('should reject a destructive restore when a required table is not array-shaped', async () => {
      const backup = createValidBackup() as any;
      backup.data.wallet = 'not an array';

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Required restore table wallet must be an array');
    });

    it('should reject future-schema backups for destructive restore', async () => {
      const backup = createValidBackup();
      backup.meta.schemaVersion = 5;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(
        result.issues.some((issue) => issue.includes('Cannot perform destructive restore from a future schema version'))
      ).toBe(true);
    });

    it('should require tables that are known for the backup schema version', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createValidBackup() as any;
      backup.meta.schemaVersion = 61;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing required restore table: walletAgent');
      expect(result.issues).toContain('Missing required restore table: consoleSession');
    });

    it('should accept a same-schema 1.0.0 backup under the explicit legacy policy', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createSameSchemaLegacyBackup();

      expect(backup.data).not.toHaveProperty('webhookEndpoint');
      expect(backup.data).not.toHaveProperty('vaultPolicy');
      expect(backup.data).not.toHaveProperty('aIConversation');

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(true);
    });

    it('should reject a 1.1.0 backup without its complete table-policy discriminator', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createSameSchemaLegacyBackup();
      backup.meta.version = '1.1.0';

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing table policy for backup format 1.1.0');
    });

    it('should reject an unknown table policy instead of downgrading to legacy rules', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createSameSchemaLegacyBackup() as SanctuaryBackup & {
        meta: BackupMeta & { tablePolicy: { version: string; hash: string } };
      };
      backup.meta.version = '1.1.0';
      backup.meta.tablePolicy = {
        version: 'complete-v999',
        hash: 'unknown',
      };

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Unknown table policy: complete-v999/unknown');
    });

    it('should reject unsupported backup format versions', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createSameSchemaLegacyBackup();
      backup.meta.version = '2.0.0';

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Unsupported backup format version: 2.0.0');
    });

    it('should reject a complete backup that omits a durable table', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      delete backup.data.webhookDelivery;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing required restore table: webhookDelivery');
    });

    it('rejects subscription checkpoints whose network differs from the owning wallet', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      addSubscriptionCheckpointGraph(backup, { checkpointNetwork: 'signet' });

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain(
        'AddressSubscriptionCheckpoint address-mainnet network signet does not match owning wallet wallet-mainnet network mainnet',
      );
    });

    it('rejects subscription checkpoints without an included address', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      addSubscriptionCheckpointGraph(backup, { includeAddress: false });

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain(
        'AddressSubscriptionCheckpoint address-mainnet references non-existent address',
      );
    });

    it('rejects subscription checkpoints whose address has no included wallet', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      addSubscriptionCheckpointGraph(backup, { includeWallet: false });

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain(
        'AddressSubscriptionCheckpoint address-mainnet references address with non-existent wallet wallet-mainnet',
      );
    });

    it('accepts subscription checkpoints on the owning wallet network', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      addSubscriptionCheckpointGraph(backup);

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid, result.issues.join('; ')).toBe(true);
    });

    it('should reject a downgraded complete policy on a 1.0.0 backup', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createSameSchemaLegacyBackup();
      backup.meta.tablePolicy = {
        version: COMPLETE_TABLE_POLICY_VERSION,
        hash: COMPLETE_TABLE_POLICY_HASH,
      };

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Table policy is not allowed for legacy backup format 1.0.0');
    });

    it('should reject a truncated table whose record count no longer matches', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      backup.data.user.push({
        id: 'user-2',
        username: 'second-admin',
        isAdmin: true,
      });

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Record count mismatch for user: expected 1, found 2');
    });

    it('should reject non-integer and negative record counts', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const backup = createCompleteBackup();
      backup.meta.recordCounts.user = -1;
      backup.meta.recordCounts.wallet = 0.5;

      const result = await backupService.validateBackupForRestore(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid record count for user: -1');
      expect(result.issues).toContain('Invalid record count for wallet: 0.5');
    });

    it('should reject malformed and non-exact record-count manifests', async () => {
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(61);
      const malformed = createCompleteBackup();
      malformed.meta.recordCounts = null as unknown as Record<string, number>;

      const malformedResult = await backupService.validateBackupForRestore(malformed);

      expect(malformedResult.valid).toBe(false);
      expect(malformedResult.issues).toContain('Invalid recordCounts: expected an object');

      const extraCount = createCompleteBackup();
      extraCount.meta.recordCounts.missingTable = 0;

      const extraCountResult = await backupService.validateBackupForRestore(extraCount);

      expect(extraCountResult.valid).toBe(false);
      expect(extraCountResult.issues)
        .toContain('Record count provided for missing or invalid table: missingTable');
    });
  });

  describe('getFormatVersion', () => {
    it('should return the current format version', () => {
      const version = backupService.getFormatVersion();

      expect(version).toBe('1.1.0');
    });
  });

  describe('createBackup', () => {
    beforeEach(() => {
      // Setup default mock returns for all tables
      // Using type assertion to access dynamic properties
      const client = mockPrismaClient as any;
      const tables = [
        'hardwareDeviceModel', 'systemSetting', 'nodeConfig', 'user', 'mcpApiKey', 'group',
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
      expect(backup.meta.version).toBe('1.1.0');
      expect((backup.meta as BackupMeta & { tablePolicy?: unknown }).tablePolicy).toEqual({
        version: 'complete-v1',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
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

    it('should abort when any table fails to export', async () => {
      mockPrismaClient.wallet.findMany.mockRejectedValue(new Error('DB error'));

      await expect(backupService.createBackup('admin')).rejects.toThrow('DB error');
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

    it('should declare the non-id cursor beside every paginated table', () => {
      expect(LARGE_TABLE_CURSOR_FIELDS.get('addressSubscriptionCheckpoint')).toBe('addressId');
      expect(
        [...LARGE_TABLE_CURSOR_FIELDS.entries()]
          .filter(([table]) => table !== 'addressSubscriptionCheckpoint')
          .every(([, cursorField]) => cursorField === 'id')
      ).toBe(true);
    });

    it('should paginate address subscription checkpoints by their addressId primary key', async () => {
      const checkpointModel = getBackupOnlyModelMock('addressSubscriptionCheckpoint');
      const firstPage = Array.from({ length: 1000 }, (_, i) => ({
        addressId: `address-${i}`,
        network: 'mainnet',
      }));
      const secondPage = [
        { addressId: 'address-1000', network: 'mainnet' },
      ];

      checkpointModel.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const backup = await backupService.createBackup('admin');

      expect(checkpointModel.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          take: 1000,
          skip: 1,
          cursor: { addressId: 'address-999' },
          orderBy: { addressId: 'asc' },
        })
      );
      expect(backup.data.addressSubscriptionCheckpoint).toHaveLength(1001);
    });

    it.each([undefined, ''])('should reject an invalid checkpoint pagination cursor %p', async (addressId) => {
      const checkpointModel = getBackupOnlyModelMock('addressSubscriptionCheckpoint');
      const page = Array.from({ length: 1000 }, (_, i) => ({
        addressId: i === 999 ? addressId : `address-${i}`,
        network: 'mainnet',
      }));
      checkpointModel.findMany.mockResolvedValueOnce(page);

      await expect(backupService.createBackup('admin')).rejects.toThrow(
        'Backup pagination cursor addressSubscriptionCheckpoint.addressId must be a non-empty string'
      );
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

    it('should include every newly durable relation in the canonical export order', () => {
      expect(TABLE_ORDER).toEqual(expect.arrayContaining([
        'deviceAccount',
        'deviceUser',
        'webhookEndpoint',
        'webhookDelivery',
        'ownershipTransfer',
        'mobilePermission',
        'featureFlag',
        'featureFlagAudit',
        'vaultPolicy',
        'approvalRequest',
        'approvalVote',
        'policyEvent',
        'policyAddress',
        'policyUsageWindow',
        'aIInsight',
        'aIConversation',
        'aIMessage',
        'addressSubscriptionCheckpoint',
      ]));
    });

    it('should export representative records from every previously omitted durable graph', async () => {
      const client = mockPrismaClient as any;
      client.deviceUser.findMany.mockResolvedValue([{ id: 'device-user-1' }]);
      client.deviceAccount.findMany.mockResolvedValue([{ id: 'device-account-1' }]);
      client.webhookEndpoint.findMany.mockResolvedValue([{ id: 'webhook-1' }]);
      client.webhookDelivery.findMany.mockResolvedValue([{ id: 'delivery-1' }]);
      client.vaultPolicy.findMany.mockResolvedValue([{ id: 'policy-1' }]);
      client.approvalRequest.findMany.mockResolvedValue([{ id: 'approval-1' }]);
      client.featureFlag.findMany.mockResolvedValue([{ id: 'flag-1' }]);
      client.featureFlagAudit.findMany.mockResolvedValue([{ id: 'flag-audit-1' }]);
      client.aIConversation.findMany.mockResolvedValue([{ id: 'conversation-1' }]);
      client.aIMessage.findMany.mockResolvedValue([{ id: 'message-1' }]);
      client.aIInsight.findMany.mockResolvedValue([{ id: 'insight-1' }]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.deviceUser).toEqual([{ id: 'device-user-1' }]);
      expect(backup.data.deviceAccount).toEqual([{ id: 'device-account-1' }]);
      expect(backup.data.webhookEndpoint).toEqual([{ id: 'webhook-1' }]);
      expect(backup.data.webhookDelivery).toEqual([{ id: 'delivery-1' }]);
      expect(backup.data.vaultPolicy).toEqual([{ id: 'policy-1' }]);
      expect(backup.data.approvalRequest).toEqual([{ id: 'approval-1' }]);
      expect(backup.data.featureFlag).toEqual([{ id: 'flag-1' }]);
      expect(backup.data.featureFlagAudit).toEqual([{ id: 'flag-audit-1' }]);
      expect(backup.data.aIConversation).toEqual([{ id: 'conversation-1' }]);
      expect(backup.data.aIMessage).toEqual([{ id: 'message-1' }]);
      expect(backup.data.aIInsight).toEqual([{ id: 'insight-1' }]);
      expect(backup.data).not.toHaveProperty('pushDevice');
    });

    it('should classify every Prisma model exactly once', () => {
      const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
      const schemaModels = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)]
        .map((match) => match[1])
        .sort();
      const classifiedModels = COMPLETE_TABLE_POLICY.map((entry) => entry.model).sort();
      const classifiedTables = [
        ...TABLE_ORDER,
        ...CACHE_TABLES,
        ...EPHEMERAL_TABLES,
      ];

      expect(classifiedModels).toEqual(schemaModels);
      expect(new Set(classifiedModels).size).toBe(classifiedModels.length);
      expect(new Set(classifiedTables).size).toBe(classifiedTables.length);
      expect(
        createHash('sha256').update(JSON.stringify(COMPLETE_TABLE_POLICY)).digest('hex')
      ).toBe(COMPLETE_TABLE_POLICY_HASH);
      expect(EPHEMERAL_TABLES).toEqual(expect.arrayContaining([
        'pushDevice',
        'transactionSigningIntent',
        'refreshToken',
        'revokedRefreshSessionFamily',
        'revokedToken',
        'emailVerificationToken',
      ]));
    });

    it('should classify every restored Prisma DateTime and BigInt field', () => {
      const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
      const restoredTables = new Set([...TABLE_ORDER, ...CACHE_TABLES]);
      const expectedDates: Record<string, string[]> = {};
      const expectedBigInts: Record<string, string[]> = {};

      for (const match of schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)) {
        const policy = COMPLETE_TABLE_POLICY.find(entry => entry.model === match[1]);
        if (!policy || !restoredTables.has(policy.table)) continue;
        for (const field of match[2].matchAll(/^\s*(\w+)\s+(DateTime|BigInt)(?:\?|\[\])?/gm)) {
          const target = field[2] === 'DateTime' ? expectedDates : expectedBigInts;
          (target[policy.table] ??= []).push(field[1]);
        }
      }

      expect(RESTORE_DATE_FIELDS).toEqual(expectedDates);
      expect(RESTORE_BIGINT_FIELDS).toEqual(expectedBigInts);
    });

    it('should never coerce ISO-looking strings or numeric-key JSON values', () => {
      const record = deserializeRecordForTable('aIMessage', {
        content: '2026-07-30T12:34:56.000Z',
        metadata: { 0: 'zero', marker: '__bigint__42' },
        createdAt: '2026-07-30T12:34:56.000Z',
      });

      expect(record.content).toBe('2026-07-30T12:34:56.000Z');
      expect(record.metadata).toEqual({ 0: 'zero', marker: '__bigint__42' });
      expect(record.createdAt).toBeInstanceOf(Date);
    });

    it('should deserialize only declared legacy array, DateTime, and BigInt fields', () => {
      const record = deserializeRecordForTable('draftTransaction', {
        selectedUtxoIds: { 1: 'utxo-b', 0: 'utxo-a' },
        inputPaths: [],
        signedDeviceIds: { label: 'not-an-array' },
        createdAt: '2026-07-30T12:34:56.000Z',
        updatedAt: null,
        amount: '__bigint__42',
        fee: 'plain-string',
      });

      expect(record.selectedUtxoIds).toEqual(['utxo-a', 'utxo-b']);
      expect(record.inputPaths).toEqual([]);
      expect(record.signedDeviceIds).toEqual({ label: 'not-an-array' });
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeNull();
      expect(record.amount).toBe(42n);
      expect(record.fee).toBe('plain-string');
      expect(deserializeRecordForTable('unknown', { value: null })).toEqual({ value: null });
    });

    it('should restore both private transaction repair cursors as dates', () => {
      const record = deserializeRecordForTable('transaction', {
        classificationLastAttemptAt: '2026-07-30T12:34:56.000Z',
        ioLastAttemptAt: '2026-07-31T12:34:56.000Z',
      });

      expect(record.classificationLastAttemptAt).toBeInstanceOf(Date);
      expect(record.ioLastAttemptAt).toBeInstanceOf(Date);
    });

    it('should disable zero, one, or multiple restored node proxy configurations', () => {
      const noCredentialWarnings: string[] = [];
      expect(processNodeConfigRecords(
        [{ id: 'node-0', proxyEnabled: false, proxyPassword: null }],
        noCredentialWarnings
      )).toEqual([{ id: 'node-0', proxyEnabled: false, proxyPassword: null }]);
      expect(noCredentialWarnings).toEqual([]);

      const warnings: string[] = [];
      const records = processNodeConfigRecords([
        { id: 'node-1', proxyEnabled: false, proxyPassword: 'secret' },
        { id: 'node-2', proxyEnabled: true, proxyPassword: null },
      ], warnings);

      expect(records).toEqual([
        { id: 'node-1', proxyEnabled: false, proxyPassword: null },
        { id: 'node-2', proxyEnabled: false, proxyPassword: null },
      ]);
      expect(warnings[0]).toContain('2 node proxy configurations restored disabled');
    });

    it('should clear every webhook credential shape and preserve terminal deliveries', () => {
      const noCredentialWarnings: string[] = [];
      processWebhookEndpointRecords(
        [{ id: 'endpoint-0', enabled: false, secretEncrypted: null, headerConfig: null }],
        noCredentialWarnings
      );
      expect(noCredentialWarnings).toEqual([]);

      const warnings: string[] = [];
      const endpoints = processWebhookEndpointRecords([
        { id: 'endpoint-1', enabled: false, secretEncrypted: 'secret', headerConfig: null },
        { id: 'endpoint-2', enabled: false, secretEncrypted: null, headerConfig: { headers: {} } },
      ], warnings);
      expect(endpoints).toEqual([
        { id: 'endpoint-1', enabled: false, secretEncrypted: null, headerConfig: null },
        { id: 'endpoint-2', enabled: false, secretEncrypted: null, headerConfig: null },
      ]);
      expect(warnings[0]).toContain('2 webhook endpoints restored disabled');

      const delivered = {
        id: 'delivery-1',
        status: 'delivered',
        requestHeadersRedacted: { 'X-Arbitrary': 'legacy-secret' },
      };
      const dead = { id: 'delivery-2', status: 'dead', requestHeadersRedacted: ['malformed'] };
      const pending = {
        id: 'delivery-3',
        status: 'pending',
        nextAttemptAt: 'later',
        requestHeadersRedacted: { Authorization: 'Bearer legacy' },
      };
      expect(processWebhookDeliveryRecords([delivered, dead, pending])).toEqual([
        { ...delivered, requestHeadersRedacted: { 'X-Arbitrary': '[REDACTED]' } },
        { ...dead, requestHeadersRedacted: null },
        expect.objectContaining({
          id: 'delivery-3',
          status: 'dead',
          nextAttemptAt: null,
          requestHeadersRedacted: { Authorization: '[REDACTED]' },
        }),
      ]);
    });

    it('should disable each Telegram credential shape without warning for an empty config', () => {
      const warnings: string[] = [];
      const records = processUserRecords([
        {
          id: 'user-empty',
          username: 'empty',
          preferences: { telegram: { enabled: false, botToken: '', chatId: '' } },
        },
        {
          id: 'user-enabled',
          username: 'enabled',
          preferences: { telegram: { enabled: true, botToken: '', chatId: '' } },
        },
        {
          id: 'user-token',
          username: 'token',
          preferences: { telegram: { enabled: false, botToken: 'token', chatId: '' } },
        },
        {
          id: 'user-chat',
          username: 'chat',
          preferences: { telegram: { enabled: false, botToken: '', chatId: 'chat' } },
        },
      ], warnings, new Map());

      expect(records).toHaveLength(4);
      expect(warnings).toHaveLength(3);
      expect(records.every(record =>
        (record.preferences as { telegram: { enabled: boolean } }).telegram.enabled === false
      )).toBe(true);
    });

    it('should identify an invalid maximum session version even without a user id', () => {
      expect(() => processUserRecords(
        [{ username: 'missing-id', sessionVersion: 2_147_483_647 }],
        [],
        new Map()
      )).toThrow('Cannot safely invalidate sessions for restored user <unknown>');
    });
  });

});
}
