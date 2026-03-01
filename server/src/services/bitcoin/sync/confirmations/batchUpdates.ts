/**
 * Batch Database Updates
 *
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention.
 */

import { db as prisma } from '../../../../repositories/db';
import { getConfig } from '../../../../config';
import { walletLog } from '../../../../websocket/notifications';

/**
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention. Uses the configured batch size.
 */
export async function executeInChunks<T>(
  items: T[],
  createUpdate: (item: T) => ReturnType<typeof prisma.transaction.update>,
  walletId?: string
): Promise<void> {
  const config = getConfig();
  const batchSize = config.sync.transactionBatchSize;

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkNum = Math.floor(i / batchSize) + 1;
    const totalChunks = Math.ceil(items.length / batchSize);

    if (walletId && totalChunks > 1) {
      walletLog(walletId, 'debug', 'DB', `Processing batch ${chunkNum}/${totalChunks} (${chunk.length} updates)`);
    }

    await prisma.$transaction(chunk.map(createUpdate));
  }
}
