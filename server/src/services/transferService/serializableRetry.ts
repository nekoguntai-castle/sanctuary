import { ConflictError } from '../../errors';
import { transferRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { isSerializableTransactionConflict } from '../../utils/prismaSerializableConflict';
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
