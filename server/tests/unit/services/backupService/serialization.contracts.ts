import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { BackupService } from '../../../../src/services/backupService';
import { migrationService } from '../../../../src/services/migrationService';

export function registerBackupSerializationTests(): void {
  describe('BackupService serialization helpers', () => {
    let backupService: BackupService;

    beforeEach(() => {
      backupService = new BackupService();
      resetPrismaMocks();
      vi.clearAllMocks();
      vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(1);
    });

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
      const transactions = Reflect.get(backup.data, 'transaction');
      expect(transactions).toEqual([
        expect.objectContaining({
          amount: '__bigint__500000',
          fee: '__bigint__1000',
          nested: { value: '__bigint__100' },
        }),
      ]);
    });
  });
}
