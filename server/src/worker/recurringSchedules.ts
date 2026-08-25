import type { CombinedConfig } from '../config';
import {
  CONFIRMATIONS_QUEUE_NAME,
  SYNC_JOB_CONTRACT_VERSION,
  UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
  type UpdateAllConfirmationsJobData,
} from '../jobs/syncJobContract';
import type {
  RecurringScheduleDefinition,
  RecurringScheduleRecurrence,
  RecurringRemovalResult,
  RecurringScheduleResult,
  WorkerJobQueue,
} from './workerJobQueue';
import {
  buildStaleWalletCompatibilitySchedule,
  requireStaleWalletCompatibilitySchedule,
  type WithStaleWalletRetirementLock,
} from './staleWalletScheduleCompatibility';

const MINUTE_MS = 60_000;
export const RECURRING_SCHEDULE_RECONCILIATION_INTERVAL_MS = MINUTE_MS;
export const WEBHOOK_RECOVERY_JOB_NAME = 'webhook:recover-due-deliveries';

export interface RecurringScheduleHealth {
  healthy: boolean;
  missing: string[];
  mismatched: string[];
  stale: string[];
  unexpected: string[];
  inspectionFailures: string[];
  reconciliationFailed: boolean;
  heartbeatHealthy: boolean;
  completionTimes: Record<string, number>;
}

export interface RecurringScheduleReconciliation {
  healthy: boolean;
  results: Record<string, RecurringScheduleResult>;
  removals: Record<string, RecurringRemovalResult>;
}

export interface RecurringScheduleCoordinatorState {
  desired: RecurringScheduleDefinition[];
  forbidden: RecurringScheduleDefinition[];
  reconciliationHealthy: boolean;
}

interface ConditionalScheduleState {
  autopilotEnabled: boolean;
  intelligenceEnabled: boolean;
  staleWalletScheduleForbidden: boolean;
}

const STALE_WALLET_PURGE_RESULT_ID = 'sync:stale-wallet-jobs';
const STALE_WALLET_PURGE_MAX_PASSES = 5;

export { requireStaleWalletCompatibilitySchedule as requireStaleWalletSchedule };

function defineSchedule<T>(
  queue: string,
  name: string,
  data: T,
  recurrence: RecurringScheduleRecurrence,
  freshness?: RecurringScheduleDefinition['freshness'],
): RecurringScheduleDefinition<T> {
  return {
    schedulerId: `${queue}:${name}`,
    queue,
    name,
    data,
    recurrence,
    ...(freshness ? { freshness } : {}),
  };
}

function every(milliseconds: number): RecurringScheduleRecurrence {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000) {
    throw new Error(
      'Recurring interval must be a safe integer of at least 1000ms',
    );
  }
  return { every: milliseconds };
}

function utcCron(pattern: string): RecurringScheduleRecurrence {
  return { pattern, tz: 'UTC' };
}

export function buildBaselineRecurringSchedules(
  config: CombinedConfig,
): RecurringScheduleDefinition[] {
  return [
    buildStaleWalletCompatibilitySchedule(config),
    defineSchedule<UpdateAllConfirmationsJobData>(
      CONFIRMATIONS_QUEUE_NAME,
      UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
      { version: SYNC_JOB_CONTRACT_VERSION },
      every(config.sync.confirmationUpdateIntervalMs),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:expired-drafts',
      {},
      utcCron('0 * * * *'),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:expired-transfers',
      {},
      utcCron('30 * * * *'),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:audit-logs',
      { retentionDays: config.maintenance.auditLogRetentionDays },
      utcCron('0 2 * * *'),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:price-data',
      { retentionDays: config.maintenance.priceDataRetentionDays },
      utcCron('0 3 * * *'),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:fee-estimates',
      { retentionDays: config.maintenance.feeEstimateRetentionDays },
      utcCron('0 4 * * *'),
    ),
    defineSchedule(
      'maintenance',
      'persist:price-fees',
      {},
      utcCron('* * * * *'),
    ),
    defineSchedule(
      'maintenance',
      'cleanup:expired-tokens',
      {},
      utcCron('0 5 * * *'),
    ),
    defineSchedule(
      'maintenance',
      'maintenance:weekly-vacuum',
      {},
      utcCron('0 3 * * 0'),
    ),
    defineSchedule(
      'maintenance',
      'maintenance:monthly-cleanup',
      {},
      utcCron('0 4 1 * *'),
    ),
    defineSchedule(
      'maintenance',
      'backup:scheduled',
      { retentionCount: 7 },
      utcCron('0 1 * * *'),
    ),
    defineSchedule(
      'maintenance',
      'reconcile:signing-intent-broadcasts',
      {},
      utcCron('* * * * *'),
    ),
    defineSchedule(
      'maintenance',
      WEBHOOK_RECOVERY_JOB_NAME,
      {},
      utcCron('* * * * *'),
      {
        maxAgeMs: 2 * MINUTE_MS,
        startupGraceMs: 90_000,
      },
    ),
  ];
}

export const AUTOPILOT_RECURRING_SCHEDULES: RecurringScheduleDefinition[] = [
  defineSchedule(
    'maintenance',
    'autopilot:record-fees',
    {},
    utcCron('*/10 * * * *'),
  ),
  defineSchedule(
    'maintenance',
    'autopilot:evaluate',
    {},
    utcCron('5/10 * * * *'),
  ),
];

export const INTELLIGENCE_RECURRING_SCHEDULES: RecurringScheduleDefinition[] = [
  defineSchedule(
    'maintenance',
    'intelligence:analyze',
    {},
    utcCron('*/30 * * * *'),
  ),
  defineSchedule(
    'maintenance',
    'intelligence:cleanup',
    {},
    utcCron('0 6 * * *'),
  ),
];

export async function reconcileRecurringSchedules(
  queue: WorkerJobQueue,
  definitions: RecurringScheduleDefinition[],
): Promise<RecurringScheduleReconciliation> {
  const results: Record<string, RecurringScheduleResult> = {};
  for (const definition of definitions) {
    results[definition.schedulerId] = await queue.scheduleRecurring(definition);
  }

  return {
    healthy: Object.values(results).every(({ status }) => status !== 'failed'),
    results,
    removals: {},
  };
}

async function removeRecurringSchedules(
  queue: WorkerJobQueue,
  definitions: RecurringScheduleDefinition[],
): Promise<Record<string, RecurringRemovalResult>> {
  const removals: Record<string, RecurringRemovalResult> = {};
  for (const definition of definitions) {
    removals[definition.schedulerId] = await queue.removeRecurring(
      definition.queue,
      definition.name,
      { purgeQueued: true },
    );
  }
  return removals;
}

async function purgeStaleWalletJobsUntilClean(
  queue: WorkerJobQueue,
): Promise<RecurringRemovalResult> {
  let removed = false;
  for (let pass = 0; pass < STALE_WALLET_PURGE_MAX_PASSES; pass += 1) {
    const result = await queue.purgeStaleWalletScheduleJobs();
    if (result.status === 'failed') return result;
    if (result.status === 'absent') {
      return { status: removed ? 'removed' : 'absent' };
    }
    removed = true;
  }
  return {
    status: 'failed',
    error: 'Stale-wallet scheduler jobs kept reappearing during cleanup',
  };
}

export class RecurringScheduleCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private state: RecurringScheduleCoordinatorState = {
    desired: [],
    forbidden: [
      ...AUTOPILOT_RECURRING_SCHEDULES,
      ...INTELLIGENCE_RECURRING_SCHEDULES,
    ],
    reconciliationHealthy: false,
  };

  constructor(
    private readonly queue: WorkerJobQueue,
    private readonly config: CombinedConfig,
    private readonly readConditionalState: () => Promise<ConditionalScheduleState>,
    private readonly withRetirementLock?: WithStaleWalletRetirementLock,
  ) {}

  reconcile(): Promise<RecurringScheduleReconciliation> {
    const operation = this.tail.then(() => this.reconcileCurrentState());
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  getState(): RecurringScheduleCoordinatorState {
    return {
      desired: [...this.state.desired],
      forbidden: [...this.state.forbidden],
      reconciliationHealthy: this.state.reconciliationHealthy,
    };
  }

  private async reconcileCurrentState(): Promise<RecurringScheduleReconciliation> {
    try {
      const conditional = await this.readConditionalState();
      const reconcile = (staleWalletScheduleForbidden: boolean) => (
        this.reconcileConditionalState({
          ...conditional,
          staleWalletScheduleForbidden,
        })
      );
      return this.withRetirementLock
        ? await this.withRetirementLock(reconcile)
        : await reconcile(conditional.staleWalletScheduleForbidden);
    } catch (error) {
      this.state = {
        ...this.state,
        reconciliationHealthy: false,
      };
      throw error;
    }
  }

  private async reconcileConditionalState(
    conditional: ConditionalScheduleState,
  ): Promise<RecurringScheduleReconciliation> {
      const baseline = buildBaselineRecurringSchedules(this.config);
      const staleWalletSchedule = requireStaleWalletCompatibilitySchedule(baseline);
      const desiredConditional = [
        ...(conditional.autopilotEnabled ? AUTOPILOT_RECURRING_SCHEDULES : []),
        ...(conditional.intelligenceEnabled
          ? INTELLIGENCE_RECURRING_SCHEDULES
          : []),
      ];
      const forbidden = [
        ...(conditional.staleWalletScheduleForbidden
          ? [staleWalletSchedule]
          : []),
        ...(!conditional.autopilotEnabled
          ? AUTOPILOT_RECURRING_SCHEDULES
          : []),
        ...(!conditional.intelligenceEnabled
          ? INTELLIGENCE_RECURRING_SCHEDULES
          : []),
      ];
      const desired = [
        ...baseline.filter(
          ({ schedulerId }) =>
            !conditional.staleWalletScheduleForbidden ||
            schedulerId !== staleWalletSchedule.schedulerId,
        ),
        ...desiredConditional,
      ];
      this.state = {
        desired,
        forbidden,
        reconciliationHealthy: false,
      };

      const removals = await removeRecurringSchedules(this.queue, forbidden);
      if (conditional.staleWalletScheduleForbidden) {
        removals[STALE_WALLET_PURGE_RESULT_ID] =
          await purgeStaleWalletJobsUntilClean(this.queue);
      }
      const removalHealthy = Object.values(removals).every(
        ({ status }) => status !== 'failed',
      );
      // Once the irreversible tombstone exists, scheduling desired work while
      // retired definitions or children may remain would violate the rollback
      // floor. Keep startup/reconciliation fail-closed until removal succeeds.
      const reconciliation = removalHealthy
        ? await reconcileRecurringSchedules(this.queue, desired)
        : { healthy: false, results: {}, removals: {} };
      const healthy = reconciliation.healthy && removalHealthy;
      this.state = {
        desired,
        forbidden,
        reconciliationHealthy: healthy,
      };
      return {
        healthy,
        results: reconciliation.results,
        removals,
      };
  }
}

function completionTimesFrom(
  records: Awaited<
    ReturnType<WorkerJobQueue['getRecurringHeartbeatSnapshot']>
  >['records'],
): Record<string, number> {
  const completionTimes: Record<string, number> = {};
  for (const [schedulerId, record] of Object.entries(records)) {
    if (record.lastCompletedAt !== undefined) {
      completionTimes[schedulerId] = record.lastCompletedAt;
    }
  }
  return completionTimes;
}

export async function inspectRecurringScheduleHealth(
  queue: WorkerJobQueue,
  definitions: RecurringScheduleDefinition[],
  now = Date.now(),
  forbiddenDefinitions: RecurringScheduleDefinition[] = [],
  reconciliationHealthy = true,
  /**
   * When this worker process booted. The startup grace below is measured from
   * whichever is later, this or the schedule's `activatedAt`.
   *
   * `activatedAt` lives in Redis and deliberately survives worker restarts, so
   * on its own it grants no grace to a worker returning after an outage longer
   * than the grace window — the schedule is reported stale purely because its
   * (long) interval has not elapsed since boot. Because /ready 503s on
   * staleness and the backend blocks startup on it, that took the whole stack
   * down for one full interval on any cold start. Defaults to 0, which
   * reproduces the previous activatedAt-only behaviour.
   */
  workerStartedAt = 0,
): Promise<RecurringScheduleHealth> {
  const [inspection, heartbeat] = await Promise.all([
    queue.inspectRecurringSchedules(definitions, forbiddenDefinitions),
    queue.getRecurringHeartbeatSnapshot(definitions),
  ]);
  const stale = definitions
    .filter(({ freshness, schedulerId }) => {
      if (!freshness) return false;
      const record = heartbeat.records[schedulerId];
      if (!record) return true;
      // Anti-masking is preserved: for a worker that has been up longer than the
      // grace window, workerStartedAt is already older than the window, so this
      // only ever forgives a schedule that has not yet had a chance to run on a
      // freshly booted process.
      //
      // A completion recorded before this process booted counts as "not yet
      // run" too. lastCompletedAt is durable, so an upgrade whose downtime
      // exceeds maxAgeMs leaves a pre-restart completion that is already stale
      // the instant the new worker boots. Restricting the grace to
      // never-completed schedules meant /health 503'd and the backend's
      // critical worker-heartbeat service aborted startup long before the job
      // could run again, so a slow rebuild took the whole stack down.
      const graceStartedAt = Math.max(record.activatedAt, workerStartedAt);
      const notRunSinceBoot =
        record.lastCompletedAt === undefined ||
        record.lastCompletedAt < workerStartedAt;
      if (notRunSinceBoot && now - graceStartedAt <= freshness.startupGraceMs) {
        return false;
      }
      return (
        record.lastCompletedAt === undefined ||
        now - record.lastCompletedAt > freshness.maxAgeMs
      );
    })
    .map(({ schedulerId }) => schedulerId);
  const completionTimes = completionTimesFrom(heartbeat.records);

  return {
    healthy:
      inspection.healthy &&
      heartbeat.healthy &&
      stale.length === 0 &&
      reconciliationHealthy,
    missing: inspection.missing,
    mismatched: inspection.mismatched,
    stale,
    unexpected: inspection.unexpected,
    inspectionFailures: inspection.inspectionFailures,
    reconciliationFailed: !reconciliationHealthy,
    heartbeatHealthy: heartbeat.healthy,
    completionTimes,
  };
}
