/**
 * Insert UTXOs Phase
 *
 * Batch inserts new UTXOs that were discovered during the sync.
 * Also logs the total value of new UTXOs found.
 */

import { db as prisma } from '../../../../repositories/db';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext, UTXOCreateData } from '../types';

const log = createLogger('SYNC-UTXO-INSERT');

/**
 * Execute insert UTXOs phase
 *
 * Takes the prepared UTXO data from fetchUtxoDetails phase and
 * performs a batch insert into the database.
 */
export async function insertUtxosPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;

  // Collect UTXOs to create from context
  // This data is prepared by fetchUtxoDetails phase
  const utxosToCreate: UTXOCreateData[] = [];

  // Check which UTXOs already exist using targeted queries (avoids loading all wallet UTXOs)
  const keysToCheck = [...ctx.allUtxoKeys].map(key => {
    const [txid, voutStr] = key.split(':');
    return { txid, vout: parseInt(voutStr, 10) };
  });

  const existingUtxoSet = new Set<string>();
  const CHUNK_SIZE = 500;
  for (let i = 0; i < keysToCheck.length; i += CHUNK_SIZE) {
    const chunk = keysToCheck.slice(i, i + CHUNK_SIZE);
    const existing = await prisma.uTXO.findMany({
      where: {
        walletId,
        OR: chunk.map(k => ({ txid: k.txid, vout: k.vout })),
      },
      select: { txid: true, vout: true },
    });
    for (const u of existing) {
      existingUtxoSet.add(`${u.txid}:${u.vout}`);
    }
  }

  // Process UTXO data from context
  for (const key of ctx.allUtxoKeys) {
    if (existingUtxoSet.has(key)) continue;

    const data = ctx.utxoDataMap.get(key);
    if (!data) continue;

    const { address, utxo } = data;

    // Get tx details from cache or fetch
    let txDetails = ctx.txDetailsCache.get(utxo.tx_hash);
    if (!txDetails) {
      try {
        const fetched = await ctx.client.getTransaction(utxo.tx_hash);
        if (!fetched) {
          log.warn(`[SYNC] Transaction ${utxo.tx_hash} not found for UTXO`);
          continue;
        }
        ctx.txDetailsCache.set(utxo.tx_hash, fetched);
        txDetails = fetched;
      } catch (error) {
        log.warn(`[SYNC] Failed to get tx ${utxo.tx_hash} for UTXO`, { error: String(error) });
        continue;
      }
    }

    // TypeScript narrowing: txDetails is now guaranteed to be defined
    const output = txDetails!.vout?.[utxo.tx_pos];
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
      scriptPubKey: output.scriptPubKey?.hex || '',
      confirmations,
      blockHeight: utxo.height > 0 ? utxo.height : null,
      spent: false,
    });
  }

  // Batch insert
  if (utxosToCreate.length > 0) {
    log.debug(`[SYNC] Inserting ${utxosToCreate.length} UTXOs...`);

    await prisma.uTXO.createMany({
      data: utxosToCreate,
      skipDuplicates: true,
    });

    ctx.stats.utxosCreated = utxosToCreate.length;

    // Calculate total value
    const totalValue = utxosToCreate.reduce((sum, u) => sum + Number(u.amount), 0);
    walletLog(
      walletId,
      'info',
      'UTXO',
      `Found ${utxosToCreate.length} new UTXOs (${(totalValue / 100000000).toFixed(8)} BTC)`
    );
  }

  return ctx;
}
