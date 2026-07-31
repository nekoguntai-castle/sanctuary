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
  });
}
