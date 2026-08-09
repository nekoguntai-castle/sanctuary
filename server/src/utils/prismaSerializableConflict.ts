import { isPrismaError } from './errors';

/**
 * Prisma Pg adapter conflicts can surface either directly as P2034 or wrapped
 * by the driver adapter as P2010. Keep this classification shared by the
 * transfer and preference retry boundaries.
 */
export function isSerializableTransactionConflict(error: unknown): boolean {
  if (!isPrismaError(error)) return false;
  if (error.code === 'P2034') return true;

  const driverAdapterError = error.meta?.driverAdapterError as
    | { cause?: { kind?: unknown } }
    | undefined;
  return error.code === 'P2010'
    && driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
}
