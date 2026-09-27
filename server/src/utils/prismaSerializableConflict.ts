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
