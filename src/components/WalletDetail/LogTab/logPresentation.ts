import type { DisplayLogEntry } from './types';
import {
  SYNC_PROGRESS_MAX_ELAPSED_MS,
  SyncPhaseProgressDetailsSchema,
  SyncProgressDetailsSchema,
  type SyncExecutionStage,
  type SyncPhaseProgressDetails,
  type SyncProgressDetails,
} from '@sanctuary/shared/schemas/syncProgress';
import { parseStrictIsoInstant } from '../../../utils/isoInstant';

const STAGE_LABELS: Record<SyncExecutionStage, string> = {
  preflight: 'Preparing wallet sync',
  initial_network: 'Checking network status',
  address_history: 'Fetching address history',
  transaction_reconciliation: 'Reconciling transactions',
  candidate_fetch: 'Fetching transaction candidates',
  parent_fetch: 'Fetching parent transactions',
  timestamp_fetch: 'Fetching transaction timestamps',
  classification: 'Classifying transactions',
  persistence: 'Saving transactions',
  utxo_reconciliation: 'Reconciling UTXOs',
  address_maintenance: 'Maintaining wallet addresses',
  missing_field_repair: 'Repairing transaction details',
  subscription_enrollment: 'Enrolling address subscriptions',
  finalization: 'Finalizing wallet sync',
};

const EVENT_LABELS: Record<SyncProgressDetails['event'], string> = {
  stage_started: 'Started',
  fallback: 'Using fallback',
  batch_completed: 'Batch completed',
  timeout: 'Timed out',
  aborted: 'Stopped',
};

const PHASE_EVENT_LABELS: Record<SyncPhaseProgressDetails['event'], string> = {
  stage_started: 'Started',
  stage_completed: 'Completed',
  stage_failed: 'Failed',
  stage_aborted: 'Stopped',
};

export type SyncProgressPresentationDetails = SyncProgressDetails | SyncPhaseProgressDetails;

export function parseSyncProgressDetails(details: unknown): SyncProgressDetails | null {
  const parsed = SyncProgressDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

export function parseSyncProgressPresentationDetails(
  details: unknown,
): SyncProgressPresentationDetails | null {
  const candidate = SyncProgressDetailsSchema.safeParse(details);
  if (candidate.success) return candidate.data;
  const phase = SyncPhaseProgressDetailsSchema.safeParse(details);
  return phase.success ? phase.data : null;
}

export function getSyncStageLabel(stage: SyncExecutionStage): string {
  return STAGE_LABELS[stage];
}

function formatKnownWork(details: SyncProgressPresentationDetails): string {
  if (details.kind === 'sync_progress') {
    const items = details.completed === undefined
      ? ''
      : ` · ${details.completed}/${details.total} ${details.unit.replace('_', ' ')}`;
    return ` · batch ${details.batch}/${details.batchCount}${items}`;
  }
  return details.workItems
    ? ` · ${details.workItems.completed}/${details.workItems.total} ${details.workItems.unit}`
    : '';
}

function getEventLabel(details: SyncProgressPresentationDetails): string {
  return details.kind === 'sync_progress'
    ? EVENT_LABELS[details.event]
    : PHASE_EVENT_LABELS[details.event];
}

export function formatSyncProgressDetails(details: SyncProgressDetails): string {
  return formatSyncProgressPresentationDetails(details);
}

export function formatSyncProgressPresentationDetails(
  details: SyncProgressPresentationDetails,
): string {
  return `${STAGE_LABELS[details.stage]} · ${getEventLabel(details)}${formatKnownWork(details)}`;
}

export function findLastSyncProgressDetails(
  entries: readonly DisplayLogEntry[],
): SyncProgressDetails | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const parsed = parseSyncProgressDetails(entries[index]?.details);
    if (parsed) return parsed;
  }
  return null;
}

export interface SyncProgressCheckpoint {
  details: SyncProgressPresentationDetails;
  timestamp: number;
}

export function findLastSyncProgressCheckpoint(
  entries: readonly DisplayLogEntry[],
): SyncProgressCheckpoint | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const details = parseSyncProgressPresentationDetails(entry?.details);
    const timestamp = entry ? parseStrictIsoInstant(entry.timestamp) : null;
    if (details && timestamp !== null) return { details, timestamp };
  }
  return null;
}

export function isActiveSyncProgressCheckpoint(checkpoint: SyncProgressCheckpoint): boolean {
  return checkpoint.details.event === 'stage_started';
}

export function formatSyncStageDuration(elapsedMs: number): string {
  const seconds = Math.floor(Math.min(
    SYNC_PROGRESS_MAX_ELAPSED_MS,
    Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0),
  ) / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function getSyncCheckpointElapsedMs(
  checkpoint: SyncProgressCheckpoint,
  now: number,
): number {
  if (!isActiveSyncProgressCheckpoint(checkpoint)) return checkpoint.details.elapsedMs;
  const stageStartedAt = checkpoint.timestamp - checkpoint.details.elapsedMs;
  if (!Number.isFinite(now) || !Number.isFinite(stageStartedAt)) return 0;
  return Math.min(SYNC_PROGRESS_MAX_ELAPSED_MS, Math.max(0, now - stageStartedAt));
}

export function formatCurrentSyncCheckpoint(
  checkpoint: SyncProgressCheckpoint,
  now: number,
): string {
  const { details } = checkpoint;
  const event = isActiveSyncProgressCheckpoint(checkpoint) ? '' : ` · ${getEventLabel(details)}`;
  return `${getSyncStageLabel(details.stage)} · ${formatSyncStageDuration(getSyncCheckpointElapsedMs(checkpoint, now))} in stage${event}${formatKnownWork(details)}`;
}

export function getLogRowToneClass(level: string): string {
  if (level === 'error') {
    return 'bg-rose-50/50 dark:bg-rose-900/10';
  }

  if (level === 'warn') {
    return 'bg-warning-50/50 dark:bg-warning-900/10';
  }

  return '';
}

export function getLevelTextClass(level: string): string {
  if (level === 'debug') {
    return 'text-sanctuary-400';
  }

  if (level === 'info') {
    return 'text-success-600';
  }

  if (level === 'warn') {
    return 'text-warning-600';
  }

  return 'text-rose-600 dark:text-rose-400';
}

export function getModuleBadgeClass(moduleName: string): string {
  if (moduleName === 'SYNC') {
    return 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300';
  }

  if (moduleName === 'BLOCKCHAIN') {
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
  }

  if (moduleName === 'TX') {
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
  }

  if (moduleName === 'UTXO') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }

  if (moduleName === 'ELECTRUM') {
    return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300';
  }

  return 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400';
}

export function formatLogDetails(entry: DisplayLogEntry): string {
  if (!entry.details) {
    return '';
  }

  const progress = parseSyncProgressPresentationDetails(entry.details);
  if (progress) return formatSyncProgressPresentationDetails(progress);

  return Object.entries(entry.details)
    .filter(([key]) => key !== 'viaTor')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}
