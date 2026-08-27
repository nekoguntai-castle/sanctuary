import type { DisplayLogEntry } from './types';
import {
  SyncProgressDetailsSchema,
  type SyncProgressDetails,
  type SyncProgressStage,
} from '@sanctuary/shared/schemas/syncProgress';
import { parseStrictIsoInstant } from '../../../utils/isoInstant';

const STAGE_LABELS: Record<SyncProgressStage, string> = {
  candidate_fetch: 'Fetching transaction candidates',
  parent_fetch: 'Fetching parent transactions',
  timestamp_fetch: 'Fetching transaction timestamps',
  classification: 'Classifying transactions',
  persistence: 'Saving transactions',
};

const EVENT_LABELS: Record<SyncProgressDetails['event'], string> = {
  stage_started: 'Started',
  fallback: 'Using fallback',
  batch_completed: 'Batch completed',
  timeout: 'Timed out',
  aborted: 'Stopped',
};

export function parseSyncProgressDetails(details: unknown): SyncProgressDetails | null {
  const parsed = SyncProgressDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

export function formatSyncProgressDetails(details: SyncProgressDetails): string {
  const progress = details.completed === undefined
    ? ''
    : ` · ${details.completed}/${details.total} ${details.unit.replace('_', ' ')}`;
  return `${STAGE_LABELS[details.stage]} · ${EVENT_LABELS[details.event]} · batch ${details.batch}/${details.batchCount}${progress}`;
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
  details: SyncProgressDetails;
  timestamp: number;
}

export function findLastSyncProgressCheckpoint(
  entries: readonly DisplayLogEntry[],
): SyncProgressCheckpoint | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const details = parseSyncProgressDetails(entry?.details);
    const timestamp = entry ? parseStrictIsoInstant(entry.timestamp) : null;
    if (details && timestamp !== null) return { details, timestamp };
  }
  return null;
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

  const progress = parseSyncProgressDetails(entry.details);
  if (progress) return formatSyncProgressDetails(progress);

  return Object.entries(entry.details)
    .filter(([key]) => key !== 'viaTor')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}
