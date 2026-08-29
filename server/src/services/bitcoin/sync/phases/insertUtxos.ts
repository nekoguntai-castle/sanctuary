/**
 * Insert UTXOs Phase
 *
 * Batch inserts new UTXOs that were discovered during the sync.
 * Also logs the total value of new UTXOs found.
 */

import { utxoRepository } from '../../../../repositories';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import { getConfig } from '../../../../config';
import type { SyncContext, UTXOCreateData } from '../types';
import { runWalletSyncMutation } from '../mutationBoundary';
import { releaseAuthenticatedEvidence } from '../evidenceAuthentication';

const log = createLogger('BITCOIN:SVC_SYNC_UTXO_INSERT');

/**
 * Execute insert UTXOs phase
 *
 * Takes the prepared UTXO data from fetchUtxoDetails phase and
 * performs a batch insert into the database.
 */
async function insertAuthenticatedUtxos(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;
  ctx.attemptRuntime?.signal.throwIfAborted();

  // Collect UTXOs to create from context
  // This data is prepared by fetchUtxoDetails phase
  const utxosToCreate: UTXOCreateData[] = [];

  // Check which UTXOs already exist using targeted queries (avoids loading all wallet UTXOs)
  const keysToCheck = [...ctx.allUtxoKeys].map(key => {
    const [txid, voutStr] = key.split(':');
    return { txid, vout: parseInt(voutStr, 10) };
  });

  const existingUtxoSet = await utxoRepository.findExistingByOutpoints(walletId, keysToCheck);

  // Process UTXO data from context
  for (const key of ctx.allUtxoKeys) {
      ctx.attemptRuntime?.signal.throwIfAborted();
      if (existingUtxoSet.has(key)) continue;

      const data = ctx.utxoDataMap.get(key);
      if (!data) continue;

      const { address, utxo } = data;

      const output = ctx.authenticatedOutpointEvidence.get(key);
      if (!output) continue;

      const confirmations = utxo.height > 0
        ? Math.max(0, ctx.currentBlockHeight - utxo.height + 1)
        : 0;

      utxosToCreate.push({
        walletId,
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        address,
        amount: BigInt(utxo.value),
        scriptPubKey: output.scriptHex,
        confirmations,
        blockHeight: utxo.height > 0 ? utxo.height : null,
        spent: false,
      });
  }

  // Insert in bounded chunks. Each chunk revalidates the immutable fence and
  // releases the wallet row lock before the next mutation begins.
  if (utxosToCreate.length > 0) {
    log.debug(`[SYNC] Inserting ${utxosToCreate.length} UTXOs...`);
    const batchSize = getConfig().sync.transactionBatchSize;
    ctx.stats.utxosCreated = 0;

    for (let offset = 0; offset < utxosToCreate.length; offset += batchSize) {
      ctx.attemptRuntime?.signal.throwIfAborted();
      const chunk = utxosToCreate.slice(offset, offset + batchSize);
      await runWalletSyncMutation(ctx, 'utxo_insert', async (tx, deferPostCommit) => {
        const inserted = await utxoRepository.createMany(
          chunk,
          { skipDuplicates: true },
          tx,
        );
        const totalValue = chunk.reduce((sum, utxo) => sum + Number(utxo.amount), 0);
        deferPostCommit(() => {
          ctx.stats.utxosCreated += inserted.count;
          walletLog(
            walletId,
            'info',
            'UTXO',
            `Found ${inserted.count} new UTXOs (${(totalValue / 100000000).toFixed(8)} BTC)`,
          );
        });
      });
    }
  }

  return ctx;
}

export async function insertUtxosPhase(ctx: SyncContext): Promise<SyncContext> {
  try {
    return await insertAuthenticatedUtxos(ctx);
  } finally {
    releaseAuthenticatedEvidence(ctx, 'attempt');
  }
}
