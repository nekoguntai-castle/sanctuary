import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMockBackupLogger,
  getMockClearAccessCacheStrict,
  getMockFeatureRuntimeReconcile,
  mockAllBackupTablesExist,
} from './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';
import {
  CACHE_TABLES,
  COMPLETE_TABLE_POLICY_HASH,
  COMPLETE_TABLE_POLICY_VERSION,
  EPHEMERAL_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import {
  FEATURE_RUNTIME_GENERATION_KEY,
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
} from '../../../../src/repositories/operationalSystemSettings';

export function registerBackupRestoreTests(): void {
describe('restoreFromBackup', () => {
  let backupService: BackupService;
  const mockClearAccessCacheStrict = getMockClearAccessCacheStrict();
  const mockBackupLogger = getMockBackupLogger();
  const mockFeatureRuntimeReconcile = getMockFeatureRuntimeReconcile();

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

  const mockAllTableWrites = () => {
    const client = mockPrismaClient as any;
    Object.keys(client).forEach((key) => {
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
  };

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    mockClearAccessCacheStrict.mockReset();
    mockClearAccessCacheStrict.mockResolvedValue(undefined);
    mockFeatureRuntimeReconcile.mockReset();
    mockFeatureRuntimeReconcile.mockResolvedValue(undefined);
    Object.values(mockBackupLogger).forEach((loggerMethod) => loggerMethod.mockClear());

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
    mockAllBackupTablesExist();
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
      expect(result.committed).toBe(true);
      expect(result.cacheInvalidated).toBe(true);
      expect(result.accessCacheReconciled).toBe(true);
      expect(result.featureRuntimeReconciled).toBe(true);
      const walletWrite = mockPrismaClient.wallet.createMany.mock.calls
        .flatMap(([args]) => args.data)[0];
      expect(walletWrite).toMatchObject({
        id: 'wallet-1',
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: null,
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 0,
      });
    });

    it('restores durable intent without importing active execution authority', async () => {
      const backup = createValidBackup();
      backup.data.wallet[0] = {
        ...backup.data.wallet[0],
        requestedIncrementalSyncGeneration: 5,
        claimedIncrementalSyncGeneration: 4,
        processedIncrementalSyncGeneration: 3,
        incrementalSyncLeaseToken: '11111111-1111-4111-8111-111111111111',
        incrementalSyncClaimedAt: '2026-08-22T10:00:00.000Z',
        incrementalSyncLeaseExpiresAt: '2026-08-22T10:05:00.000Z',
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 2,
        requestedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: '2026-08-22T10:00:00.000Z',
        lastSyncStatus: 'syncing',
      };
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();

      await expect(backupService.restoreFromBackup(backup)).resolves.toMatchObject({
        success: true,
      });
      const walletWrite = mockPrismaClient.wallet.createMany.mock.calls
        .flatMap(([args]) => args.data)[0];
      expect(walletWrite).toMatchObject({
        requestedIncrementalSyncGeneration: 5,
        claimedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 3,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 2,
        requestedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
        syncInProgress: false,
        syncExecutionOwner: null,
        syncStartedAt: null,
        lastSyncStatus: 'retrying',
      });
    });

    it('should clear access cache only after the restore transaction commits', async () => {
      const backup = createValidBackup();
      const events: string[] = [];

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => {
        events.push('transaction-start');
        const result = await fn(mockPrismaClient);
        events.push('transaction-commit');
        return result;
      });
      mockClearAccessCacheStrict.mockImplementation(async () => {
        events.push('access-cache-clear');
      });
      mockFeatureRuntimeReconcile.mockImplementation(async () => {
        events.push('feature-runtime-reconcile');
      });
      mockAllTableWrites();

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(mockClearAccessCacheStrict).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        'transaction-start',
        'transaction-commit',
        'access-cache-clear',
        'feature-runtime-reconcile',
      ]);
      expect(mockFeatureRuntimeReconcile).toHaveBeenCalledWith({
        generation: '1',
        flags: [],
      });
    });

    it('preserves a live scheduler floor instead of accepting a backup replacement', async () => {
      const backup = createValidBackup();
      backup.data.systemSetting = [
        {
          id: 'backup-floor',
          key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
          value: JSON.stringify({
            version: 1,
            forbiddenAt: '2000-01-01T00:00:00.000Z',
            compatibilityFloor: 2,
          }),
        },
        { id: 'ordinary', key: 'registrationEnabled', value: 'true' },
      ];
      const liveFloor = {
        id: 'live-floor',
        key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
        value: JSON.stringify({
          version: 1,
          forbiddenAt: '2026-08-22T00:00:00.000Z',
          compatibilityFloor: 2,
        }),
        createdAt: new Date('2026-08-22T00:00:00.000Z'),
        updatedAt: new Date('2026-08-22T00:00:00.000Z'),
      };
      const liveGeneration = {
        id: 'live-generation',
        key: FEATURE_RUNTIME_GENERATION_KEY,
        value: '7',
        createdAt: new Date('2026-08-22T00:00:00.000Z'),
        updatedAt: new Date('2026-08-22T00:00:00.000Z'),
      };
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([liveFloor, liveGeneration]);
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      const writes = mockPrismaClient.systemSetting.createMany.mock.calls
        .map(([args]) => args.data as Array<{ key: string; value: string }>);
      expect(writes).toContainEqual([expect.objectContaining({
        key: 'registrationEnabled',
        value: 'true',
      })]);
      expect(writes).toContainEqual([liveFloor, liveGeneration]);
      expect(writes.flat().filter(({ key }) => key === STALE_WALLET_SCHEDULE_FORBIDDEN_KEY))
        .toEqual([liveFloor]);
    });

    it('restores a valid scheduler floor into an empty recovery database', async () => {
      const backup = createValidBackup();
      const backupFloor = {
        id: 'backup-floor',
        key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
        value: JSON.stringify({
          version: 1,
          forbiddenAt: '2026-08-22T00:00:00.000Z',
          compatibilityFloor: 2,
        }),
      };
      backup.data.systemSetting = [backupFloor];
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([]);
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      const writes = mockPrismaClient.systemSetting.createMany.mock.calls
        .flatMap(([args]) => args.data as Array<{ key: string; value: string }>);
      expect(writes.filter(({ key }) => key === STALE_WALLET_SCHEDULE_FORBIDDEN_KEY))
        .toEqual([backupFloor]);
    });

    it('should not clear access cache when validation fails before the transaction', async () => {
      const backup = createValidBackup() as any;
      delete backup.data.wallet;

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.committed).toBe(false);
      expect(result.cacheInvalidated).toBe(false);
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      expect(mockClearAccessCacheStrict).not.toHaveBeenCalled();
    });

    it('should not clear access cache when restore preflight fails before the transaction', async () => {
      const backup = createValidBackup();
      mockPrismaClient.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.committed).toBe(false);
      expect(result.error).toContain('Restore preflight failed: missing live database tables');
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      expect(mockClearAccessCacheStrict).not.toHaveBeenCalled();
    });

    it('should surface post-commit access cache invalidation failures', async () => {
      const backup = createValidBackup();

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();
      mockClearAccessCacheStrict.mockRejectedValueOnce(new Error('cache down'));

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.committed).toBe(true);
      expect(result.cacheInvalidated).toBe(false);
      expect(result.tablesRestored).toBeGreaterThan(0);
      expect(result.recordsRestored).toBeGreaterThan(0);
      expect(result.error).toContain('Restore committed but access cache invalidation failed: cache down');
      expect(result.featureRuntimeReconciled).toBe(true);
      expect(mockFeatureRuntimeReconcile).toHaveBeenCalledTimes(1);
    });

    it('should report committed recovery pending when feature runtime reconciliation fails', async () => {
      const backup = createValidBackup();
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();
      mockFeatureRuntimeReconcile.mockRejectedValueOnce(new Error('worker acknowledgement missing'));

      const result = await backupService.restoreFromBackup(backup);

      expect(result).toMatchObject({
        success: false,
        committed: true,
        cacheInvalidated: true,
        accessCacheReconciled: true,
        featureRuntimeReconciled: false,
      });
      expect(result.error).toContain('worker acknowledgement missing');
      expect(result.error).toContain('Restore committed but feature runtime reconciliation failed');
      expect(mockClearAccessCacheStrict).toHaveBeenCalledTimes(1);
    });

    it('should time out hung post-commit access cache invalidation', async () => {
      vi.useFakeTimers();
      const backup = createValidBackup();

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();
      mockClearAccessCacheStrict.mockImplementation(() => new Promise<void>(() => undefined));

      const resultPromise = backupService.restoreFromBackup(backup);
      let result!: Awaited<ReturnType<BackupService['restoreFromBackup']>>;
      try {
        await vi.advanceTimersByTimeAsync(5_000);
        result = await resultPromise;
      } finally {
        vi.useRealTimers();
      }

      expect(result.success).toBe(false);
      expect(result.committed).toBe(true);
      expect(result.cacheInvalidated).toBe(false);
      expect(result.error).toContain('Access cache invalidation timed out after 5000ms');
    });

    it('should observe late access cache rejection after a timeout', async () => {
      vi.useFakeTimers();
      const backup = createValidBackup();
      let rejectCacheClear!: (error: Error) => void;

      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
      mockAllTableWrites();
      mockClearAccessCacheStrict.mockImplementation(() => new Promise<void>((_, reject) => {
        rejectCacheClear = reject;
      }));

      const resultPromise = backupService.restoreFromBackup(backup);
      try {
        await vi.advanceTimersByTimeAsync(5_000);
        rejectCacheClear(new Error('late redis failure'));
        await Promise.resolve();

        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.committed).toBe(true);
        expect(result.cacheInvalidated).toBe(false);
        expect(result.error).toContain('Access cache invalidation timed out after 5000ms');
        expect(mockBackupLogger.warn).toHaveBeenCalledWith(
          '[BACKUP] Access cache invalidation failed after restore timeout',
          { error: 'late redis failure' }
        );
      } finally {
        vi.useRealTimers();
      }
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
      mockAllBackupTablesExist();
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

    it('should restore the complete durable graph and invalidate cache and ephemeral state', async () => {
      const backup = createValidBackup();
      backup.meta.version = '1.1.0';
      backup.meta.tablePolicy = {
        version: COMPLETE_TABLE_POLICY_VERSION,
        hash: COMPLETE_TABLE_POLICY_HASH,
      };
      for (const table of TABLE_ORDER) {
        backup.data[table] ??= [];
      }
      backup.data.user[0].preferences = {
        fiatCurrency: 'EUR',
        telegram: {
          enabled: true,
          botToken: 'restored-bot-token',
          chatId: 'restored-chat-id',
          wallets: { 'wallet-1': { enabled: true } },
        },
      };
      backup.data.user.push({
        id: 'user-2',
        username: 'preferences-only',
        password: '$2a$10$hash',
        isAdmin: false,
        sessionVersion: 0,
        preferences: { fiatCurrency: 'USD' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      backup.data.systemSetting = [
        { id: 'smtp-host', key: 'smtp.host', value: JSON.stringify('smtp.example.test') },
        { id: 'smtp-user', key: 'smtp.user', value: JSON.stringify('mailer') },
        { id: 'smtp-password', key: 'smtp.password', value: JSON.stringify('encrypted-password') },
        { id: 'smtp-from', key: 'smtp.fromAddress', value: JSON.stringify('mail@example.test') },
        { id: 'smtp-port', key: 'smtp.port', value: JSON.stringify(587) },
        { id: 'unrelated', key: 'confirmationThreshold', value: JSON.stringify(6) },
      ];
      backup.data.deviceUser = [{ id: 'device-user-1' }];
      backup.data.deviceAccount = [{ id: 'device-account-1' }];
      backup.data.webhookEndpoint = [{
        id: 'endpoint-1',
        enabled: true,
        secretEncrypted: 'encrypted-secret',
        headerConfig: {
          headers: {
            Authorization: 'Bearer restored-secret',
          },
        },
      }];
      backup.data.webhookDelivery = [{ id: 'delivery-1' }];
      backup.data.vaultPolicy = [{ id: 'policy-1' }];
      backup.data.approvalRequest = [{ id: 'approval-1' }];
      backup.data.featureFlag = [{ id: 'flag-1' }];
      backup.data.featureFlagAudit = [{ id: 'flag-audit-1' }];
      backup.data.aIConversation = [{ id: 'conversation-1' }];
      backup.data.aIMessage = [{
        id: 'message-1',
        content: '2026-07-30T12:34:56.000Z',
        metadata: {
          timestampLabel: '2026-07-30T12:34:56.000Z',
          markerText: '__bigint__42',
        },
        createdAt: '2026-07-30T12:34:56.000Z',
      }];
      backup.data.aIInsight = [{ id: 'insight-1' }];
      backup.data.agentApiKey = [{ id: 'agent-key-1', revokedAt: null }];
      backup.meta.recordCounts = Object.fromEntries(
        Object.entries(backup.data).map(([table, records]) => [table, records.length])
      );

      const client = mockPrismaClient as any;
      const allTables = [...TABLE_ORDER, ...CACHE_TABLES, ...EPHEMERAL_TABLES];
      mockPrismaClient.$queryRaw.mockResolvedValue(
        allTables.map((table) => ({ tablename: camelToSnakeCase(table) }))
      );
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      const insertOrder: string[] = [];
      let restoredUsers: any[] = [];
      let restoredSettings: any[] = [];
      let restoredWebhookEndpoints: any[] = [];
      let restoredWebhookDeliveries: any[] = [];
      let restoredAgentKeys: any[] = [];
      let restoredAiMessages: any[] = [];
      client.user.findMany.mockResolvedValue([{ id: 'user-1', sessionVersion: 7 }]);
      for (const table of allTables) {
        client[table].deleteMany.mockResolvedValue({ count: 0 });
        client[table].createMany.mockImplementation(async ({ data }: { data: any[] }) => {
          insertOrder.push(table);
          return { count: data.length };
        });
      }
      client.webhookEndpoint.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('webhookEndpoint');
        restoredWebhookEndpoints = data;
        return { count: data.length };
      });
      client.agentApiKey.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('agentApiKey');
        restoredAgentKeys = data;
        return { count: data.length };
      });
      client.webhookDelivery.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('webhookDelivery');
        restoredWebhookDeliveries = data;
        return { count: data.length };
      });
      client.user.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('user');
        restoredUsers = data;
        return { count: data.length };
      });
      client.systemSetting.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('systemSetting');
        restoredSettings = data;
        return { count: data.length };
      });
      client.aIMessage.createMany.mockImplementation(async ({ data }: { data: any[] }) => {
        insertOrder.push('aIMessage');
        restoredAiMessages = data;
        return { count: data.length };
      });

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(true);
      expect(insertOrder.indexOf('webhookEndpoint')).toBeLessThan(insertOrder.indexOf('webhookDelivery'));
      expect(insertOrder.indexOf('vaultPolicy')).toBeLessThan(insertOrder.indexOf('approvalRequest'));
      expect(insertOrder.indexOf('aIConversation')).toBeLessThan(insertOrder.indexOf('aIMessage'));
      expect(restoredWebhookEndpoints[0]).toMatchObject({
        enabled: false,
        secretEncrypted: null,
        headerConfig: null,
      });
      expect(restoredWebhookDeliveries[0]).toMatchObject({
        status: 'dead',
        nextAttemptAt: null,
      });
      expect(restoredAgentKeys[0].revokedAt).toBeInstanceOf(Date);
      expect(restoredUsers[0].sessionVersion).toBe(8);
      expect(restoredUsers[0].preferences).toMatchObject({
        fiatCurrency: 'EUR',
        telegram: {
          enabled: false,
          botToken: '',
          chatId: '',
          wallets: { 'wallet-1': { enabled: true } },
        },
      });
      expect(restoredUsers[1].preferences).toEqual({ fiatCurrency: 'USD' });
      expect(restoredSettings.find(record => record.key === 'smtp.host').value)
        .toBe(JSON.stringify(''));
      expect(restoredSettings.find(record => record.key === 'smtp.password').value)
        .toBe(JSON.stringify(''));
      expect(restoredSettings.find(record => record.key === 'smtp.port').value)
        .toBe(JSON.stringify(587));
      expect(restoredSettings.find(record => record.key === 'confirmationThreshold').value)
        .toBe(JSON.stringify(6));
      expect(restoredAiMessages[0]).toMatchObject({
        content: '2026-07-30T12:34:56.000Z',
        metadata: {
          timestampLabel: '2026-07-30T12:34:56.000Z',
          markerText: '__bigint__42',
        },
      });
      expect(restoredAiMessages[0].createdAt).toBeInstanceOf(Date);
      expect(client.priceData.deleteMany).toHaveBeenCalled();
      expect(client.feeEstimate.deleteMany).toHaveBeenCalled();
      for (const table of EPHEMERAL_TABLES) {
        expect(client[table].deleteMany).toHaveBeenCalled();
        expect(client[table].createMany).not.toHaveBeenCalled();
      }
    });

    it('should fail closed when a user session version cannot be incremented safely', async () => {
      const backup = createValidBackup();
      backup.data.user[0].sessionVersion = 2_147_483_647;
      mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

      const result = await backupService.restoreFromBackup(backup);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot safely invalidate sessions for restored user user-1');
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
