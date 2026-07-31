import type { RecurringScheduleDefinition } from './types';
import { recurrenceFingerprint } from './recurringRecurrence';

export const RECURRING_HEARTBEAT_VERSION = 1;

interface RecurringRecordIdentity {
  version: typeof RECURRING_HEARTBEAT_VERSION;
  schedulerId: string;
  recurrenceFingerprint: string;
  generationToken: string;
}

export interface RecurringGenerationRecord extends RecurringRecordIdentity {
  activatedAt: number;
}

export interface RecurringCompletionRecord extends RecurringRecordIdentity {
  lastCompletedAt: number;
}

export interface RecurringHeartbeatRecord extends RecurringGenerationRecord {
  lastCompletedAt?: number;
}

function hasExpectedIdentity(
  parsed: Partial<RecurringRecordIdentity>,
  definition: RecurringScheduleDefinition,
): boolean {
  return (
    parsed.version === RECURRING_HEARTBEAT_VERSION &&
    parsed.schedulerId === definition.schedulerId &&
    typeof parsed.generationToken === 'string' &&
    parsed.generationToken.length > 0 &&
    parsed.recurrenceFingerprint ===
      recurrenceFingerprint(definition.recurrence)
  );
}

export function parseRecurringGeneration(
  raw: string | null,
  definition: RecurringScheduleDefinition,
): RecurringGenerationRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecurringGenerationRecord>;
    return hasExpectedIdentity(parsed, definition) &&
      Number.isSafeInteger(parsed.activatedAt) &&
      parsed.activatedAt! >= 0
      ? (parsed as RecurringGenerationRecord)
      : null;
  } catch {
    return null;
  }
}

export function parseRecurringCompletion(
  raw: string | null,
  definition: RecurringScheduleDefinition,
): RecurringCompletionRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecurringCompletionRecord>;
    return hasExpectedIdentity(parsed, definition) &&
      Number.isSafeInteger(parsed.lastCompletedAt) &&
      parsed.lastCompletedAt! >= 0
      ? (parsed as RecurringCompletionRecord)
      : null;
  } catch {
    return null;
  }
}
