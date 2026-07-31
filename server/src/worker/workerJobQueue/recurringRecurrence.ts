import type { RepeatOptions } from 'bullmq';
import type { RecurringScheduleRecurrence } from './types';

interface SchedulerRecurrence {
  every?: number;
  pattern?: string;
  tz?: string;
}

export function recurrenceFingerprint(
  recurrence: RecurringScheduleRecurrence,
): string {
  return 'every' in recurrence
    ? `every:${recurrence.every}`
    : `pattern:${recurrence.pattern}:tz:${recurrence.tz}`;
}

export function recurrenceFromRepeat(
  repeat: RepeatOptions | undefined,
): RecurringScheduleRecurrence | null {
  if (!repeat) return null;
  if (repeat.every !== undefined && repeat.pattern === undefined) {
    return { every: repeat.every };
  }
  if (
    repeat.pattern !== undefined &&
    repeat.every === undefined &&
    repeat.tz === 'UTC'
  ) {
    return { pattern: repeat.pattern, tz: 'UTC' };
  }
  return null;
}

export function hasExactRecurrence(
  scheduler: SchedulerRecurrence,
  recurrence: RecurringScheduleRecurrence,
): boolean {
  return 'every' in recurrence
    ? scheduler.every === recurrence.every && scheduler.pattern === undefined
    : scheduler.pattern === recurrence.pattern &&
        scheduler.tz === recurrence.tz &&
        scheduler.every === undefined;
}

export function validateRecurrence(
  recurrence: RecurringScheduleRecurrence,
): void {
  if ('every' in recurrence) {
    if (
      !Number.isSafeInteger(recurrence.every) ||
      recurrence.every < 1_000
    ) {
      throw new Error(
        'Recurring interval must be a safe integer of at least 1000ms',
      );
    }
    return;
  }
  if (recurrence.pattern.trim().length === 0) {
    throw new Error('Recurring cron pattern cannot be empty');
  }
}
