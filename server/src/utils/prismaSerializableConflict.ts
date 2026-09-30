import { isPrismaError } from './errors';

/**
 * Prisma Pg adapter conflicts can surface either directly as P2034 or wrapped
 * by the driver adapter as P2010, or raw at transaction commit. Transaction retry
 * boundaries share this classification, including admin settings updates.
 */
export function isSerializableTransactionConflict(error: unknown): boolean {
  if (!isPrismaError(error)) return isRawDriverConflict(error);
  if (error.code === 'P2034') return true;

  const driverAdapterError = error.meta?.driverAdapterError as
    | { cause?: { kind?: unknown } }
    | undefined;
  return error.code === 'P2010'
    && driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
}

function isRawDriverConflict(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError') return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause === null || typeof cause !== 'object') return false;
  const conflict = cause as { kind?: unknown; originalCode?: unknown };
  // PostgreSQL rolls back both serialization failures (40001) and deadlocks (40P01).
  return conflict.kind === 'TransactionWriteConflict'
    && (conflict.originalCode === '40001' || conflict.originalCode === '40P01');
}

const DEFAULT_SERIALIZABLE_CONFLICT_ATTEMPTS = 3;
const CONFLICT_BACKOFF_MS = 10;
const CONFLICT_BACKOFF_JITTER_MS = 20;

export interface SerializableConflictRetryOptions {
  /** Total attempts including the first; defaults to 3. */
  maxAttempts?: number;
  /** Builds the value thrown once every attempt conflicted; receives the last conflict. */
  onExhausted: (lastConflict: unknown) => unknown;
  /** Observes each conflict that will be replayed (attempt that conflicted, error). */
  onRetry?: (attempt: number, conflict: unknown) => void;
}

/**
 * Wait before replaying a conflicted attempt. An immediate replay can take its
 * snapshot before the conflicting peer's commit is visible, conflict again and
 * exhaust every attempt (the adminSettingsConcurrency CI flake, run 19449).
 */
function conflictBackoff(attempt: number): Promise<void> {
  const delayMs = CONFLICT_BACKOFF_MS * attempt
    + Math.floor(Math.random() * CONFLICT_BACKOFF_JITTER_MS);
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Run a complete serializable unit of work, replaying it after a short
 * jittered backoff when PostgreSQL rolls it back as a serialization conflict.
 * Any other error is rethrown unchanged on the attempt that raised it. The
 * operation must hold all its mutations inside its own fresh transaction so a
 * replay never repeats partial work.
 */
export async function withSerializableConflictRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: SerializableConflictRetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_SERIALIZABLE_CONFLICT_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt >= maxAttempts) throw options.onExhausted(error);
      options.onRetry?.(attempt, error);
      await conflictBackoff(attempt);
    }
  }
}
