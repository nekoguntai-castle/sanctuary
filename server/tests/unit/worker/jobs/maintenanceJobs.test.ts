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

type ForwardedMaintenanceJob = {
  handler: unknown;
  options: unknown;
};

const FORWARDED_MAINTENANCE_JOBS: Array<{
  name: string;
  definition: ForwardedMaintenanceJob;
}> = [
  { name: 'cleanupAuditLogs', definition: mockJobs.cleanupAuditLogsJob },
  { name: 'cleanupPriceData', definition: mockJobs.cleanupPriceDataJob },
  { name: 'cleanupFeeEstimates', definition: mockJobs.cleanupFeeEstimatesJob },
  { name: 'cleanupExpiredDrafts', definition: mockJobs.cleanupExpiredDraftsJob },
  { name: 'cleanupExpiredTransfers', definition: mockJobs.cleanupExpiredTransfersJob },
  { name: 'cleanupExpiredTokens', definition: mockJobs.cleanupExpiredTokensJob },
  { name: 'weeklyVacuum', definition: mockJobs.weeklyVacuumJob },
  { name: 'monthlyCleanup', definition: mockJobs.monthlyCleanupJob },
];

function maintenanceJobsByName() {
  return new Map(maintenanceJobs.map(job => [job.name, job]));
}

function expectForwardedMaintenanceJob(
  byName: ReturnType<typeof maintenanceJobsByName>,
  name: string,
  definition: ForwardedMaintenanceJob
) {
  const job = byName.get(name);
  expect(job?.handler).toBe(definition.handler);
  expect(job?.options).toBe(definition.options);
}

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
    const byName = maintenanceJobsByName();

    for (const { name, definition } of FORWARDED_MAINTENANCE_JOBS) {
      expectForwardedMaintenanceJob(byName, name, definition);
    }
  });
});
