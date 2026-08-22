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
  CACHE_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import { migrationService } from '../../../../src/services/migrationService';
import {
  FEATURE_RUNTIME_GENERATION_KEY,
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
} from '../../../../src/repositories/operationalSystemSettings';
import {
  processSystemSettingRecords,
  processWalletSyncIntentRecords,
} from '../../../../src/services/backupService/restoreTransforms';

const validFloorValue = JSON.stringify({
  version: 1,
  forbiddenAt: '2026-08-22T00:00:00.000Z',
  compatibilityFloor: 2,
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

    it('aborts the backup when snapshot schema metadata cannot be read', async () => {
      vi.mocked(migrationService.getSchemaVersion)
        .mockRejectedValueOnce(new Error('snapshot query failed'));

      await expect(backupService.createBackup('admin'))
        .rejects.toThrow('snapshot query failed');
    });

    it('exports the irreversible scheduler floor but excludes ephemeral operational metadata', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { id: 'op', key: FEATURE_RUNTIME_GENERATION_KEY, value: '99' },
        { id: 'floor', key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { id: 'durable', key: 'registrationEnabled', value: 'true' },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.systemSetting).toEqual([
        expect.objectContaining({ key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY }),
        expect.objectContaining({ key: 'registrationEnabled' }),
      ]);
      expect(backup.meta.recordCounts.systemSetting).toBe(2);
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

    it('allows only a valid backup floor when no live floor exists', () => {
      expect(processSystemSettingRecords([
        { key: FEATURE_RUNTIME_GENERATION_KEY, value: '999999' },
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { key: 'registrationEnabled', value: 'true' },
      ], [])).toEqual([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
        { key: 'registrationEnabled', value: 'true' },
      ]);
      expect(processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: validFloorValue },
      ], [], new Set([STALE_WALLET_SCHEDULE_FORBIDDEN_KEY]))).toEqual([]);
      expect(() => processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: '{}' },
      ], [])).toThrow('Invalid durable stale-wallet schedule tombstone');
      expect(() => processSystemSettingRecords([
        { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY, value: null },
      ], [])).toThrow('Invalid durable stale-wallet schedule tombstone');
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
        syncExecutionOwner: null,
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
          syncExecutionOwner: null,
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
