import {
  DEAD_LETTER_CATEGORIES,
  DEAD_LETTER_VERSION,
  type DeadLetterEntry,
} from './deadLetterQueueTypes';

interface StoredDeadLetterEntry
  extends Omit<DeadLetterEntry, 'firstFailedAt' | 'lastFailedAt'> {
  firstFailedAt: number;
  lastFailedAt: number;
}

export function serializeDeadLetterEntry(entry: DeadLetterEntry): string {
  return JSON.stringify({
    ...entry,
    firstFailedAt: entry.firstFailedAt.getTime(),
    lastFailedAt: entry.lastFailedAt.getTime(),
  } satisfies StoredDeadLetterEntry);
}

export function parseDeadLetterEntry(raw: string): DeadLetterEntry {
  const parsed = JSON.parse(raw) as Partial<StoredDeadLetterEntry>;
  if (
    parsed.version !== DEAD_LETTER_VERSION ||
    typeof parsed.id !== 'string' ||
    parsed.id.length === 0 ||
    !DEAD_LETTER_CATEGORIES.includes(parsed.category!) ||
    typeof parsed.operation !== 'string' ||
    parsed.operation.length === 0 ||
    !parsed.payload ||
    typeof parsed.payload !== 'object' ||
    Array.isArray(parsed.payload) ||
    typeof parsed.error !== 'string' ||
    !Number.isSafeInteger(parsed.attempts) ||
    parsed.attempts! < 0 ||
    !Number.isSafeInteger(parsed.firstFailedAt) ||
    parsed.firstFailedAt! < 0 ||
    !Number.isSafeInteger(parsed.lastFailedAt) ||
    parsed.lastFailedAt! < parsed.firstFailedAt!
  ) {
    throw new Error('Invalid dead letter entry in canonical store');
  }
  return {
    ...(parsed as StoredDeadLetterEntry),
    firstFailedAt: new Date(parsed.firstFailedAt!),
    lastFailedAt: new Date(parsed.lastFailedAt!),
  };
}
