import {
  SYNC_PROGRESS_MAX_COUNT,
  SYNC_PROGRESS_MAX_ELAPSED_MS,
  SyncPhaseProgressDetailsSchema,
  type SyncExecutionStage,
  type SyncPhaseProgressDetails,
  type SyncPhaseProgressEvent,
  type SyncPhaseProgressUnit,
} from '@sanctuary/shared/schemas/syncProgress';
import { walletLog } from '../../../websocket/notifications';
import { createLogger } from '../../../utils/logger';
import type { SyncAttemptTelemetry, SyncStageOutcome } from './attemptRuntime';

const log = createLogger('BITCOIN:SYNC_PHASE_PROGRESS');

export interface SyncPhaseWorkItems {
  completed: number;
  total: number;
  unit: SyncPhaseProgressUnit;
}

export interface SyncPhaseProgress {
  begin(stage: SyncExecutionStage, message?: string, workItems?: SyncPhaseWorkItems): boolean;
  finish(
    event?: Exclude<SyncPhaseProgressEvent, 'stage_started'>,
    message?: string,
    workItems?: SyncPhaseWorkItems,
  ): boolean;
  budgetExpired(message?: string, workItems?: SyncPhaseWorkItems): boolean;
  activeStage(): SyncExecutionStage | null;
}

const boundedInteger = (value: number, maximum: number): number => Math.min(
  maximum,
  Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)),
);

function normalizeWorkItems(input: SyncPhaseWorkItems | undefined): SyncPhaseWorkItems | undefined {
  if (!input) return undefined;
  const total = boundedInteger(input.total, SYNC_PROGRESS_MAX_COUNT);
  return {
    completed: Math.min(boundedInteger(input.completed, SYNC_PROGRESS_MAX_COUNT), total),
    total,
    unit: input.unit,
  };
}

function outcomeFor(event: Exclude<SyncPhaseProgressEvent, 'stage_started'>): SyncStageOutcome {
  if (event === 'stage_completed') return 'completed';
  if (event === 'stage_aborted') return 'aborted';
  return 'failed';
}

function defaultMessage(stage: SyncExecutionStage, event: SyncPhaseProgressEvent): string {
  const label = stage.replace(/_/g, ' ');
  if (event === 'stage_started') return `Starting ${label}.`;
  if (event === 'stage_completed') return `Completed ${label}.`;
  if (event === 'stage_aborted') return `Cancelled ${label}.`;
  return `Failed ${label}.`;
}

/** Emits strict phase checkpoints while delegating idempotency to attempt telemetry. */
export function createSyncPhaseProgress(
  walletId: string,
  telemetry: SyncAttemptTelemetry | undefined,
  now: () => number = Date.now,
): SyncPhaseProgress {
  let active: {
    stage: SyncExecutionStage;
    startedAtMs: number;
    workItems?: SyncPhaseWorkItems;
  } | null = null;

  const emit = (
    stage: SyncExecutionStage,
    event: SyncPhaseProgressEvent,
    elapsedMs: number,
    message: string | undefined,
    workItems: SyncPhaseWorkItems | undefined,
  ): void => {
    const details: SyncPhaseProgressDetails = SyncPhaseProgressDetailsSchema.parse({
      kind: 'sync_phase_progress',
      event,
      stage,
      elapsedMs: boundedInteger(elapsedMs, SYNC_PROGRESS_MAX_ELAPSED_MS),
      ...(workItems ? { workItems: normalizeWorkItems(workItems) } : {}),
    });
    walletLog(
      walletId,
      event === 'stage_failed' || event === 'stage_aborted' ? 'warn' : 'info',
      'SYNC',
      message ?? defaultMessage(stage, event),
      details,
    );
    const logDetails = { ...details };
    if (event === 'stage_failed' || event === 'stage_aborted') {
      log.warn('sync_phase_progress', logDetails);
    } else {
      log.info('sync_phase_progress', logDetails);
    }
  };

  const finishWithOutcome = (
    event: Exclude<SyncPhaseProgressEvent, 'stage_started'>,
    outcome: SyncStageOutcome,
    message?: string,
    workItems?: SyncPhaseWorkItems,
  ): boolean => {
    if (!active || !telemetry) return false;
    const finishedAtMs = now();
    const current = active;
    if (!telemetry.finishStage(current.stage, outcome, finishedAtMs)) return false;
    active = null;
    const terminalWork = normalizeWorkItems(workItems) ?? (event === 'stage_completed'
      && current.workItems
      ? { ...current.workItems, completed: current.workItems.total }
      : current.workItems);
    emit(
      current.stage,
      event,
      finishedAtMs - current.startedAtMs,
      message,
      terminalWork,
    );
    return true;
  };

  const finish = (
    event: Exclude<SyncPhaseProgressEvent, 'stage_started'> = 'stage_completed',
    message?: string,
    workItems?: SyncPhaseWorkItems,
  ): boolean => finishWithOutcome(event, outcomeFor(event), message, workItems);

  return {
    begin(stage, message, workItems) {
      if (!telemetry || active?.stage === stage) return false;
      if (active) finish('stage_completed');
      const startedAtMs = now();
      if (!telemetry.beginStage(stage, startedAtMs)) return false;
      active = { stage, startedAtMs, ...(workItems ? { workItems: normalizeWorkItems(workItems) } : {}) };
      emit(stage, 'stage_started', 0, message, workItems);
      return true;
    },
    finish,
    budgetExpired: (message, workItems) => finishWithOutcome(
      'stage_failed',
      'budget_expired',
      message ?? 'Remote stage budget expired.',
      workItems,
    ),
    activeStage: () => active?.stage ?? null,
  };
}
