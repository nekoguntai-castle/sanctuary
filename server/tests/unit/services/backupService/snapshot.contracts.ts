import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers } from '../../../fixtures/bitcoin';
import { BackupService } from '../../../../src/services/backupService';
import {
  BACKUP_TRANSACTION_MAX_WAIT_MS,
  BACKUP_TRANSACTION_TIMEOUT_MS,
} from '../../../../src/services/backupService/creation';
import {
  BACKUP_PAGE_SIZE,
  CACHE_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import { migrationService } from '../../../../src/services/migrationService';
import {
  FEATURE_RUNTIME_GENERATION_KEY,
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  WALLET_SYNC_ACTIVATION_KEY,
} from '../../../../src/repositories/operationalSystemSettings';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../../src/constants/walletSyncActivation';
import {
  processSystemSettingRecords,
  processWalletSyncIntentRecords,
} from '../../../../src/services/backupService/restoreTransforms';

const validFloorValue = JSON.stringify({
  version: 1,
  forbiddenAt: '2026-08-22T00:00:00.000Z',
  compatibilityFloor: 2,
});
const validActivationValue = JSON.stringify({
  version: 1,
  activatedAt: '2026-08-22T01:00:00.000Z',
  mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
});
const futureActivationValue = JSON.stringify({
  version: 1,
  activatedAt: '2026-08-22T01:00:00.000Z',
  mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
});

export function registerBackupSnapshotTests(): void {
  describe('BackupService snapshot creation', () => {
    let backupService: BackupService;

    beforeEach(() => {
      backupService = new BackupService();
      resetPrismaMocks();
      vi.clearAllMocks();
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(1);
    });

    it('exports all tables and schema metadata in one repeatable-read snapshot', async () => {
      await backupService.createBackup('admin');

      expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        {
          isolationLevel: 'RepeatableRead',
          maxWait: BACKUP_TRANSACTION_MAX_WAIT_MS,
          timeout: BACKUP_TRANSACTION_TIMEOUT_MS,
        },
      );
      expect(migrationService.getSchemaVersion).toHaveBeenCalledWith(mockPrismaClient);
    });

    it('uses the transaction callback client instead of root delegates', async () => {
      const transactionClient = Object.fromEntries(
        [...TABLE_ORDER, ...CACHE_TABLES].map((table) => [
          table,
          { findMany: vi.fn().mockResolvedValue([]) },
        ]),
      ) as Record<string, { findMany: ReturnType<typeof vi.fn> }>;
      transactionClient.user.findMany.mockResolvedValue([
        { ...sampleUsers.admin, id: 'snapshot-admin' },
      ]);
      mockPrismaClient.$transaction.mockImplementationOnce(async (callback: any) => (
        callback(transactionClient)
      ));

      const backup = await backupService.createBackup('admin');

      expect(backup.data.user).toEqual([
        expect.objectContaining({ id: 'snapshot-admin' }),
      ]);
      expect(mockPrismaClient.user.findMany).not.toHaveBeenCalled();
      expect(migrationService.getSchemaVersion).toHaveBeenCalledWith(transactionClient);
    });

    it('aborts paginated export before another page or schema query', async () => {
      const controller = new AbortController();
      const firstPage = Array.from({ length: 1000 }, (_, index) => ({
        id: `tx-${index}`,
      }));
      mockPrismaClient.transaction.findMany.mockImplementationOnce(async () => {
        controller.abort();
        return firstPage;
      });

      await expect(backupService.createBackup('admin', { signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' });

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledOnce();
      expect(migrationService.getSchemaVersion).not.toHaveBeenCalled();
    });

    it('streams a backup one export page per write and parses to the createBackup document', async () => {
      const page = (start: number, length: number) => Array.from({ length }, (_, index) => ({
        id: `tx-${String(start + index).padStart(6, '0')}`,
        amount: BigInt(start + index),
        blockTime: new Date('2026-11-05T01:00:00.000Z'),
        memo: undefined,
      }));
      const stubPages = () => {
        mockPrismaClient.transaction.findMany
          .mockResolvedValueOnce(page(0, BACKUP_PAGE_SIZE))
          .mockResolvedValueOnce(page(BACKUP_PAGE_SIZE, 500));
        mockPrismaClient.user.findMany.mockResolvedValueOnce([{ ...sampleUsers.admin, id: 'streamed-admin' }]);
      };

      stubPages();
      const chunks: string[] = [];
      const meta = await backupService.writeBackup('admin', async (chunk) => {
        chunks.push(chunk);
      }, { description: 'nightly' });

      // Non-regression: the whole document is never one string. No write holds
      // more than one export page of records.
      const recordsPerChunk = chunks.map(chunk => chunk.match(/"id":"tx-/g)?.length ?? 0);
      expect(Math.max(...recordsPerChunk)).toBe(BACKUP_PAGE_SIZE);
      expect(recordsPerChunk.filter(count => count > 0)).toEqual([BACKUP_PAGE_SIZE, 500]);

      const streamed = JSON.parse(chunks.join(''));
      expect(streamed.meta).toEqual(meta);
      expect(meta.recordCounts).toMatchObject({ transaction: 1500, user: 1 });
      expect(meta.description).toBe('nightly');

      stubPages();
      const built = await backupService.createBackup('admin', { description: 'nightly' });
      expect(streamed.data).toEqual(JSON.parse(JSON.stringify(built.data)));
      expect({ ...streamed.meta, createdAt: built.meta.createdAt }).toEqual(built.meta);
      expect(Object.keys(streamed.data)).toEqual([...TABLE_ORDER]);
      expect(streamed.data.transaction[0]).toEqual({
        id: 'tx-000000',
        amount: '__bigint__0',
        blockTime: '2026-11-05T01:00:00.000Z',
      });
    });

    it('writes valid JSON for an empty database', async () => {
      const chunks: string[] = [];
      const meta = await backupService.writeBackup('admin', async (chunk) => {
        chunks.push(chunk);
      }, { includeCache: true });

      const streamed = JSON.parse(chunks.join(''));
      expect(Object.keys(streamed.data)).toEqual([...TABLE_ORDER, ...CACHE_TABLES]);
      expect(Object.values(streamed.data).every(rows => Array.isArray(rows) && rows.length === 0)).toBe(true);
      expect(meta.includesCache).toBe(true);
    });

    it('stops exporting when the writer fails', async () => {
      await expect(backupService.writeBackup('admin', async () => {
        throw new Error('disk full');
      })).rejects.toThrow('disk full');

      expect(mockPrismaClient.user.findMany).not.toHaveBeenCalled();
      expect(migrationService.getSchemaVersion).not.toHaveBeenCalled();
    });

    it('aborts a streamed export before the next page', async () => {
      const controller = new AbortController();
      mockPrismaClient.transaction.findMany.mockImplementationOnce(async () => {
        controller.abort();
        return Array.from({ length: BACKUP_PAGE_SIZE }, (_, index) => ({ id: `tx-${index}` }));
      });

      await expect(backupService.writeBackup('admin', async () => undefined, { signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' });

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledOnce();
      expect(migrationService.getSchemaVersion).not.toHaveBeenCalled();
    });

    it('aborts the backup when snapshot schema metadata cannot be read', async () => {
      vi.mocked(migrationService.getSchemaVersion)
        .mockRejectedValueOnce(new Error('snapshot query failed'));

      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('snapshot query failed');
    });

    it('exports irreversible wallet-sync floors but excludes ephemeral operational metadata', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'op', key: FEATURE_RUNTIME_GENERATION_KEY, value: '99' },
        { id: 'floor', key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { id: 'activation', key: WALLET_SYNC_ACTIVATION_KEY, value: validActivationValue },
        { id: 'durable', key: 'registrationEnabled', value: 'true' },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.systemSetting).toEqual([
        expect.objectContaining({ key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY }),
        expect.objectContaining({ key: WALLET_SYNC_ACTIVATION_KEY }),
        expect.objectContaining({ key: 'registrationEnabled' }),
      ]);
      expect(backup.meta.recordCounts.systemSetting).toBe(3);
    });

    it('fails backup creation when the durable scheduler floor is malformed', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'floor', key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: '{}' },
      ]);

      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('Invalid durable stale-wallet schedule tombstone');

      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'floor', key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: null },
      ]);
      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('Invalid durable stale-wallet schedule tombstone');
    });

    it('fails backup creation when the durable activation marker is malformed', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'activation', key: WALLET_SYNC_ACTIVATION_KEY, value: '{}' },
      ]);

      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('Invalid durable wallet-sync activation policy');

      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'activation', key: WALLET_SYNC_ACTIVATION_KEY, value: null },
      ]);
      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('Invalid durable wallet-sync activation policy');
    });

    it('refuses to export an activation marker above the current binary floor', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([{
        id: 'activation',
        key: WALLET_SYNC_ACTIVATION_KEY,
        value: futureActivationValue,
      }]);

      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('Wallet-sync activation requires mutation-fence floor');
    });

    it('allows only valid backup floors when their live records do not exist', () => {
      expect(processSystemSettingRecords([
        { key: FEATURE_RUNTIME_GENERATION_KEY, value: '999999' },
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { key: WALLET_SYNC_ACTIVATION_KEY, value: validActivationValue },
        { key: 'registrationEnabled', value: 'true' },
      ], [])).toEqual([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { key: WALLET_SYNC_ACTIVATION_KEY, value: validActivationValue },
        { key: 'registrationEnabled', value: 'true' },
      ]);
      expect(processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { key: WALLET_SYNC_ACTIVATION_KEY, value: validActivationValue },
      ], [], new Set([
        STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
        WALLET_SYNC_ACTIVATION_KEY,
      ]))).toEqual([]);
      expect(() => processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: '{}' },
      ], [])).toThrow('Invalid durable stale-wallet schedule tombstone');
      expect(() => processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: null },
      ], [])).toThrow('Invalid durable stale-wallet schedule tombstone');
      expect(() => processSystemSettingRecords([
        { key: WALLET_SYNC_ACTIVATION_KEY, value: '{}' },
      ], [])).toThrow('Invalid durable wallet-sync activation policy');
      expect(() => processSystemSettingRecords([
        { key: WALLET_SYNC_ACTIVATION_KEY, value: null },
      ], [])).toThrow('Invalid durable wallet-sync activation policy');
      expect(() => processSystemSettingRecords([
        { key: WALLET_SYNC_ACTIVATION_KEY, value: futureActivationValue },
      ], [])).toThrow('Wallet-sync activation requires mutation-fence floor');
    });

    it('backfills old wallet backups with the same conservative sync intent as SQL', () => {
      const updatedAt = new Date('2026-08-21T00:00:00.000Z');
      const [quiet, neverSynced, active, failed, failedWithoutTimestamp, prepared] = processWalletSyncIntentRecords([
        { id: 'quiet', lastSyncedAt: new Date(), lastSyncStatus: 'success', syncInProgress: false },
        { id: 'never', lastSyncedAt: null, lastSyncStatus: null, syncInProgress: false },
        { id: 'active', lastSyncedAt: new Date(), lastSyncStatus: 'syncing', syncInProgress: true },
        { id: 'failed', lastSyncedAt: new Date(), lastSyncStatus: 'failed', syncInProgress: false, updatedAt },
        { id: 'failed-no-time', lastSyncedAt: new Date(), lastSyncStatus: 'failed', syncInProgress: false },
        { id: 'prepared', lastSyncedAt: null, processedFullResyncGeneration: 3 },
      ]);

      expect(quiet.requestedIncrementalSyncGeneration).toBe(0);
      expect(neverSynced.requestedIncrementalSyncGeneration).toBe(1);
      expect(active.requestedIncrementalSyncGeneration).toBe(1);
      expect(failed).toMatchObject({
        requestedIncrementalSyncGeneration: 1,
        syncActionRequiredAt: updatedAt,
      });
      expect(failedWithoutTimestamp.syncActionRequiredAt).toBeNull();
      expect(prepared).toMatchObject({
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 0,
      });
      for (const record of [quiet, neverSynced, active, failed, failedWithoutTimestamp, prepared]) {
        expect(record).toMatchObject({
          claimedIncrementalSyncGeneration: 0,
          processedIncrementalSyncGeneration: 0,
          incrementalSyncLeaseToken: null,
        });
      }
    });

    it('removes restored execution authority without erasing durable intent evidence', () => {
      const actionRequiredAt = new Date('2026-08-20T00:00:00.000Z');
      const active = {
        id: 'active-modern',
        requestedIncrementalSyncGeneration: 4,
        claimedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 2,
        incrementalSyncLeaseToken: 'token',
        incrementalSyncClaimedAt: new Date(),
        incrementalSyncLeaseExpiresAt: new Date(),
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 1,
        requestedFullResyncGeneration: 2,
        processedFullResyncGeneration: 1,
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
        lastSyncStatus: 'syncing',
      };
      const settled = {
        ...active,
        id: 'settled-modern',
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 2,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        syncActionRequiredAt: actionRequiredAt,
        requestedFullResyncGeneration: 1,
        syncInProgress: false,
        syncExecutionOwner: null,
        syncStartedAt: null,
        lastSyncStatus: 'failed',
      };

      const [restoredActive, restoredSettled] = processWalletSyncIntentRecords([active, settled]);
      expect(restoredActive).toMatchObject({
        requestedIncrementalSyncGeneration: 4,
        claimedIncrementalSyncGeneration: 2,
        processedIncrementalSyncGeneration: 2,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        preparedFullResyncGeneration: 1,
        requestedFullResyncGeneration: 2,
        processedFullResyncGeneration: 1,
        syncInProgress: false,
        // A worker-owned retry: the startup reaper only demotes null/inline owners.
        syncExecutionOwner: 'worker',
        syncStartedAt: null,
        lastSyncStatus: 'retrying',
      });
      expect(restoredSettled).toMatchObject({
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 2,
        processedIncrementalSyncGeneration: 2,
        syncActionRequiredAt: actionRequiredAt,
        lastSyncStatus: 'failed',
      });
    });

    it('retains active mixed-version work that has no durable pending generation', () => {
      const modernDefaultsWrittenByLegacyWorker = {
        id: 'mixed-active',
        requestedIncrementalSyncGeneration: 0,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 0,
        requestedFullResyncGeneration: 0,
        processedFullResyncGeneration: 0,
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
        lastSyncStatus: 'syncing',
      };
      const [restoredModern, restoredLegacy] = processWalletSyncIntentRecords([
        modernDefaultsWrittenByLegacyWorker,
        {
          id: 'legacy-active',
          lastSyncedAt: new Date(),
          lastSyncStatus: 'syncing',
          syncInProgress: true,
          syncExecutionOwner: 'inline',
          syncStartedAt: new Date(),
        },
      ]);

      for (const restored of [restoredModern, restoredLegacy]) {
        expect(restored).toMatchObject({
          requestedIncrementalSyncGeneration: 1,
          claimedIncrementalSyncGeneration: 0,
          processedIncrementalSyncGeneration: 0,
          incrementalSyncLeaseToken: null,
          syncInProgress: false,
          syncExecutionOwner: 'worker',
          syncStartedAt: null,
          lastSyncStatus: 'retrying',
        });
      }
    });

    it('rejects active legacy work when its generation cannot advance', () => {
      expect(() => processWalletSyncIntentRecords([{
        id: 'exhausted-active',
        requestedIncrementalSyncGeneration: 2_147_483_647,
        claimedIncrementalSyncGeneration: 2_147_483_647,
        processedIncrementalSyncGeneration: 2_147_483_647,
        incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
        incrementalSyncClaimedAt: new Date(),
        incrementalSyncLeaseExpiresAt: new Date(),
        syncActionRequiredAt: null,
        preparedFullResyncGeneration: 0,
        requestedFullResyncGeneration: 0,
        processedFullResyncGeneration: 0,
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
        lastSyncStatus: 'syncing',
      }])).toThrow('Restored wallet sync generation cannot retain active legacy work');
    });

    it('rejects partial compatibility state', () => {
      expect(() => processWalletSyncIntentRecords([
        { id: 'partial', requestedIncrementalSyncGeneration: 1 },
      ])).toThrow('partial incremental-sync compatibility state');
    });
  });
}
