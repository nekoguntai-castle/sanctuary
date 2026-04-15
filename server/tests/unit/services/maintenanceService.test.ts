import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockDb,
  mockAuditService,
  mockExpireOldTransfers,
  mockExecFileAsync,
  mockLog,
} = vi.hoisted(() => ({
  mockDb: {
    priceData: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    feeEstimate: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    draftTransaction: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
    pushDevice: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      count: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
  mockAuditService: {
    cleanup: vi.fn(),
    log: vi.fn(),
  },
  mockExpireOldTransfers: vi.fn(),
  mockExecFileAsync: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => ({
    maintenance: {
      auditLogRetentionDays: 90,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
      dailyCleanupIntervalMs: 1000,
      hourlyCleanupIntervalMs: 500,
      initialDelayMs: 200,
      weeklyMaintenanceIntervalMs: 7 * 24 * 60 * 60 * 1000,
      monthlyMaintenanceIntervalMs: 30 * 24 * 60 * 60 * 1000,
      diskWarningThresholdPercent: 80,
    },
  }),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockDb,
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: mockAuditService,
  AuditAction: {},
  AuditCategory: {
    SYSTEM: 'SYSTEM',
  },
}));

vi.mock('../../../src/services/transferService', () => ({
  expireOldTransfers: mockExpireOldTransfers,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('child_process', () => {
  const execFile = vi.fn();
  (execFile as any)[Symbol.for('nodejs.util.promisify.custom')] = mockExecFileAsync;
  return { execFile };
});

import { maintenanceService } from '../../../src/services/maintenanceService';

// Import standalone functions from sub-modules for direct-call tests.
// These are the real implementations using mocked dependencies (db, auditService, etc.).
import {
  cleanupAuditLogs,
  cleanupPriceData,
  cleanupFeeEstimates,
  cleanupExpiredDrafts,
  cleanupExpiredTransfers,
  cleanupExpiredRefreshTokens,
} from '../../../src/services/maintenance/dataCleanup';
import {
  runWeeklyMaintenance,
  runMonthlyMaintenance,
  cleanupOrphanedDrafts,
} from '../../../src/services/maintenance/databaseMaintenance';
import { checkDiskUsage } from '../../../src/services/maintenance/diskMonitoring';

// Dummy config to pass to functions that require MaintenanceServiceConfig
const testConfig = {
  auditLogRetentionDays: 90,
  priceDataRetentionDays: 30,
  feeEstimateRetentionDays: 7,
  dailyCleanupInterval: 1000,
  hourlyCleanupInterval: 500,
  initialDelayMs: 200,
  weeklyMaintenanceInterval: 7 * 24 * 60 * 60 * 1000,
  monthlyMaintenanceInterval: 30 * 24 * 60 * 60 * 1000,
  diskWarningThresholdPercent: 80,
};

describe('maintenanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    (maintenanceService as any).running = false;
    (maintenanceService as any).lastWeeklyRun = null;
    (maintenanceService as any).lastMonthlyRun = null;
    maintenanceService.stop();

    mockAuditService.cleanup.mockResolvedValue(0);
    mockAuditService.log.mockResolvedValue(undefined);
    mockExpireOldTransfers.mockResolvedValue(0);
    mockDb.priceData.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.feeEstimate.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.draftTransaction.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.auditLog.count.mockResolvedValue(0);
    mockDb.priceData.count.mockResolvedValue(0);
    mockDb.feeEstimate.count.mockResolvedValue(0);
    mockDb.draftTransaction.count.mockResolvedValue(0);
    mockDb.$executeRaw.mockResolvedValue(0);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    maintenanceService.stop();
    vi.useRealTimers();
  });

  it('starts and stops timers and handles repeated start', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const runAllSpy = vi.spyOn(maintenanceService, 'runAllCleanups').mockResolvedValue(undefined);
    maintenanceService.start();
    maintenanceService.start();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(200);
    expect(runAllSpy).toHaveBeenCalledTimes(1);

    maintenanceService.stop();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('stop handles running state when timers are already null', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    (maintenanceService as any).running = true;
    (maintenanceService as any).initialTimer = null;
    (maintenanceService as any).dailyTimer = null;
    (maintenanceService as any).hourlyTimer = null;
    (maintenanceService as any).weeklyTimer = null;
    (maintenanceService as any).monthlyTimer = null;

    maintenanceService.stop();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
  });

  it('logs failures from initial, daily, hourly, weekly, and monthly scheduled callbacks', async () => {
    vi.useFakeTimers();
    vi.spyOn(maintenanceService, 'runAllCleanups').mockRejectedValueOnce(new Error('initial failed'));
    vi.spyOn(maintenanceService, 'runDailyCleanups').mockRejectedValueOnce(new Error('daily failed'));
    vi.spyOn(maintenanceService, 'runHourlyCleanups').mockRejectedValueOnce(new Error('hourly failed'));
    vi.spyOn(maintenanceService, 'checkAndRunWeeklyMaintenance').mockRejectedValueOnce(new Error('weekly failed'));
    vi.spyOn(maintenanceService, 'checkAndRunMonthlyMaintenance').mockRejectedValueOnce(new Error('monthly failed'));

    maintenanceService.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockLog.error).toHaveBeenCalledWith('Initial cleanup failed', expect.any(Object));
    expect(mockLog.error).toHaveBeenCalledWith('Daily cleanup failed', expect.any(Object));
    expect(mockLog.error).toHaveBeenCalledWith('Hourly cleanup failed', expect.any(Object));
    expect(mockLog.error).toHaveBeenCalledWith('Weekly maintenance check failed', expect.any(Object));
    expect(mockLog.error).toHaveBeenCalledWith('Monthly maintenance check failed', expect.any(Object));
  });

  it('runAllCleanups executes daily then hourly cleanup flows', async () => {
    const dailySpy = vi.spyOn(maintenanceService, 'runDailyCleanups').mockResolvedValueOnce(undefined);
    const hourlySpy = vi.spyOn(maintenanceService, 'runHourlyCleanups').mockResolvedValueOnce(undefined);

    await expect(maintenanceService.runAllCleanups()).resolves.toBeUndefined();
    expect(dailySpy).toHaveBeenCalledTimes(1);
    expect(hourlySpy).toHaveBeenCalledTimes(1);
    expect(mockLog.info).toHaveBeenCalledWith('Running all maintenance cleanups');
  });

  it('runDailyCleanups logs and continues when tasks reject', async () => {
    // Make underlying mocks reject/resolve to control each cleanup task
    mockAuditService.cleanup.mockRejectedValueOnce(new Error('audit failed'));
    mockDb.priceData.deleteMany.mockResolvedValueOnce({ count: 1 });
    mockDb.feeEstimate.deleteMany.mockRejectedValueOnce(new Error('fees failed'));
    mockDb.refreshToken.deleteMany.mockResolvedValueOnce({ count: 2 });
    // checkDiskUsage swallows errors internally, so it won't reject in allSettled

    await expect(maintenanceService.runDailyCleanups()).resolves.toBeUndefined();
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('runHourlyCleanups logs and continues when tasks reject', async () => {
    mockDb.draftTransaction.deleteMany.mockRejectedValueOnce(new Error('draft failed'));
    mockExpireOldTransfers.mockResolvedValueOnce(1);

    await expect(maintenanceService.runHourlyCleanups()).resolves.toBeUndefined();
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('cleanupAuditLogs returns deleted count and logs failures', async () => {
    mockAuditService.cleanup.mockResolvedValueOnce(5);
    await expect(cleanupAuditLogs(testConfig)).resolves.toBe(5);

    mockAuditService.cleanup.mockRejectedValueOnce(new Error('cleanup boom'));
    await expect(cleanupAuditLogs(testConfig)).rejects.toThrow('cleanup boom');
  });

  it('cleanupPriceData and cleanupFeeEstimates handle success and error', async () => {
    mockDb.priceData.deleteMany.mockResolvedValueOnce({ count: 3 });
    await expect(cleanupPriceData(testConfig)).resolves.toBe(3);

    mockDb.feeEstimate.deleteMany.mockResolvedValueOnce({ count: 2 });
    await expect(cleanupFeeEstimates(testConfig)).resolves.toBe(2);

    mockDb.priceData.deleteMany.mockRejectedValueOnce(new Error('price fail'));
    await expect(cleanupPriceData(testConfig)).rejects.toThrow('price fail');

    mockDb.feeEstimate.deleteMany.mockRejectedValueOnce(new Error('fee fail'));
    await expect(cleanupFeeEstimates(testConfig)).rejects.toThrow('fee fail');
  });

  it('cleanupExpiredDrafts logs audit events when deletions occur', async () => {
    mockDb.draftTransaction.deleteMany.mockResolvedValueOnce({ count: 4 });

    await expect(cleanupExpiredDrafts()).resolves.toBe(4);
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.draft_cleanup',
      success: true,
    }));

    mockDb.draftTransaction.deleteMany.mockRejectedValueOnce(new Error('draft db fail'));
    await expect(cleanupExpiredDrafts()).rejects.toThrow('draft db fail');
  });

  it('cleanupExpiredTransfers logs audit events and propagates failures', async () => {
    mockExpireOldTransfers.mockResolvedValueOnce(6);
    await expect(cleanupExpiredTransfers()).resolves.toBe(6);
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.transfer_expiry',
    }));

    mockExpireOldTransfers.mockRejectedValueOnce(new Error('transfer fail'));
    await expect(cleanupExpiredTransfers()).rejects.toThrow('transfer fail');
  });

  it('cleanupExpiredRefreshTokens and cleanupOrphanedDrafts handle both paths', async () => {
    mockDb.refreshToken.deleteMany.mockResolvedValueOnce({ count: 7 });
    await expect(cleanupExpiredRefreshTokens()).resolves.toBe(7);

    mockDb.$executeRaw.mockResolvedValueOnce(9);
    await expect(cleanupOrphanedDrafts()).resolves.toBe(9);

    mockDb.refreshToken.deleteMany.mockRejectedValueOnce(new Error('token fail'));
    await expect(cleanupExpiredRefreshTokens()).rejects.toThrow('token fail');

    mockDb.$executeRaw.mockRejectedValueOnce(new Error('orphan fail'));
    await expect(cleanupOrphanedDrafts()).rejects.toThrow('orphan fail');
  });

  it('cleanup methods return zero without completion logs when nothing is deleted', async () => {
    mockAuditService.cleanup.mockResolvedValueOnce(0);
    mockDb.priceData.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockDb.feeEstimate.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockDb.refreshToken.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockDb.$executeRaw.mockResolvedValueOnce(0);

    await expect(cleanupAuditLogs(testConfig)).resolves.toBe(0);
    await expect(cleanupPriceData(testConfig)).resolves.toBe(0);
    await expect(cleanupFeeEstimates(testConfig)).resolves.toBe(0);
    await expect(cleanupExpiredRefreshTokens()).resolves.toBe(0);
    await expect(cleanupOrphanedDrafts()).resolves.toBe(0);
  });

  it('checkDiskUsage exits early when docker is unavailable', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    await expect(checkDiskUsage(testConfig)).resolves.toBeUndefined();
  });

  it('checkDiskUsage warns and audits when threshold is exceeded', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'Docker version 24.0.0', stderr: '' }) // docker --version
      .mockResolvedValueOnce({ stdout: '[{"Mountpoint":"/var/lib/docker/volumes/v1"}]', stderr: '' }) // inspect vol1
      .mockResolvedValueOnce({
        stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 100G 95G 5G 95% /var/lib/docker/volumes/v1\n',
        stderr: '',
      }) // df vol1
      .mockResolvedValueOnce({ stdout: '[{"Mountpoint":"/var/lib/docker/volumes/v2"}]', stderr: '' }) // inspect vol2
      .mockResolvedValueOnce({
        stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 100G 20G 80G 20% /var/lib/docker/volumes/v2\n',
        stderr: '',
      }); // df vol2

    await checkDiskUsage(testConfig);

    expect(mockExecFileAsync).toHaveBeenCalledWith('docker', ['--version'], expect.any(Object));
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'docker',
      ['volume', 'inspect', 'sanctuary_postgres_data'],
      expect.any(Object),
    );
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'df',
      ['-hP', '/var/lib/docker/volumes/v1'],
      expect.any(Object),
    );
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.disk_warning',
      success: true,
    }));
  });

  it('checkDiskUsage swallows per-volume and outer errors', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'Docker version 24.0.0', stderr: '' })
      .mockRejectedValueOnce(new Error('volume missing'))
      .mockRejectedValueOnce(new Error('volume missing'));
    await expect(checkDiskUsage(testConfig)).resolves.toBeUndefined();

    mockExecFileAsync.mockRejectedValueOnce(new Error('docker command failed'));
    await expect(checkDiskUsage(testConfig)).resolves.toBeUndefined();
  });

  it('checkDiskUsage handles empty inspect output and short df output safely', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'Docker version 24.0.0', stderr: '' }) // docker --version
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' }) // inspect vol1
      .mockResolvedValueOnce({ stdout: '[{"Mountpoint":"/var/lib/docker/volumes/v2"}]', stderr: '' }) // inspect vol2
      .mockResolvedValueOnce({ stdout: '/dev/sda1 100G 95G\n', stderr: '' }); // df vol2 (insufficient fields)

    await expect(checkDiskUsage(testConfig)).resolves.toBeUndefined();
    expect(mockAuditService.log).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.disk_warning',
    }));
  });

  it('checkDiskUsage handles unexpected outer exceptions', async () => {
    mockExecFileAsync.mockResolvedValueOnce(undefined as any);
    await expect(checkDiskUsage(testConfig)).resolves.toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith('Disk usage check failed', expect.any(Object));
  });

  it('weekly maintenance check runs only when interval elapsed', async () => {
    await maintenanceService.checkAndRunWeeklyMaintenance();
    expect(mockDb.$executeRaw).toHaveBeenCalled();

    vi.clearAllMocks();
    mockDb.$executeRaw.mockResolvedValue(0);
    mockAuditService.log.mockResolvedValue(undefined);

    (maintenanceService as any).lastWeeklyRun = new Date();
    await maintenanceService.checkAndRunWeeklyMaintenance();
    // Should not have called $executeRaw again since interval hasn't elapsed
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockDb.$executeRaw.mockResolvedValue(0);
    mockAuditService.log.mockResolvedValue(undefined);

    (maintenanceService as any).lastWeeklyRun = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await maintenanceService.checkAndRunWeeklyMaintenance();
    expect(mockDb.$executeRaw).toHaveBeenCalled();
  });

  it('runWeeklyMaintenance executes SQL sequence and records success', async () => {
    mockDb.$executeRaw
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(runWeeklyMaintenance()).resolves.toBeUndefined();
    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(6);
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.weekly_db_maintenance',
      success: true,
    }));
  });

  it('runWeeklyMaintenance logs failure and rethrows', async () => {
    mockDb.$executeRaw
      .mockResolvedValueOnce(0) // set statement timeout
      .mockRejectedValueOnce(new Error('vacuum failed')) // vacuum analyze
      .mockResolvedValueOnce(0); // reset timeout in finally

    await expect(runWeeklyMaintenance()).rejects.toThrow('vacuum failed');
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.weekly_db_maintenance',
      success: false,
    }));
  });

  it('monthly maintenance check runs only when interval elapsed', async () => {
    mockDb.$executeRaw.mockResolvedValue(0); // for cleanupOrphanedDrafts inside runMonthlyMaintenance

    await maintenanceService.checkAndRunMonthlyMaintenance();
    expect(mockDb.pushDevice.deleteMany).toHaveBeenCalled();

    vi.clearAllMocks();
    mockDb.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.$executeRaw.mockResolvedValue(0);
    mockAuditService.log.mockResolvedValue(undefined);

    (maintenanceService as any).lastMonthlyRun = new Date();
    await maintenanceService.checkAndRunMonthlyMaintenance();
    // Should not have called pushDevice.deleteMany again since interval hasn't elapsed
    expect(mockDb.pushDevice.deleteMany).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockDb.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.$executeRaw.mockResolvedValue(0);
    mockAuditService.log.mockResolvedValue(undefined);

    (maintenanceService as any).lastMonthlyRun = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await maintenanceService.checkAndRunMonthlyMaintenance();
    expect(mockDb.pushDevice.deleteMany).toHaveBeenCalled();
  });

  it('runMonthlyMaintenance handles success and failure', async () => {
    mockDb.pushDevice.deleteMany.mockResolvedValueOnce({ count: 2 });
    mockDb.$executeRaw.mockResolvedValueOnce(3); // cleanupOrphanedDrafts

    await expect(runMonthlyMaintenance()).resolves.toBeUndefined();
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.monthly_stale_cleanup',
      success: true,
    }));

    mockDb.pushDevice.deleteMany.mockRejectedValueOnce(new Error('monthly failed'));
    await expect(runMonthlyMaintenance()).rejects.toThrow('monthly failed');
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.monthly_stale_cleanup',
      success: false,
    }));
  });

  it('runMonthlyMaintenance succeeds when stale push device cleanup finds nothing', async () => {
    mockDb.pushDevice.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockDb.$executeRaw.mockResolvedValueOnce(0); // cleanupOrphanedDrafts

    await expect(runMonthlyMaintenance()).resolves.toBeUndefined();
    expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.monthly_stale_cleanup',
      success: true,
    }));
  });

  it('getStats returns aggregate counts', async () => {
    mockDb.auditLog.count.mockResolvedValueOnce(11);
    mockDb.priceData.count.mockResolvedValueOnce(22);
    mockDb.feeEstimate.count.mockResolvedValueOnce(33);
    mockDb.draftTransaction.count
      .mockResolvedValueOnce(44)
      .mockResolvedValueOnce(5);

    const stats = await maintenanceService.getStats();
    expect(stats).toEqual({
      auditLogCount: 11,
      priceDataCount: 22,
      feeEstimateCount: 33,
      draftCount: 44,
      expiredDraftCount: 5,
    });
  });

  it('triggerCleanup dispatches all supported tasks and errors on unknown task', async () => {
    vi.spyOn(maintenanceService, 'runAllCleanups').mockResolvedValue(undefined);

    // Set up mocks for each cleanup task called via triggerCleanup
    mockAuditService.cleanup.mockResolvedValueOnce(1); // audit
    mockDb.priceData.deleteMany.mockResolvedValueOnce({ count: 2 }); // price
    mockDb.feeEstimate.deleteMany.mockResolvedValueOnce({ count: 3 }); // fees
    mockDb.draftTransaction.deleteMany.mockResolvedValueOnce({ count: 4 }); // drafts
    mockExpireOldTransfers.mockResolvedValueOnce(5); // transfers
    // weekly: 6 $executeRaw calls
    mockDb.$executeRaw
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    // monthly: pushDevice.deleteMany + $executeRaw for orphaned drafts
    mockDb.pushDevice.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockDb.$executeRaw
      .mockResolvedValueOnce(0); // cleanupOrphanedDrafts inside runMonthlyMaintenance

    await expect(maintenanceService.triggerCleanup('all')).resolves.toBe(0);
    await expect(maintenanceService.triggerCleanup('audit')).resolves.toBe(1);
    await expect(maintenanceService.triggerCleanup('price')).resolves.toBe(2);
    await expect(maintenanceService.triggerCleanup('fees')).resolves.toBe(3);
    await expect(maintenanceService.triggerCleanup('drafts')).resolves.toBe(4);
    await expect(maintenanceService.triggerCleanup('transfers')).resolves.toBe(5);
    await expect(maintenanceService.triggerCleanup('weekly')).resolves.toBe(0);
    await expect(maintenanceService.triggerCleanup('monthly')).resolves.toBe(0);
    await expect(maintenanceService.triggerCleanup('nope' as any)).rejects.toThrow('Unknown cleanup task');
  });
});
