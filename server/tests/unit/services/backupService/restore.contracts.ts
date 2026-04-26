import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupRestoreTests(): void {
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
      { tablename: 'mcp_api_keys' },
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
        'auditLog', 'mcpApiKey', 'hardwareDeviceModel', 'pushDevice', 'draftTransaction',
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

    it('should revoke restored MCP API keys so old bearer tokens fail closed', async () => {
      const backup = createValidBackup();
      backup.data.mcpApiKey = [
        {
          id: 'mcp-key-1',
          userId: 'user-1',
          name: 'LAN client',
          keyHash: 'a'.repeat(64),
          keyPrefix: 'mcp_aaaaaaaaaaa',
          scope: { walletIds: ['wallet-1'] },
          createdAt: new Date().toISOString(),
          revokedAt: null,
        },
      ];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      let capturedData: any = null;
      Object.keys(mockPrismaClient).forEach((key) => {
        const client = mockPrismaClient as any;
        if (client[key]?.deleteMany) {
          client[key].deleteMany.mockResolvedValue({ count: 0 });
        }
        if (client[key]?.createMany) {
          client[key].createMany.mockResolvedValue({ count: 0 });
        }
      });
      mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
        capturedData = data;
        return { count: 1 };
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain(
        '1 MCP API key restored revoked. Regenerate MCP client credentials after reviewing external access.',
      );
      expect(capturedData).toHaveLength(1);
      expect(capturedData[0].keyHash).toBe('a'.repeat(64));
      expect(capturedData[0].revokedAt).toBeInstanceOf(Date);
    });

    it('should disable restored AI provider credentials so provider secrets fail closed', async () => {
      const backup = createValidBackup();
      backup.data.systemSetting = [
        {
          id: 'setting-ai-provider-credentials',
          key: 'aiProviderCredentials',
          value: JSON.stringify({
            'lan-ollama': {
              type: 'api-key',
              encryptedApiKey: 'encrypted-provider-secret',
              configuredAt: '2026-04-26T00:00:00.000Z',
            },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'setting-ai-enabled',
          key: 'aiEnabled',
          value: JSON.stringify(true),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      let capturedData: any = null;
      Object.keys(mockPrismaClient).forEach((key) => {
        const client = mockPrismaClient as any;
        if (client[key]?.deleteMany) {
          client[key].deleteMany.mockResolvedValue({ count: 0 });
        }
        if (client[key]?.createMany) {
          client[key].createMany.mockResolvedValue({ count: 0 });
        }
      });
      mockPrismaClient.systemSetting.createMany.mockImplementation(async ({ data }) => {
        capturedData = data;
        return { count: 1 };
      });

      const result = await backupService.restoreFromBackup(backup);
      const credentialRecord = capturedData.find((record: any) => record.key === 'aiProviderCredentials');
      const enabledRecord = capturedData.find((record: any) => record.key === 'aiEnabled');
      const restoredCredentials = JSON.parse(credentialRecord.value);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain(
        '1 AI provider credential restored disabled. Re-enter provider credentials in Admin > AI Settings before enabling external model access.',
      );
      expect(restoredCredentials).toEqual({
        'lan-ollama': {
          type: 'api-key',
          configuredAt: '2026-04-26T00:00:00.000Z',
          disabledReason: 'restored',
        },
      });
      expect(credentialRecord.value).not.toContain('encrypted-provider-secret');
      expect(enabledRecord.value).toBe(JSON.stringify(true));
    });

    it('should use plural warning text for multiple restored AI provider credentials', async () => {
      const backup = createValidBackup();
      backup.data.systemSetting = [
        {
          id: 'setting-ai-provider-credentials',
          key: 'aiProviderCredentials',
          value: JSON.stringify({
            'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted-one' },
            'lab-openai': { type: 'api-key', encryptedApiKey: 'encrypted-two' },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

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
      expect(result.warnings).toContain(
        '2 AI provider credentials restored disabled. Re-enter provider credentials in Admin > AI Settings before enabling external model access.',
      );
    });

    it('should not warn when restored AI provider credentials were already disabled', async () => {
      const backup = createValidBackup();
      backup.data.systemSetting = [
        {
          id: 'setting-ai-provider-credentials',
          key: 'aiProviderCredentials',
          value: JSON.stringify({
            'lan-ollama': {
              type: 'api-key',
              configuredAt: '2026-04-26T00:00:00.000Z',
              disabledReason: 'restored',
            },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

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
      expect(result.warnings).toEqual([]);
    });

    it('should keep already revoked MCP API keys revoked without extra warnings', async () => {
      const backup = createValidBackup();
      const revokedAt = '2026-01-02T03:04:05.000Z';
      backup.data.mcpApiKey = [
        {
          id: 'mcp-key-1',
          userId: 'user-1',
          name: 'Old LAN client',
          keyHash: 'b'.repeat(64),
          keyPrefix: 'mcp_bbbbbbbbbbb',
          scope: { walletIds: ['wallet-1'] },
          createdAt: new Date().toISOString(),
          revokedAt,
        },
      ];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      let capturedData: any = null;
      Object.keys(mockPrismaClient).forEach((key) => {
        const client = mockPrismaClient as any;
        if (client[key]?.deleteMany) {
          client[key].deleteMany.mockResolvedValue({ count: 0 });
        }
        if (client[key]?.createMany) {
          client[key].createMany.mockResolvedValue({ count: 0 });
        }
      });
      mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
        capturedData = data;
        return { count: 1 };
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(capturedData).toHaveLength(1);
      expect(capturedData[0].revokedAt).toEqual(new Date(revokedAt));
    });

    it('should use plural warning text when multiple restored MCP API keys are revoked', async () => {
      const backup = createValidBackup();
      backup.data.mcpApiKey = [
        {
          id: 'mcp-key-1',
          userId: 'user-1',
          name: 'LAN client',
          keyHash: 'c'.repeat(64),
          keyPrefix: 'mcp_ccccccccccc',
          scope: { walletIds: ['wallet-1'] },
          createdAt: new Date().toISOString(),
          revokedAt: null,
        },
        {
          id: 'mcp-key-2',
          userId: 'user-1',
          name: 'Lab client',
          keyHash: 'd'.repeat(64),
          keyPrefix: 'mcp_ddddddddddd',
          scope: { walletIds: ['wallet-1'] },
          createdAt: new Date().toISOString(),
          revokedAt: null,
        },
      ];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      let capturedData: any = null;
      Object.keys(mockPrismaClient).forEach((key) => {
        const client = mockPrismaClient as any;
        if (client[key]?.deleteMany) {
          client[key].deleteMany.mockResolvedValue({ count: 0 });
        }
        if (client[key]?.createMany) {
          client[key].createMany.mockResolvedValue({ count: 0 });
        }
      });
      mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
        capturedData = data;
        return { count: 2 };
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain(
        '2 MCP API keys restored revoked. Regenerate MCP client credentials after reviewing external access.',
      );
      expect(capturedData).toHaveLength(2);
      expect(capturedData[0].revokedAt).toBeInstanceOf(Date);
      expect(capturedData[1].revokedAt).toBe(capturedData[0].revokedAt);
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
}
