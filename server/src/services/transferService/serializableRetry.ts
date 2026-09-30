import { ConflictError } from '../../errors';
import { transferRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { withSerializableConflictRetry } from '../../utils/prismaSerializableConflict';
import type { PrismaTx } from './types';

const log = createLogger('TRANSFER:SVC');

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
  return withSerializableConflictRetry(
    () => transferRepository.withSerializableTransaction(attemptTransaction),
    {
      onExhausted: () => new ConflictError(options.exhaustedMessage),
      onRetry: attempt => log.debug('Retrying serializable transfer transaction', {
        operation: options.operation,
        attempt,
      }),
    },
  );
}
