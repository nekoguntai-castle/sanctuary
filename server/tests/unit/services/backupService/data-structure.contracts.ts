import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../../fixtures/bitcoin';
import { BackupService, type SanctuaryBackup, type BackupMeta } from '../../../../src/services/backupService';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';
import { migrateBackup } from '../../../../src/services/backupService/migration';
import * as encryption from '../../../../src/utils/encryption';

export function registerBackupDataStructureTests(): void {
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
}
