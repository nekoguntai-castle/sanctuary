import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import { withSerializableConflictRetry } from '../utils/prismaSerializableConflict';

let transactionTail: Promise<void> = Promise.resolve();

async function withLocalTransactionSlot<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = transactionTail;
  transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Retry a complete network-header transaction after PostgreSQL rolls it back.
 * Independent networks can still conflict at Serializable isolation while
 * inserting their first staged rows, so every retry must use a fresh
 * transaction and replay only database-local work.
 */
export async function withNetworkHeaderSerializableTransaction<T>(
  operation: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  // The backoff between attempts runs outside the local transaction slot, so a
  // waiting retry never holds up another network's header transaction.
  return withSerializableConflictRetry(
    () => withLocalTransactionSlot(() => (
      prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    )),
    { onExhausted: error => error },
  );
}
