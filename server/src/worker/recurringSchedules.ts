import type { CombinedConfig } from '../config';
import type {
  RecurringScheduleDefinition,
  RecurringRemovalResult,
  RecurringScheduleResult,
  WorkerJobQueue,
} from './workerJobQueue';

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
}

function defineSchedule<T>(
  queue: string,
  name: string,
  data: T,
  cron: string,
  freshness?: RecurringScheduleDefinition['freshness'],
): RecurringScheduleDefinition<T> {
  return {
    schedulerId: `${queue}:${name}`,
    queue,
    name,
    data,
    cron,
    ...(freshness ? { freshness } : {}),
  };
}

export function buildBaselineRecurringSchedules(
  config: CombinedConfig,
): RecurringScheduleDefinition[] {
  const syncMinutes = Math.max(
    1,
    Math.floor(config.sync.intervalMs / MINUTE_MS),
  );
  const confirmationMinutes = Math.max(
    1,
    Math.floor(config.sync.confirmationUpdateIntervalMs / MINUTE_MS),
  );

  return [
    defineSchedule(
      'sync',
      'check-stale-wallets',
      {},
      `*/${syncMinutes} * * * *`,
      {
        maxAgeMs: config.sync.intervalMs * 2,
        startupGraceMs: config.sync.intervalMs + 30_000,
      },
    ),
    defineSchedule(
      'confirmations',
      'update-all-confirmations',
      {},
      `*/${confirmationMinutes} * * * *`,
    ),
    defineSchedule('maintenance', 'cleanup:expired-drafts', {}, '0 * * * *'),
    defineSchedule('maintenance', 'cleanup:expired-transfers', {}, '30 * * * *'),
    defineSchedule(
      'maintenance',
      'cleanup:audit-logs',
      { retentionDays: config.maintenance.auditLogRetentionDays },
      '0 2 * * *',
    ),
    defineSchedule(
      'maintenance',
      'cleanup:price-data',
      { retentionDays: config.maintenance.priceDataRetentionDays },
      '0 3 * * *',
    ),
    defineSchedule(
      'maintenance',
      'cleanup:fee-estimates',
      { retentionDays: config.maintenance.feeEstimateRetentionDays },
      '0 4 * * *',
    ),
    defineSchedule('maintenance', 'persist:price-fees', {}, '* * * * *'),
    defineSchedule('maintenance', 'cleanup:expired-tokens', {}, '0 5 * * *'),
    defineSchedule('maintenance', 'maintenance:weekly-vacuum', {}, '0 3 * * 0'),
    defineSchedule('maintenance', 'maintenance:monthly-cleanup', {}, '0 4 1 * *'),
    defineSchedule(
      'maintenance',
      'backup:scheduled',
      { retentionCount: 7 },
      '0 1 * * *',
    ),
    defineSchedule(
      'maintenance',
      WEBHOOK_RECOVERY_JOB_NAME,
      {},
      '* * * * *',
      {
        maxAgeMs: 2 * MINUTE_MS,
        startupGraceMs: 90_000,
      },
    ),
  ];
}

export const AUTOPILOT_RECURRING_SCHEDULES: RecurringScheduleDefinition[] = [
  defineSchedule('maintenance', 'autopilot:record-fees', {}, '*/10 * * * *'),
  defineSchedule('maintenance', 'autopilot:evaluate', {}, '5/10 * * * *'),
];

export const INTELLIGENCE_RECURRING_SCHEDULES: RecurringScheduleDefinition[] = [
  defineSchedule('maintenance', 'intelligence:analyze', {}, '*/30 * * * *'),
  defineSchedule(
    'maintenance',
    'intelligence:cleanup',
    {},
    '0 6 * * *',
  ),
];

export async function reconcileRecurringSchedules(
  queue: WorkerJobQueue,
  definitions: RecurringScheduleDefinition[],
): Promise<RecurringScheduleReconciliation> {
  const results: Record<string, RecurringScheduleResult> = {};
  for (const definition of definitions) {
    results[definition.schedulerId] = definition.options
      ? await queue.scheduleRecurring(
          definition.queue,
          definition.name,
          definition.data,
          definition.cron,
          definition.options,
        )
      : await queue.scheduleRecurring(
          definition.queue,
          definition.name,
          definition.data,
          definition.cron,
        );
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
      const desiredConditional = [
        ...(conditional.autopilotEnabled ? AUTOPILOT_RECURRING_SCHEDULES : []),
        ...(conditional.intelligenceEnabled
          ? INTELLIGENCE_RECURRING_SCHEDULES
          : []),
      ];
      const forbidden = [
        ...(!conditional.autopilotEnabled
          ? AUTOPILOT_RECURRING_SCHEDULES
          : []),
        ...(!conditional.intelligenceEnabled
          ? INTELLIGENCE_RECURRING_SCHEDULES
          : []),
      ];
      const desired = [
        ...buildBaselineRecurringSchedules(this.config),
        ...desiredConditional,
      ];
      this.state = {
        desired,
        forbidden,
        reconciliationHealthy: false,
      };

      const reconciliation = await reconcileRecurringSchedules(
        this.queue,
        desired,
      );
      const removals = await removeRecurringSchedules(this.queue, forbidden);
      const removalHealthy = Object.values(removals).every(
        ({ status }) => status !== 'failed',
      );
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
    } catch (error) {
      this.state = {
        ...this.state,
        reconciliationHealthy: false,
      };
      throw error;
    }
  }
}

export async function inspectRecurringScheduleHealth(
  queue: WorkerJobQueue,
  definitions: RecurringScheduleDefinition[],
  completionTimes: Record<string, number>,
  workerStartedAt: number,
  now = Date.now(),
  forbiddenDefinitions: RecurringScheduleDefinition[] = [],
  reconciliationHealthy = true,
): Promise<RecurringScheduleHealth> {
  const inspection = await queue.inspectRecurringSchedules(
    definitions,
    forbiddenDefinitions,
  );
  const stale = definitions
    .filter(({ freshness, schedulerId }) => {
      if (!freshness || now - workerStartedAt <= freshness.startupGraceMs) {
        return false;
      }
      const lastCompletion = completionTimes[schedulerId];
      return (
        lastCompletion === undefined ||
        now - lastCompletion > freshness.maxAgeMs
      );
    })
    .map(({ schedulerId }) => schedulerId);

  return {
    healthy:
      inspection.healthy &&
      stale.length === 0 &&
      reconciliationHealthy,
    missing: inspection.missing,
    mismatched: inspection.mismatched,
    stale,
    unexpected: inspection.unexpected,
    inspectionFailures: inspection.inspectionFailures,
    reconciliationFailed: !reconciliationHealthy,
  };
}
