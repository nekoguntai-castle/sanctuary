import { ConflictError } from '../../errors';
import { transferRepository } from '../../repositories';
import { isPrismaError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { PrismaTx } from './types';

const log = createLogger('TRANSFER:SVC');
const MAX_SERIALIZABLE_ATTEMPTS = 3;

interface SerializableRetryOptions {
  operation: 'initiation' | 'confirmation';
  exhaustedMessage: string;
}

/**
 * Runs a complete transfer workflow in up to three fresh serializable transactions.
 * Only known rolled-back write conflicts are retried; all mutations must remain
 * inside the callback so no partial workflow is replayed.
 */
export async function withSerializableRetry<T>(
  options: SerializableRetryOptions,
  attemptTransaction: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await transferRepository.withSerializableTransaction(attemptTransaction);
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        throw new ConflictError(options.exhaustedMessage);
      }
      log.debug('Retrying serializable transfer transaction', {
        operation: options.operation,
        attempt,
      });
    }
  }

  /* v8 ignore next -- every loop path returns or throws */
  throw new ConflictError(options.exhaustedMessage);
}

function isSerializableTransactionConflict(error: unknown): boolean {
  if (!isPrismaError(error)) return false;
  if (error.code === 'P2034') return true;
  // The driver adapter currently wraps PostgreSQL serialization failures in
  // Prisma's generic raw-query error while preserving the conflict kind.
  const driverAdapterError = error.meta?.driverAdapterError as
    | { cause?: { kind?: unknown } }
    | undefined;
  return error.code === 'P2010'
    && driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
}
