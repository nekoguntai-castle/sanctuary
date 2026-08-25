/**
 * Batch Database Updates
 *
 * Execute database updates in chunks to avoid long-running transactions
 * that can cause lock contention.
 */

import { transactionRepository } from '../../../../repositories';
import { getConfig } from '../../../../config';
import { walletLog } from '../../../../websocket/notifications';
import type { WalletSyncMutationFence } from '../../../../repositories/types';
import { runWalletSyncMutation } from '../mutationBoundary';

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
  mutationFence?: WalletSyncMutationFence,
  serializeUnfenced = false,
): Promise<void> {
  if (mutationFence && !walletId) {
    throw new Error('Fenced missing-field updates require a target wallet ID');
  }
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

    await runWalletSyncMutation(
      { walletId: walletId ?? '', mutationFence },
      'missing_field_chunk',
      async (tx, deferPostCommit) => {
        await transactionRepository.batchUpdateByIds(chunk, chunk.length, tx);
        if (onChunkCommitted) {
          deferPostCommit(() => onChunkCommitted(chunk));
        }
      },
      () => signal?.throwIfAborted(),
      serializeUnfenced,
    );
  }
}
