import { describe, expect, it, vi } from 'vitest';
import type { CombinedConfig } from '../../../src/config';
import {
  AUTOPILOT_RECURRING_SCHEDULES,
  INTELLIGENCE_RECURRING_SCHEDULES,
  RecurringScheduleCoordinator,
  buildBaselineRecurringSchedules,
  inspectRecurringScheduleHealth,
  reconcileRecurringSchedules,
} from '../../../src/worker/recurringSchedules';

const config = {
  sync: {
    intervalMs: 5 * 60_000,
    confirmationUpdateIntervalMs: 2 * 60_000,
  },
  maintenance: {
    auditLogRetentionDays: 30,
    priceDataRetentionDays: 14,
    feeEstimateRetentionDays: 7,
  },
} as CombinedConfig;

describe('recurring schedule contracts', () => {
  it('defines the complete baseline and explicit conditional sets', () => {
    const baseline = buildBaselineRecurringSchedules(config);

    expect(baseline.map(({ schedulerId }) => schedulerId)).toEqual([
      'sync:check-stale-wallets',
      'confirmations:update-all-confirmations',
      'maintenance:cleanup:expired-drafts',
      'maintenance:cleanup:expired-transfers',
      'maintenance:cleanup:audit-logs',
      'maintenance:cleanup:price-data',
      'maintenance:cleanup:fee-estimates',
      'maintenance:persist:price-fees',
      'maintenance:cleanup:expired-tokens',
      'maintenance:maintenance:weekly-vacuum',
      'maintenance:maintenance:monthly-cleanup',
      'maintenance:backup:scheduled',
      'maintenance:webhook:recover-due-deliveries',
    ]);
    expect(
      baseline.find(({ schedulerId }) => schedulerId === 'sync:check-stale-wallets'),
    ).toEqual(expect.objectContaining({ cron: '*/5 * * * *', freshness: expect.any(Object) }));
    expect(
      baseline.find(({ schedulerId }) => schedulerId === 'maintenance:cleanup:price-data'),
    ).toEqual(expect.objectContaining({ data: { retentionDays: 14 } }));
    expect(AUTOPILOT_RECURRING_SCHEDULES.map(({ name }) => name)).toEqual([
      'autopilot:record-fees',
      'autopilot:evaluate',
    ]);
    expect(INTELLIGENCE_RECURRING_SCHEDULES.map(({ name }) => name)).toEqual([
      'intelligence:analyze',
      'intelligence:cleanup',
    ]);
  });

  it('reports explicit reconciliation failure', async () => {
    const definitions = [
      {
        ...buildBaselineRecurringSchedules(config)[0]!,
        options: { removeOnComplete: 25 },
      },
      buildBaselineRecurringSchedules(config)[1]!,
    ];
    const queue = {
      scheduleRecurring: vi
        .fn()
        .mockResolvedValueOnce({ status: 'unchanged' })
        .mockResolvedValueOnce({ status: 'failed', error: 'Redis unavailable' }),
    } as any;

    const result = await reconcileRecurringSchedules(queue, definitions);

    expect(result.healthy).toBe(false);
    expect(result.results['confirmations:update-all-confirmations']).toEqual({
      status: 'failed',
      error: 'Redis unavailable',
    });
    expect(queue.scheduleRecurring).toHaveBeenNthCalledWith(
      1,
      definitions[0]!.queue,
      definitions[0]!.name,
      definitions[0]!.data,
      definitions[0]!.cron,
      { removeOnComplete: 25 },
    );
  });

  it('requires freshness jobs to complete after grace but not long-period jobs', async () => {
    const definitions = buildBaselineRecurringSchedules(config);
    const queue = {
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
    } as any;
    const startedAt = 1_000_000;

    const health = await inspectRecurringScheduleHealth(
      queue,
      definitions,
      {
        'sync:check-stale-wallets': startedAt + 200_000,
      },
      startedAt,
      startedAt + 400_000,
    );

    expect(health.healthy).toBe(false);
    expect(health.stale).toEqual(['maintenance:webhook:recover-due-deliveries']);
    expect(health.stale).not.toContain('maintenance:backup:scheduled');
  });

  it('keeps reconciliation unhealthy when a forbidden schedule cannot be removed', async () => {
    const queue = {
      scheduleRecurring: vi.fn().mockResolvedValue({ status: 'unchanged' }),
      removeRecurring: vi
        .fn()
        .mockResolvedValueOnce({ status: 'failed', error: 'Redis unavailable' })
        .mockResolvedValue({ status: 'absent' }),
    } as any;
    const coordinator = new RecurringScheduleCoordinator(
      queue,
      config,
      async () => ({
        autopilotEnabled: false,
        intelligenceEnabled: false,
      }),
    );

    const result = await coordinator.reconcile();

    expect(result.healthy).toBe(false);
    expect(coordinator.getState()).toEqual(
      expect.objectContaining({ reconciliationHealthy: false }),
    );
    queue.inspectRecurringSchedules = vi.fn().mockResolvedValue({
      healthy: true,
      missing: [],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    });
    const state = coordinator.getState();
    await expect(
      inspectRecurringScheduleHealth(
        queue,
        state.desired,
        {},
        Date.now(),
        Date.now(),
        state.forbidden,
        state.reconciliationHealthy,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        reconciliationFailed: true,
      }),
    );
  });

  it('serializes overlapping reconciliations and rereads current feature state', async () => {
    let autopilotEnabled = true;
    let releaseAutopilot!: () => void;
    let autopilotStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      autopilotStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseAutopilot = resolve;
    });
    const operations: string[] = [];
    const queue = {
      scheduleRecurring: vi.fn(async (_queue: string, name: string) => {
        operations.push(`schedule:${name}`);
        if (name === 'autopilot:record-fees') {
          autopilotStarted();
          await blocked;
        }
        return { status: 'unchanged' };
      }),
      removeRecurring: vi.fn(async (_queue: string, name: string) => {
        operations.push(`remove:${name}`);
        return { status: 'removed' };
      }),
    } as any;
    const coordinator = new RecurringScheduleCoordinator(
      queue,
      config,
      async () => ({
        autopilotEnabled,
        intelligenceEnabled: false,
      }),
    );

    const enabling = coordinator.reconcile();
    await started;
    autopilotEnabled = false;
    const disabling = coordinator.reconcile();
    releaseAutopilot();
    await Promise.all([enabling, disabling]);

    const lastSchedule = operations.lastIndexOf(
      'schedule:autopilot:record-fees',
    );
    const lastRemoval = operations.lastIndexOf(
      'remove:autopilot:record-fees',
    );
    expect(lastRemoval).toBeGreaterThan(lastSchedule);
    expect(coordinator.getState().forbidden.map(({ name }) => name)).toContain(
      'autopilot:record-fees',
    );
  });

  it('keeps the coordinator usable after a conditional-state read fails', async () => {
    const queue = {
      scheduleRecurring: vi.fn().mockResolvedValue({ status: 'unchanged' }),
      removeRecurring: vi.fn().mockResolvedValue({ status: 'absent' }),
    } as any;
    const readConditionalState = vi
      .fn()
      .mockRejectedValueOnce(new Error('feature state unavailable'))
      .mockResolvedValue({
        autopilotEnabled: false,
        intelligenceEnabled: false,
      });
    const coordinator = new RecurringScheduleCoordinator(
      queue,
      config,
      readConditionalState,
    );

    await expect(coordinator.reconcile()).rejects.toThrow(
      'feature state unavailable',
    );
    expect(coordinator.getState().reconciliationHealthy).toBe(false);
    await expect(coordinator.reconcile()).resolves.toEqual(
      expect.objectContaining({ healthy: true }),
    );
  });
});
