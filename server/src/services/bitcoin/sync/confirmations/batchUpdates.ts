/**
 * Batch Database Updates
 *
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention.
 */

import { transactionRepository } from '../../../../repositories';
import { getConfig } from '../../../../config';
import { walletLog } from '../../../../websocket/notifications';

/**
 * Execute database updates in chunks to avoid long-running transactions.
 * `onChunkCommitted` runs only after its database batch commits, allowing
 * callers to retain truthful partial progress if a later batch fails.
 */
export async function executeInChunks<T extends { id: string; data: Record<string, unknown> }>(
  items: T[],
  walletId?: string,
  onChunkCommitted?: (items: T[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const config = getConfig();
  const batchSize = config.sync.transactionBatchSize;
  const totalChunks = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    signal?.throwIfAborted();
    const chunk = items.slice(i, i + batchSize);
    const chunkNum = Math.floor(i / batchSize) + 1;

    if (walletId && totalChunks > 1) {
      walletLog(walletId, 'debug', 'DB', `Processing batch ${chunkNum}/${totalChunks} (${chunk.length} updates)`);
    }

    await transactionRepository.batchUpdateByIds(chunk, chunk.length);
    onChunkCommitted?.(chunk);
  }
}
