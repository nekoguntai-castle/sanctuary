import { describe, expect, it, vi } from 'vitest';

const mockJobs = vi.hoisted(() => ({
  cleanupAuditLogsJob: { name: 'cleanupAuditLogs', handler: vi.fn(), options: { attempts: 1 } },
  cleanupPriceDataJob: { name: 'cleanupPriceData', handler: vi.fn(), options: { attempts: 2 } },
  cleanupFeeEstimatesJob: { name: 'cleanupFeeEstimates', handler: vi.fn(), options: { attempts: 3 } },
  cleanupExpiredDraftsJob: { name: 'cleanupExpiredDrafts', handler: vi.fn(), options: { attempts: 4 } },
  cleanupExpiredTransfersJob: { name: 'cleanupExpiredTransfers', handler: vi.fn(), options: { attempts: 5 } },
  cleanupExpiredTokensJob: { name: 'cleanupExpiredTokens', handler: vi.fn(), options: { attempts: 6 } },
  weeklyVacuumJob: { name: 'weeklyVacuum', handler: vi.fn(), options: { attempts: 7 } },
  monthlyCleanupJob: { name: 'monthlyCleanup', handler: vi.fn(), options: { attempts: 8 } },
  scheduledBackupJob: { name: 'backup:scheduled', handler: vi.fn(), options: { attempts: 2 } },
}));

vi.mock('../../../../src/jobs/definitions/maintenance', () => mockJobs);

import { maintenanceJobs } from '../../../../src/worker/jobs/maintenanceJobs';

describe('worker maintenanceJobs', () => {
  it('exports all maintenance job handlers with queue and lock configuration', () => {
    expect(maintenanceJobs).toHaveLength(9);
    expect(maintenanceJobs.map(j => j.name)).toEqual([
      'cleanupAuditLogs',
      'cleanupPriceData',
      'cleanupFeeEstimates',
      'cleanupExpiredDrafts',
      'cleanupExpiredTransfers',
      'cleanupExpiredTokens',
      'weeklyVacuum',
      'monthlyCleanup',
      'backup:scheduled',
    ]);
    expect(maintenanceJobs.every(j => j.queue === 'maintenance')).toBe(true);
  });

  it('builds deterministic lock keys and expected lock ttls', () => {
    const byName = new Map(maintenanceJobs.map(job => [job.name, job]));

    for (const name of [
      'cleanupAuditLogs',
      'cleanupPriceData',
      'cleanupFeeEstimates',
      'cleanupExpiredDrafts',
      'cleanupExpiredTransfers',
      'cleanupExpiredTokens',
    ]) {
      const job = byName.get(name)!;
      expect(job.lockOptions?.lockKey()).toBe(`maintenance:${name}`);
      expect(job.lockOptions?.lockTtlMs).toBe(90_000);
    }

    const weekly = byName.get('weeklyVacuum')!;
    expect(weekly.lockOptions?.lockKey()).toBe('maintenance:weeklyVacuum');
    expect(weekly.lockOptions?.lockTtlMs).toBe(6 * 60_000);

    const monthly = byName.get('monthlyCleanup')!;
    expect(monthly.lockOptions?.lockKey()).toBe('maintenance:monthlyCleanup');
    expect(monthly.lockOptions?.lockTtlMs).toBe(2 * 60_000);

    const backup = byName.get('backup:scheduled')!;
    expect(backup.lockOptions?.lockKey()).toBe('maintenance:backup:scheduled');
    expect(backup.lockOptions?.lockTtlMs).toBe(30 * 60_000);
  });

  it('forwards handler and options from shared maintenance definitions', () => {
    const byName = new Map(maintenanceJobs.map(job => [job.name, job]));

    expect(byName.get('cleanupAuditLogs')?.handler).toBe(mockJobs.cleanupAuditLogsJob.handler);
    expect(byName.get('cleanupAuditLogs')?.options).toBe(mockJobs.cleanupAuditLogsJob.options);
    expect(byName.get('cleanupPriceData')?.handler).toBe(mockJobs.cleanupPriceDataJob.handler);
    expect(byName.get('cleanupPriceData')?.options).toBe(mockJobs.cleanupPriceDataJob.options);
    expect(byName.get('cleanupFeeEstimates')?.handler).toBe(mockJobs.cleanupFeeEstimatesJob.handler);
    expect(byName.get('cleanupFeeEstimates')?.options).toBe(mockJobs.cleanupFeeEstimatesJob.options);
    expect(byName.get('cleanupExpiredDrafts')?.handler).toBe(mockJobs.cleanupExpiredDraftsJob.handler);
    expect(byName.get('cleanupExpiredDrafts')?.options).toBe(mockJobs.cleanupExpiredDraftsJob.options);
    expect(byName.get('cleanupExpiredTransfers')?.handler).toBe(mockJobs.cleanupExpiredTransfersJob.handler);
    expect(byName.get('cleanupExpiredTransfers')?.options).toBe(mockJobs.cleanupExpiredTransfersJob.options);
    expect(byName.get('cleanupExpiredTokens')?.handler).toBe(mockJobs.cleanupExpiredTokensJob.handler);
    expect(byName.get('cleanupExpiredTokens')?.options).toBe(mockJobs.cleanupExpiredTokensJob.options);
    expect(byName.get('weeklyVacuum')?.handler).toBe(mockJobs.weeklyVacuumJob.handler);
    expect(byName.get('weeklyVacuum')?.options).toBe(mockJobs.weeklyVacuumJob.options);
    expect(byName.get('monthlyCleanup')?.handler).toBe(mockJobs.monthlyCleanupJob.handler);
    expect(byName.get('monthlyCleanup')?.options).toBe(mockJobs.monthlyCleanupJob.options);
  });
});
