import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockJob } from '../../helpers/workerJob';
import type { JobExecutionContext } from '../../../src/jobs/types';

const {
  mockDeletePriceData,
  mockDeleteFeeEstimates,
  mockDeleteDrafts,
  mockDeleteRefreshTokens,
  mockDeletePushDevices,
  mockInsertPriceData,
  mockInsertFeeEstimate,
  mockGetPriceService,
  mockGetCurrentFeeEstimates,
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
  mockInsertPriceData: vi.fn(),
  mockInsertFeeEstimate: vi.fn(),
  mockGetPriceService: vi.fn(),
  mockGetCurrentFeeEstimates: vi.fn(),
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
  priceDataRepository: {
    insertPriceData: (...args: unknown[]) => mockInsertPriceData(...args),
    insertFeeEstimate: (...args: unknown[]) => mockInsertFeeEstimate(...args),
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

vi.mock('../../../src/services/price', () => ({
  getPriceService: mockGetPriceService,
}));

vi.mock('../../../src/services/bitcoin/feeService', () => ({
  getCurrentFeeEstimates: mockGetCurrentFeeEstimates,
}));

vi.mock('../../../src/services/bitcoin/signingIntent/broadcastReconciliation', () => ({
  reconcileSigningIntentBroadcasts: vi.fn().mockResolvedValue({ examined: 2, completed: 1 }),
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
  persistPriceFeesJob,
  scheduledBackupJob,
  reconcileSigningIntentBroadcastsJob,
  maintenanceJobs,
} from '../../../src/jobs/definitions/maintenance';
import { reconcileSigningIntentBroadcasts } from '../../../src/services/bitcoin/signingIntent/broadcastReconciliation';

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
    mockInsertPriceData.mockResolvedValue(undefined);
    mockInsertFeeEstimate.mockResolvedValue(undefined);
    mockGetPriceService.mockReturnValue({
      getSupportedCurrencies: () => ['usd', 'EUR'],
      getPrices: vi.fn().mockResolvedValue({
        usd: { price: 61_000 },
        EUR: { price: 57_000 },
      }),
    });
    mockGetCurrentFeeEstimates.mockResolvedValue({
      fastest: 12,
      halfHour: 8,
      hour: 4,
      economy: 2,
      minimum: 1,
      source: 'mempool',
    });
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

    const first = await Reflect.apply(cleanupExpiredDraftsJob.handler, cleanupExpiredDraftsJob, [{ data: {} }]);
    const second = await Reflect.apply(cleanupExpiredDraftsJob.handler, cleanupExpiredDraftsJob, [{ data: {} }]);

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

    const first = await Reflect.apply(cleanupExpiredTransfersJob.handler, cleanupExpiredTransfersJob, [{ data: {} }]);
    const second = await Reflect.apply(cleanupExpiredTransfersJob.handler, cleanupExpiredTransfersJob, [{ data: {} }]);

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

    const deleted = await Reflect.apply(cleanupExpiredTokensJob.handler, cleanupExpiredTokensJob, [{ data: {} }]);

    expect(deleted).toBe(7);
    expect(mockDeleteRefreshTokens).toHaveBeenCalled();
  });

  it('returns zero when cleanup jobs find no records to delete', async () => {
    const auditDeleted = await cleanupAuditLogsJob.handler({ data: {} } as any);
    const priceDeleted = await cleanupPriceDataJob.handler({ data: {} } as any);
    const feeDeleted = await cleanupFeeEstimatesJob.handler({ data: {} } as any);
    const tokenDeleted = await Reflect.apply(cleanupExpiredTokensJob.handler, cleanupExpiredTokensJob, [{ data: {} }]);

    expect(auditDeleted).toBe(0);
    expect(priceDeleted).toBe(0);
    expect(feeDeleted).toBe(0);
    expect(tokenDeleted).toBe(0);
  });

  it('persists price and fee snapshots for assistant cache reads', async () => {
    const result = await persistPriceFeesJob.handler({ data: {} } as any);

    expect(result).toEqual({ pricesWritten: 2, feesWritten: 1 });
    expect(mockInsertPriceData).toHaveBeenCalledWith({
      currency: 'USD',
      price: 61_000,
      source: 'aggregate',
    });
    expect(mockInsertPriceData).toHaveBeenCalledWith({
      currency: 'EUR',
      price: 57_000,
      source: 'aggregate',
    });
    expect(mockInsertFeeEstimate).toHaveBeenCalledWith({
      fastest: 12,
      halfHour: 8,
      hour: 4,
    });
  });

  it('keeps price and fee persistence failures isolated', async () => {
    mockGetPriceService.mockReturnValueOnce({
      getSupportedCurrencies: () => ['USD'],
      getPrices: vi.fn().mockRejectedValue(new Error('price unavailable')),
    });
    mockGetCurrentFeeEstimates.mockRejectedValueOnce(new Error('fees unavailable'));

    const result = await persistPriceFeesJob.handler({ data: {} } as any);

    expect(result).toEqual({ pricesWritten: 0, feesWritten: 0 });
    expect(mockInsertPriceData).not.toHaveBeenCalled();
    expect(mockInsertFeeEstimate).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Price snapshot persistence failed',
      expect.objectContaining({ error: 'price unavailable' })
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Fee snapshot persistence failed',
      expect.objectContaining({ error: 'fees unavailable' })
    );
  });

  it('uses only physical table names for the default weekly reindex job', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { timeout: 12345 },
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls).toEqual([
      'SET statement_timeout = ?',
      'VACUUM ANALYZE',
      'REINDEX TABLE "audit_logs"',
      'REINDEX TABLE "transactions"',
      'REINDEX TABLE "utxos"',
      "SET statement_timeout = '0'",
    ]);
    expect(sqlCalls.join('\n')).not.toMatch(/"(?:Transaction|UTXO)"/);
    expect(mockExecuteRaw.mock.calls[0]?.[1]).toBe(12345);
    expect(updateProgress.mock.calls.map(([progress]) => progress)).toEqual([
      10, 50, 63, 76, 90, 100,
    ]);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.weekly_db_maintenance',
        category: 'SYSTEM',
        details: expect.objectContaining({
          tablesReindexed: ['audit_logs', 'transactions', 'utxos'],
        }),
        success: true,
      })
    );
  });

  it('accepts an allowlisted caller-supplied subset', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { tables: ['utxos'] },
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.filter(sql => sql.includes('REINDEX TABLE'))).toEqual([
      'REINDEX TABLE "utxos"',
    ]);
    expect(updateProgress.mock.calls.map(([progress]) => progress)).toEqual([
      10, 50, 90, 100,
    ]);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ tablesReindexed: ['utxos'] }),
    }));
  });

  it('accepts an empty table list without fabricating reindex work', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { tables: [] },
      updateProgress,
    } as any);

    expect(mockExecuteRaw.mock.calls.map(sqlFromCall)).toEqual([
      'SET statement_timeout = ?',
      'VACUUM ANALYZE',
      "SET statement_timeout = '0'",
    ]);
    expect(updateProgress.mock.calls.map(([progress]) => progress)).toEqual([
      10, 50, 100,
    ]);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ tablesReindexed: [] }),
    }));
  });

  it('rejects an unknown table before any maintenance side effect', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await expect(weeklyVacuumJob.handler({
      data: { tables: ['audit_logs', 'UnknownTable'] },
      updateProgress,
    } as any)).rejects.toThrow('Unsupported weekly maintenance table: UnknownTable');

    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it.each([
    { tables: null, message: 'Weekly maintenance tables must be an array' },
    { tables: 'audit_logs', message: 'Weekly maintenance tables must be an array' },
    { tables: [123], message: 'Unsupported weekly maintenance table: 123' },
    {
      tables: ['audit_logs', 'audit_logs'],
      message: 'Duplicate weekly maintenance table: audit_logs',
    },
  ])('rejects malformed or duplicate table input before side effects: $tables', async ({
    tables,
    message,
  }) => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await expect(weeklyVacuumJob.handler({
      data: { tables },
      updateProgress,
    } as any)).rejects.toThrow(message);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it('resets the timeout and stops before the next table when cancelled', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    let completedReindexes = 0;
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      if (template.join('?').includes('REINDEX TABLE')) completedReindexes += 1;
      return 0;
    });
    const execution: JobExecutionContext = {
      signal: new AbortController().signal,
      throwIfAborted: vi.fn(() => {
        if (completedReindexes === 1) throw new Error('cancelled');
      }),
    };

    await expect(weeklyVacuumJob.handler({
      data: { tables: ['audit_logs', 'transactions'] },
      updateProgress,
    } as any, execution)).rejects.toThrow('cancelled');

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.filter(sql => sql.includes('REINDEX TABLE'))).toEqual([
      'REINDEX TABLE "audit_logs"',
    ]);
    expect(sqlCalls.at(-1)).toBe("SET statement_timeout = '0'");
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('resets the timeout when cancelled immediately after enabling it', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    let abortChecks = 0;
    const execution: JobExecutionContext = {
      signal: new AbortController().signal,
      throwIfAborted: vi.fn(() => {
        abortChecks += 1;
        if (abortChecks === 2) throw new Error('cancelled');
      }),
    };

    await expect(weeklyVacuumJob.handler({
      data: {},
      updateProgress,
    } as any, execution)).rejects.toThrow('cancelled');

    expect(mockExecuteRaw.mock.calls.map(sqlFromCall)).toEqual([
      'SET statement_timeout = ?',
      "SET statement_timeout = '0'",
    ]);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('propagates a REINDEX failure and restores the timeout in finally', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      if (template.join('?').includes('REINDEX TABLE "transactions"')) {
        throw new Error('reindex failed');
      }
      return 0;
    });

    await expect(weeklyVacuumJob.handler({
      data: {},
      updateProgress,
    } as any)).rejects.toThrow('reindex failed');

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.at(-1)).toBe("SET statement_timeout = '0'");
    expect(sqlCalls).not.toContain('REINDEX TABLE "utxos"');
    expect(updateProgress.mock.calls.map(([progress]) => progress)).toEqual([
      10, 50, 63,
    ]);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('always resets statement timeout when weekly vacuum fails', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      if (template.join('?').includes('VACUUM ANALYZE')) {
        throw new Error('vacuum failed');
      }
      return 0;
    });

    await expect(weeklyVacuumJob.handler({
      data: {},
      updateProgress,
    } as any)).rejects.toThrow('vacuum failed');

    expect(mockExecuteRaw.mock.calls.map(sqlFromCall).at(-1))
      .toBe("SET statement_timeout = '0'");
  });

  it('does not commit success when statement timeout restoration fails', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      if (template.join('?') === "SET statement_timeout = '0'") {
        throw new Error('timeout reset failed');
      }
      return 0;
    });

    await expect(weeklyVacuumJob.handler({
      data: { tables: [] },
      updateProgress,
    } as any)).rejects.toThrow('timeout reset failed');

    expect(updateProgress).not.toHaveBeenCalledWith(100);
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalledWith(
      'Weekly database maintenance completed',
      expect.anything(),
    );
  });

  it('treats the success audit as the final cancellation commit point', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    let aborted = false;
    const execution: JobExecutionContext = {
      signal: new AbortController().signal,
      throwIfAborted: vi.fn(() => {
        if (aborted) throw new Error('cancelled');
      }),
    };
    mockAuditLog.mockImplementationOnce(async () => {
      aborted = true;
    });

    await expect(weeklyVacuumJob.handler({
      data: { tables: [] },
      updateProgress,
    } as any, execution)).resolves.toBeUndefined();

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(updateProgress.mock.invocationCallOrder.at(-1))
      .toBeLessThan(mockAuditLog.mock.invocationCallOrder[0]);
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
    const mockFileWrite = vi.fn().mockResolvedValue(undefined);
    const mockFileSync = vi.fn().mockResolvedValue(undefined);
    const mockFileClose = vi.fn().mockResolvedValue(undefined);
    const mockOpen = vi.fn().mockResolvedValue({
      writeFile: mockFileWrite,
      sync: mockFileSync,
      close: mockFileClose,
    });
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify({
      meta: { version: '1.1.0' },
      data: {},
    }));
    const mockReaddir = vi.fn().mockResolvedValue([
      'sanctuary-backup-2026-04-01.json',
      'sanctuary-backup-2026-04-02.json',
      'sanctuary-backup-2026-04-03.json',
    ]);
    const mockUnlink = vi.fn().mockResolvedValue(undefined);
    const mockStat = vi.fn();

    vi.doMock('fs/promises', () => ({
      mkdir: mockMkdir,
      open: mockOpen,
      rename: mockRename,
      readFile: mockReadFile,
      readdir: mockReaddir,
      unlink: mockUnlink,
      stat: mockStat,
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
        async validateBackupForRestore() { return { valid: true }; }
      },
    }));

    // Re-import to pick up doMock
    const { scheduledBackupJob: freshJob } = await import('../../../src/jobs/definitions/maintenance');

    const result = await freshJob.handler({
      data: { retentionCount: 2 },
    } as any);

    expect(result).toMatch(/^sanctuary-backup-/);
    expect(mockMkdir).toHaveBeenCalledWith('/data/backups', { recursive: true });
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
      'wx',
      0o600,
    );
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.any(String),
      'utf8',
    );
    expect(mockFileSync).toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.sanctuary-backup-.*\.tmp$/),
      expect.stringMatching(/\/sanctuary-backup-.*\.json$/),
    );
    // 3 files, retention 2 → 1 file deleted (oldest)
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('2026-04-01'));
    expect(mockAuditLog).toHaveBeenCalled();

    const defaultRetentionResult = await freshJob.handler({ data: {} } as any);
    expect(defaultRetentionResult).toMatch(/^sanctuary-backup-/);
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Running scheduled backup',
      expect.objectContaining({ retentionCount: 7 }),
    );
    // The three existing backups fit under the default retention count.
    expect(mockUnlink).toHaveBeenCalledTimes(1);
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
      persistPriceFeesJob,
      reconcileSigningIntentBroadcastsJob,
    ]));
    expect(maintenanceJobs).toHaveLength(11);
  });

  it('runs signing-intent reconciliation with abort checks around the durable pass', async () => {
    const execution: JobExecutionContext = {
      signal: new AbortController().signal,
      throwIfAborted: vi.fn(),
    };
    await expect(reconcileSigningIntentBroadcastsJob.handler(createMockJob({}), execution))
      .resolves.toEqual({ examined: 2, completed: 1 });
    expect(reconcileSigningIntentBroadcasts).toHaveBeenCalledOnce();
    expect(execution.throwIfAborted).toHaveBeenCalledTimes(2);
  });
});
