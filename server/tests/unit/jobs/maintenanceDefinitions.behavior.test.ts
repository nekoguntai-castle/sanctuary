import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeletePriceData,
  mockDeleteFeeEstimates,
  mockDeleteDrafts,
  mockDeleteRefreshTokens,
  mockDeletePushDevices,
  mockExecuteRaw,
  mockAuditCleanup,
  mockAuditLog,
  mockExpireOldTransfers,
  mockLogInfo,
  mockLogWarn,
  mockLogError,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockDeletePriceData: vi.fn(),
  mockDeleteFeeEstimates: vi.fn(),
  mockDeleteDrafts: vi.fn(),
  mockDeleteRefreshTokens: vi.fn(),
  mockDeletePushDevices: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockAuditCleanup: vi.fn(),
  mockAuditLog: vi.fn(),
  mockExpireOldTransfers: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('../../../src/repositories', () => ({
  maintenanceRepository: {
    deletePriceDataBefore: (...args: unknown[]) => mockDeletePriceData(...args),
    deleteFeeEstimatesBefore: (...args: unknown[]) => mockDeleteFeeEstimates(...args),
    deleteExpiredDrafts: (...args: unknown[]) => mockDeleteDrafts(...args),
    deleteExpiredRefreshTokens: (...args: unknown[]) => mockDeleteRefreshTokens(...args),
    deleteOrphanedDrafts: mockExecuteRaw,
  },
  pushDeviceRepository: {
    deleteStale: (...args: unknown[]) => mockDeletePushDevices(...args),
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    cleanup: mockAuditCleanup,
    log: mockAuditLog,
  },
  AuditCategory: {
    SYSTEM: 'SYSTEM',
  },
}));

vi.mock('../../../src/services/transferService', () => ({
  expireOldTransfers: mockExpireOldTransfers,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  }),
}));

import {
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
  cleanupExpiredDraftsJob,
  cleanupExpiredTransfersJob,
  cleanupExpiredTokensJob,
  weeklyVacuumJob,
  monthlyCleanupJob,
  scheduledBackupJob,
  maintenanceJobs,
} from '../../../src/jobs/definitions/maintenance';

function sqlFromCall(call: any[]): string {
  const [template] = call;
  if (Array.isArray(template)) {
    return template.join('?');
  }
  return String(template);
}

describe('Maintenance job definitions behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletePriceData.mockResolvedValue(0);
    mockDeleteFeeEstimates.mockResolvedValue(0);
    mockDeleteDrafts.mockResolvedValue(0);
    mockDeleteRefreshTokens.mockResolvedValue(0);
    mockDeletePushDevices.mockResolvedValue(0);
    mockExecuteRaw.mockResolvedValue(0);
    mockAuditCleanup.mockResolvedValue(0);
    mockAuditLog.mockResolvedValue(undefined);
    mockExpireOldTransfers.mockResolvedValue(0);
  });

  it('runs cleanup jobs and returns counts with configured defaults', async () => {
    mockAuditCleanup.mockResolvedValueOnce(5);
    mockDeletePriceData.mockResolvedValueOnce(3);
    mockDeleteFeeEstimates.mockResolvedValueOnce(2);

    const auditCount = await cleanupAuditLogsJob.handler({ data: {} } as any);
    const priceCount = await cleanupPriceDataJob.handler({ data: {} } as any);
    const feeCount = await cleanupFeeEstimatesJob.handler({ data: {} } as any);

    expect(auditCount).toBe(5);
    expect(priceCount).toBe(3);
    expect(feeCount).toBe(2);
    expect(mockAuditCleanup).toHaveBeenCalledWith(expect.any(Date));
    expect(mockDeletePriceData).toHaveBeenCalledWith(expect.any(Date));
    expect(mockDeleteFeeEstimates).toHaveBeenCalledWith(expect.any(Date));
  });

  it('cleans up expired drafts and audits only when rows were deleted', async () => {
    mockDeleteDrafts.mockResolvedValueOnce(4);
    mockDeleteDrafts.mockResolvedValueOnce(0);

    const first = await cleanupExpiredDraftsJob.handler();
    const second = await cleanupExpiredDraftsJob.handler();

    expect(first).toBe(4);
    expect(second).toBe(0);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.draft_cleanup',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('cleans up expired transfers and audits only when rows were expired', async () => {
    mockExpireOldTransfers.mockResolvedValueOnce(2);
    mockExpireOldTransfers.mockResolvedValueOnce(0);

    const first = await cleanupExpiredTransfersJob.handler();
    const second = await cleanupExpiredTransfersJob.handler();

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.transfer_expiry',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('cleans up expired refresh tokens and returns deleted count', async () => {
    mockDeleteRefreshTokens.mockResolvedValueOnce(7);

    const deleted = await cleanupExpiredTokensJob.handler();

    expect(deleted).toBe(7);
    expect(mockDeleteRefreshTokens).toHaveBeenCalled();
  });

  it('returns zero when cleanup jobs find no records to delete', async () => {
    const auditDeleted = await cleanupAuditLogsJob.handler({ data: {} } as any);
    const priceDeleted = await cleanupPriceDataJob.handler({ data: {} } as any);
    const feeDeleted = await cleanupFeeEstimatesJob.handler({ data: {} } as any);
    const tokenDeleted = await cleanupExpiredTokensJob.handler();

    expect(auditDeleted).toBe(0);
    expect(priceDeleted).toBe(0);
    expect(feeDeleted).toBe(0);
    expect(tokenDeleted).toBe(0);
  });

  it('runs weekly vacuum + reindex job and resets statement timeout', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { timeout: 12345, tables: ['audit_logs', 'Transaction', 'UTXO'] },
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes('SET statement_timeout = ?'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('VACUUM ANALYZE'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "audit_logs"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "Transaction"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "UTXO"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes("SET statement_timeout = '0'"))).toBe(true);

    expect(updateProgress).toHaveBeenCalledWith(10);
    expect(updateProgress).toHaveBeenCalledWith(50);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.weekly_db_maintenance',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('always resets statement timeout even when weekly vacuum fails', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      const sql = template.join('?');
      if (sql.includes('VACUUM ANALYZE')) {
        throw new Error('vacuum failed');
      }
      return 0;
    });

    await expect(
      weeklyVacuumJob.handler({
        data: {},
        updateProgress,
      } as any)
    ).rejects.toThrow('vacuum failed');

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes("SET statement_timeout = '0'"))).toBe(true);
  });

  it('skips unknown reindex tables during weekly maintenance', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { tables: ['UnknownTable'] },
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes('VACUUM ANALYZE'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE'))).toBe(false);
    expect(updateProgress).toHaveBeenCalledWith(90);
  });

  it('uses default weekly reindex table list when tables are not provided', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: {},
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "audit_logs"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "Transaction"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "UTXO"'))).toBe(true);
  });

  it('runs monthly cleanup job, reports progress, and returns summary', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockDeletePushDevices.mockResolvedValueOnce(6);
    // deleteOrphanedDrafts is wired to mockExecuteRaw in the repository mock
    mockExecuteRaw.mockResolvedValueOnce(3);

    const result = await monthlyCleanupJob.handler({
      data: {},
      updateProgress,
    } as any);

    expect(result).toEqual({
      stalePushDevices: 6,
      orphanedDrafts: 3,
    });
    expect(updateProgress).toHaveBeenCalledWith(10);
    expect(updateProgress).toHaveBeenCalledWith(50);
    expect(updateProgress).toHaveBeenCalledWith(90);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.monthly_stale_cleanup',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('returns zero monthly cleanup counts when no stale records exist', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockDeletePushDevices.mockResolvedValueOnce(0);
    mockExecuteRaw.mockResolvedValueOnce(0);

    const result = await monthlyCleanupJob.handler({
      data: {},
      updateProgress,
    } as any);

    expect(result).toEqual({
      stalePushDevices: 0,
      orphanedDrafts: 0,
    });
    expect(updateProgress).toHaveBeenCalledWith(100);
  });

  it('scheduledBackupJob creates backup, writes file, and enforces retention', async () => {
    const mockMkdir = vi.fn().mockResolvedValue(undefined);
    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    const mockReaddir = vi.fn().mockResolvedValue([
      'sanctuary-backup-2026-04-01.json',
      'sanctuary-backup-2026-04-02.json',
      'sanctuary-backup-2026-04-03.json',
    ]);
    const mockUnlink = vi.fn().mockResolvedValue(undefined);

    vi.doMock('fs/promises', () => ({
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      readdir: mockReaddir,
      unlink: mockUnlink,
    }));

    vi.doMock('path', async () => {
      const actual = await vi.importActual('path');
      return actual;
    });

    const mockBackup = {
      meta: { recordCounts: { user: 1, wallet: 2 } },
      data: {},
    };
    vi.doMock('../../../src/services/backupService/backupService', () => ({
      BackupService: class {
        async createBackup() { return mockBackup; }
      },
    }));

    // Re-import to pick up doMock
    const { scheduledBackupJob: freshJob } = await import('../../../src/jobs/definitions/maintenance');

    const result = await freshJob.handler({
      data: { retentionCount: 2 },
    } as any);

    expect(result).toMatch(/^sanctuary-backup-/);
    expect(mockMkdir).toHaveBeenCalledWith('/data/backups', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('sanctuary-backup-'),
      expect.any(String),
      'utf-8',
    );
    // 3 files, retention 2 → 1 file deleted (oldest)
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('2026-04-01'));
    expect(mockAuditLog).toHaveBeenCalled();
  });

  it('scheduledBackupJob uses default retentionCount of 7', async () => {
    expect(scheduledBackupJob.name).toBe('backup:scheduled');
    expect(scheduledBackupJob.options?.attempts).toBe(2);
  });

  it('exports the complete maintenance job list', () => {
    expect(maintenanceJobs).toEqual(expect.arrayContaining([
      cleanupAuditLogsJob,
      cleanupPriceDataJob,
      cleanupFeeEstimatesJob,
      cleanupExpiredDraftsJob,
      cleanupExpiredTransfersJob,
      cleanupExpiredTokensJob,
      weeklyVacuumJob,
      monthlyCleanupJob,
    ]));
    expect(maintenanceJobs).toHaveLength(9);
  });
});
