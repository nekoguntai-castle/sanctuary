import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';

const MAX_NETWORK_HEADER_TRANSACTION_ATTEMPTS = 3;
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
  for (let attempt = 1; attempt <= MAX_NETWORK_HEADER_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await withLocalTransactionSlot(() => (
        prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      ));
    } catch (error) {
      if (!isSerializableTransactionConflict(error)
        || attempt === MAX_NETWORK_HEADER_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  /* v8 ignore next -- every loop path returns or throws. */
  throw new Error('Network-header transaction retry exhausted');
}
