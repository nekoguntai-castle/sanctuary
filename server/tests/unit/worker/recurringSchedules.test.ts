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

function freshHeartbeatRecords(
  definitions: ReturnType<typeof buildBaselineRecurringSchedules>,
  now: number,
) {
  return Object.fromEntries(
    definitions
      .filter(({ freshness }) => freshness)
      .map(({ schedulerId }) => [
        schedulerId,
        {
          version: 1,
          schedulerId,
          recurrenceFingerprint: 'test',
          activatedAt: now,
          lastCompletedAt: now,
        },
      ]),
  );
}

describe('recurring schedule contracts', () => {
  const buildNeverCompletedQueue = (activatedAt: number) =>
    ({
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
      getRecurringHeartbeatSnapshot: vi.fn().mockResolvedValue({
        healthy: true,
        records: {
          'sync:check-stale-wallets': {
            version: 1,
            schedulerId: 'sync:check-stale-wallets',
            recurrenceFingerprint: 'every:300000',
            activatedAt,
          },
          'maintenance:webhook:recover-due-deliveries': {
            version: 1,
            schedulerId: 'maintenance:webhook:recover-due-deliveries',
            recurrenceFingerprint: 'pattern:* * * * *:tz:UTC',
            activatedAt,
          },
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for WorkerJobQueue
    }) as any;

  const buildCompletedBeforeBootQueue = (
    activatedAt: number,
    lastCompletedAt: number,
  ) =>
    ({
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
      getRecurringHeartbeatSnapshot: vi.fn().mockResolvedValue({
        healthy: true,
        records: {
          'sync:check-stale-wallets': {
            version: 1,
            schedulerId: 'sync:check-stale-wallets',
            recurrenceFingerprint: 'every:300000',
            activatedAt,
            lastCompletedAt,
          },
          'maintenance:webhook:recover-due-deliveries': {
            version: 1,
            schedulerId: 'maintenance:webhook:recover-due-deliveries',
            recurrenceFingerprint: 'pattern:* * * * *:tz:UTC',
            activatedAt,
            lastCompletedAt,
          },
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for WorkerJobQueue
    }) as any;

  it('grants startup grace when the last completion predates this worker boot', async () => {
    // Upgrade regression: an upgrade whose downtime exceeds maxAgeMs (2x the
    // sync interval) leaves a durable lastCompletedAt from *before* the
    // restart. The startup grace only forgave never-completed schedules, so
    // the schedule was stale the instant the new worker booted, /health 503'd,
    // and the backend's critical worker-heartbeat service aborted startup long
    // before the job could run again. A slow rebuild bricked the whole stack.
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const lastCompletedAt = activatedAt + 60_000;
    const bootedAt = lastCompletedAt + 14 * 60_000; // 14m upgrade downtime
    const queue = buildCompletedBeforeBootQueue(activatedAt, lastCompletedAt);

    await expect(
      inspectRecurringScheduleHealth(
        queue,
        definitions,
        bootedAt + 30_000,
        [],
        true,
        bootedAt,
      ),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, stale: [] }));
  });

  it('reports staleness once a pre-boot completion outlives the grace window', async () => {
    // Anti-masking: forgiving a pre-boot completion must expire with the grace
    // window, so a schedule that never runs on the new worker is still caught.
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const lastCompletedAt = activatedAt + 60_000;
    const bootedAt = lastCompletedAt + 14 * 60_000;
    const queue = buildCompletedBeforeBootQueue(activatedAt, lastCompletedAt);

    await expect(
      inspectRecurringScheduleHealth(
        queue,
        definitions,
        bootedAt + 400_000,
        [],
        true,
        bootedAt,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        stale: [
          'sync:check-stale-wallets',
          'maintenance:webhook:recover-due-deliveries',
        ],
      }),
    );
  });

  it('still reports staleness for a completion that went stale while up', async () => {
    // Anti-masking: a worker that has been up far longer than its grace window
    // gets no forgiveness, even though its completion predates nothing.
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const bootedAt = activatedAt;
    const lastCompletedAt = bootedAt + 60_000; // completed after boot
    const queue = buildCompletedBeforeBootQueue(activatedAt, lastCompletedAt);

    await expect(
      inspectRecurringScheduleHealth(
        queue,
        definitions,
        lastCompletedAt + 700_000,
        [],
        true,
        bootedAt,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        stale: [
          'sync:check-stale-wallets',
          'maintenance:webhook:recover-due-deliveries',
        ],
      }),
    );
  });

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
      'maintenance:reconcile:signing-intent-broadcasts',
      'maintenance:webhook:recover-due-deliveries',
    ]);
    expect(
      baseline.find(({ schedulerId }) => schedulerId === 'sync:check-stale-wallets'),
    ).toEqual(expect.objectContaining({
      data: { version: 1 },
      recurrence: { every: 300_000 },
      freshness: expect.any(Object),
    }));
    expect(
      baseline.find(({ schedulerId }) => schedulerId === 'confirmations:update-all-confirmations'),
    ).toEqual(expect.objectContaining({
      data: { version: 1 },
      recurrence: { every: 120_000 },
    }));
    expect(
      baseline.find(({ schedulerId }) => schedulerId === 'maintenance:backup:scheduled'),
    ).toEqual(expect.objectContaining({
      recurrence: { pattern: '0 1 * * *', tz: 'UTC' },
    }));
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

  it.each([
    [1_000, 90_000],
    [90_000, 90 * 60_000],
    [60 * 60_000, 5 * 60_000],
  ])('preserves exact configurable intervals %d and %d', (sync, confirmations) => {
    const definitions = buildBaselineRecurringSchedules({
      ...config,
      sync: {
        ...config.sync,
        intervalMs: sync,
        confirmationUpdateIntervalMs: confirmations,
      },
    });

    expect(definitions[0]!.recurrence).toEqual({ every: sync });
    expect(definitions[1]!.recurrence).toEqual({ every: confirmations });
  });

  it('rejects invalid or overflowing freshness intervals', () => {
    expect(() => buildBaselineRecurringSchedules({
      ...config,
      sync: { ...config.sync, intervalMs: 999 },
    })).toThrow('at least 1000ms');
    expect(() => buildBaselineRecurringSchedules({
      ...config,
      sync: { ...config.sync, intervalMs: Number.MAX_SAFE_INTEGER },
    })).toThrow('safe integer range');
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
    expect(queue.scheduleRecurring).toHaveBeenNthCalledWith(1, definitions[0]);
  });

  it('requires freshness jobs to complete after grace but not long-period jobs', async () => {
    const definitions = buildBaselineRecurringSchedules(config);
    const startedAt = 1_000_000;
    const queue = {
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
      getRecurringHeartbeatSnapshot: vi.fn().mockResolvedValue({
        healthy: true,
        records: {
          'sync:check-stale-wallets': {
            version: 1,
            schedulerId: 'sync:check-stale-wallets',
            recurrenceFingerprint: 'every:300000',
            activatedAt: startedAt,
            lastCompletedAt: startedAt + 200_000,
          },
        },
      }),
    } as any;

    const health = await inspectRecurringScheduleHealth(
      queue,
      definitions,
      startedAt + 400_000,
    );

    expect(health.healthy).toBe(false);
    expect(health.stale).toEqual(['maintenance:webhook:recover-due-deliveries']);
    expect(health.stale).not.toContain('maintenance:backup:scheduled');
  });

  it('anchors startup grace to the durable generation across worker restarts', async () => {
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const queue = {
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
      getRecurringHeartbeatSnapshot: vi.fn().mockResolvedValue({
        healthy: true,
        records: {
          'sync:check-stale-wallets': {
            version: 1,
            schedulerId: 'sync:check-stale-wallets',
            recurrenceFingerprint: 'every:300000',
            activatedAt,
          },
          'maintenance:webhook:recover-due-deliveries': {
            version: 1,
            schedulerId: 'maintenance:webhook:recover-due-deliveries',
            recurrenceFingerprint: 'pattern:* * * * *:tz:UTC',
            activatedAt,
          },
        },
      }),
    } as any;

    await expect(
      inspectRecurringScheduleHealth(queue, definitions, activatedAt + 30_000),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, stale: [] }));
    await expect(
      inspectRecurringScheduleHealth(queue, definitions, activatedAt + 400_000),
    ).resolves.toEqual(expect.objectContaining({
      healthy: false,
      stale: [
        'sync:check-stale-wallets',
        'maintenance:webhook:recover-due-deliveries',
      ],
    }));
  });

  it('grants a freshly booted worker its startup grace despite a stale durable activation', async () => {
    // The cold-start bug: activatedAt lives in Redis and survives restarts, so a
    // worker returning after a long outage had a grace window that expired while
    // it was down. /ready 503s on staleness and the backend blocks startup on
    // /ready, so this took the whole stack down for a full interval.
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const bootedAt = activatedAt + 86_400_000; // a day of downtime
    const queue = buildNeverCompletedQueue(activatedAt);

    await expect(
      inspectRecurringScheduleHealth(
        queue,
        definitions,
        bootedAt + 30_000,
        [],
        true,
        bootedAt,
      ),
    ).resolves.toEqual(expect.objectContaining({ healthy: true, stale: [] }));
  });

  it('still reports staleness once a long-running worker outlives the grace window', async () => {
    // Anti-masking: boot anchoring must not hide a schedule that never completes
    // on a worker that has been up comfortably longer than its grace window.
    const definitions = buildBaselineRecurringSchedules(config);
    const activatedAt = 1_000_000;
    const bootedAt = activatedAt + 86_400_000;
    const queue = buildNeverCompletedQueue(activatedAt);

    await expect(
      inspectRecurringScheduleHealth(
        queue,
        definitions,
        bootedAt + 400_000,
        [],
        true,
        bootedAt,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        stale: [
          'sync:check-stale-wallets',
          'maintenance:webhook:recover-due-deliveries',
        ],
      }),
    );
  });

  it('fails readiness closed when durable heartbeat reads are unhealthy', async () => {
    const definitions = buildBaselineRecurringSchedules(config);
    const now = Date.now();
    const queue = {
      inspectRecurringSchedules: vi.fn().mockResolvedValue({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      }),
      getRecurringHeartbeatSnapshot: vi.fn().mockResolvedValue({
        healthy: false,
        records: freshHeartbeatRecords(definitions, now),
      }),
    } as any;

    await expect(
      inspectRecurringScheduleHealth(queue, definitions, now),
    ).resolves.toEqual(expect.objectContaining({
      healthy: false,
      heartbeatHealthy: false,
    }));
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
    queue.getRecurringHeartbeatSnapshot = vi.fn().mockResolvedValue({
      healthy: true,
      records: freshHeartbeatRecords(state.desired, Date.now()),
    });
    await expect(
      inspectRecurringScheduleHealth(
        queue,
        state.desired,
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
      scheduleRecurring: vi.fn(async (definition: { name: string }) => {
        operations.push(`schedule:${definition.name}`);
        if (definition.name === 'autopilot:record-fees') {
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
